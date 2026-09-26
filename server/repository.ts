import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ConversationDocument, ServerEvent } from '../shared/protocol';

export class Repository {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES sessions(id),
        updated_at TEXT NOT NULL, document TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_owner_updated ON conversations(owner, updated_at DESC);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL REFERENCES sessions(id), payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_owner_seq ON events(owner, seq);
      CREATE TABLE IF NOT EXISTS deleted_conversations (id TEXT PRIMARY KEY, owner TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS replay_floors (owner TEXT PRIMARY KEY, seq INTEGER NOT NULL);
    `);
  }
  close() { this.db.close(); }
  hasSession(id: string) { return !!this.db.prepare('SELECT id FROM sessions WHERE id = ?').get(id); }
  createSession(id: string) { this.db.prepare('INSERT INTO sessions VALUES (?, ?)').run(id, new Date().toISOString()); }
  list(owner: string): ConversationDocument[] {
    const rows = this.db.prepare('SELECT document FROM conversations WHERE owner = ? ORDER BY updated_at DESC').all(owner);
    return rows.map(row => JSON.parse(String(row.document)) as ConversationDocument);
  }
  get(owner: string, id: string): ConversationDocument | undefined {
    const row = this.db.prepare('SELECT document FROM conversations WHERE owner = ? AND id = ?').get(owner, id);
    return row ? JSON.parse(String(row.document)) as ConversationDocument : undefined;
  }
  exists(id: string) { return !!this.db.prepare('SELECT id FROM conversations WHERE id = ?').get(id); }
  deleted(id: string) { return !!this.db.prepare('SELECT id FROM deleted_conversations WHERE id = ?').get(id); }
  save(owner: string, document: ConversationDocument): ServerEvent {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      document.revision += 1;
      this.db.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, document=excluded.document')
        .run(document.id, owner, document.updatedAt, JSON.stringify(document));
      const event = this.record(owner, { type: 'conversation.updated', seq: 0, conversationId: document.id, conversation: document });
      this.db.exec('COMMIT');
      return event;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  delete(owner: string, id: string): ServerEvent {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM conversations WHERE owner = ? AND id = ?').run(owner, id);
      const removed = Number(this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE owner = ? AND json_extract(payload, '$.conversationId') = ?").get(owner, id)?.seq ?? 0);
      this.db.prepare("DELETE FROM events WHERE owner = ? AND json_extract(payload, '$.conversationId') = ?").run(owner, id);
      this.raiseFloor(owner, removed);
      this.db.prepare('INSERT OR IGNORE INTO deleted_conversations VALUES (?, ?)').run(id, owner);
      const event = this.record(owner, { type: 'conversation.deleted', conversationId: id, seq: 0 });
      this.db.exec('COMMIT');
      return event;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private record(owner: string, event: ServerEvent): ServerEvent {
    const result = this.db.prepare('INSERT INTO events(owner, payload) VALUES (?, ?)').run(owner, JSON.stringify(event));
    const cutoff = this.db.prepare('SELECT seq FROM events WHERE owner = ? ORDER BY seq DESC LIMIT 1 OFFSET 200').get(owner);
    if (cutoff) {
      const seq = Number(cutoff.seq);
      this.db.prepare('DELETE FROM events WHERE owner = ? AND seq <= ?').run(owner, seq);
      this.raiseFloor(owner, seq);
    }
    return { ...event, seq: Number(result.lastInsertRowid) };
  }
  private raiseFloor(owner: string, seq: number) {
    this.db.prepare('INSERT INTO replay_floors VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET seq = MAX(seq, excluded.seq)').run(owner, seq);
  }
  needsSync(owner: string, after: number) {
    return after < Number(this.db.prepare('SELECT seq FROM replay_floors WHERE owner = ?').get(owner)?.seq ?? 0);
  }
  cursor(owner: string): number {
    return Number(this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE owner = ?').get(owner)?.seq ?? 0);
  }
  replay(owner: string, after: number): ServerEvent[] {
    return this.db.prepare('SELECT seq, payload FROM events WHERE owner = ? AND seq > ? ORDER BY seq LIMIT 501').all(owner, after)
      .map(row => ({ ...JSON.parse(String(row.payload)), seq: Number(row.seq) }) as ServerEvent);
  }
  interruptRunning() {
    const rows = this.db.prepare('SELECT owner, document FROM conversations').all();
    for (const row of rows) {
      const document = JSON.parse(String(row.document)) as ConversationDocument;
      if (document.generation.status !== 'running') continue;
      document.generation = { ...document.generation, status: 'failed', error: 'The server restarted before this response finished. Please retry.' };
      document.messages = document.messages.map(m => m.status === 'streaming' ? { ...m, status: 'failed' } : m);
      this.save(String(row.owner), document);
    }
  }
}
