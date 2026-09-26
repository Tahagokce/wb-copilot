import { idleGeneration, type ConversationDocument, type ConversationSummary, type Message, type ServerEvent, type ConnectionState } from '../../../../shared/protocol';
import { api, type ChatApi } from '../services/api';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
export type ConversationState = {
  metadata: ConversationSummary;
  messagesById: Record<string, Message>;
  messageIds: string[];
  loadState: LoadState;
  error?: string;
  unread: boolean;
  pending: boolean;
};
type IndexState = { items: ConversationSummary[]; status: LoadState; error?: string };
type RuntimeState = { connection: ConnectionState; serviceAvailable: boolean; initialized: boolean; error?: string };
type Listener = () => void;
export class ChatStore {
  private conversations = new Map<string, ConversationState>();
  private deleted = new Set<string>();
  private listeners = new Map<string, Set<Listener>>();
  private indexListeners = new Set<Listener>();
  private runtimeListeners = new Set<Listener>();
  private index: IndexState = { items: [], status: 'idle' };
  private runtime: RuntimeState = { connection: 'connecting', serviceAvailable: false, initialized: false };
  private loading = new Map<string, Promise<void>>();
  private reading = new Set<string>();
  private activeId: string | null = null;
  private listRequest = 0;
  private drafts = new Map<string, string>();
  readonly scrollPositions = new Map<string, { top: number; following: boolean }>();
  constructor(private client: ChatApi = api) {}
  getConversation = (id: string) => this.conversations.get(id);
  getIndex = () => this.index;
  getRuntime = () => this.runtime;
  subscribe = (id: string, fn: Listener) => {
    let listeners = this.listeners.get(id);
    if (!listeners) { listeners = new Set(); this.listeners.set(id, listeners); }
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  };
  subscribeIndex = (fn: Listener) => { this.indexListeners.add(fn); return () => { this.indexListeners.delete(fn); }; };
  subscribeRuntime = (fn: Listener) => { this.runtimeListeners.add(fn); return () => { this.runtimeListeners.delete(fn); }; };
  private notify(id: string) { this.listeners.get(id)?.forEach(fn => fn()); }
  private notifyIndex() { this.indexListeners.forEach(fn => fn()); }
  setRuntime(patch: Partial<RuntimeState>) { this.runtime = { ...this.runtime, ...patch }; this.runtimeListeners.forEach(fn => fn()); }
  private updateIndex(summary: ConversationSummary) {
    const old = this.index.items.find(item => item.id === summary.id);
    // Streaming/tool updates do not re-render the sidebar unless its displayed state changes.
    if (old && old.title === summary.title && old.updatedAt === summary.updatedAt && old.generation.status === summary.generation.status && old.readAt === summary.readAt && old.lastAssistantAt === summary.lastAssistantAt) return;
    this.index = { ...this.index, items: [...this.index.items.filter(item => item.id !== summary.id), summary].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
    this.notifyIndex();
  }
  applyDocument(document: ConversationDocument) {
    if (this.deleted.has(document.id)) return;
    const existing = this.conversations.get(document.id);
    if (existing && existing.metadata.revision > document.revision) return;
    const { messages, ...metadata } = document;
    const requestIds = new Set(messages.filter(m => m.role === 'user').map(m => m.requestId));
    const optimistic = existing?.messageIds.map(id => existing.messagesById[id]).filter(m => m.role === 'user' && (m.status === 'sending' || m.status === 'failed') && !requestIds.has(m.requestId)) ?? [];
    const all = [...messages, ...optimistic].map(message => {
      const previous = existing?.messagesById[message.id];
      return previous && previous.status === message.status && previous.content === message.content ? previous : message;
    });
    const ids = all.map(m => m.id);
    const messageIds = existing && ids.length === existing.messageIds.length && ids.every((id, index) => id === existing.messageIds[index]) ? existing.messageIds : ids;
    const messagesById = existing && messageIds === existing.messageIds && all.every(m => existing.messagesById[m.id] === m) ? existing.messagesById : Object.fromEntries(all.map(m => [m.id, m]));
    const unread = !!metadata.lastAssistantAt && metadata.lastAssistantAt > metadata.readAt && document.id !== this.activeId;
    this.conversations.set(document.id, { metadata, messagesById, messageIds, loadState: 'loaded', unread, pending: optimistic.some(m => m.status === 'sending') });
    this.notify(document.id); this.updateIndex(metadata);
    if (document.id === this.activeId && metadata.lastAssistantAt && metadata.lastAssistantAt > metadata.readAt) void this.markRead(document.id);
  }
  handleEvent = (event: ServerEvent) => {
    if (event.type === 'conversation.updated' && event.conversationId === event.conversation.id) this.applyDocument(event.conversation);
    if (event.type === 'conversation.deleted') this.remove(event.conversationId);
    if (event.type === 'sync') void this.resync();
  };
  setActive(id: string | null) {
    this.activeId = id;
    if (id) {
      const state = this.conversations.get(id);
      if (state?.unread) { this.conversations.set(id, { ...state, unread: false }); this.notify(id); }
      void this.markRead(id);
    }
  }
  private async markRead(id: string) {
    const state = this.conversations.get(id);
    if (!state?.metadata.lastAssistantAt || state.metadata.readAt >= state.metadata.lastAssistantAt || this.reading.has(id)) return;
    this.reading.add(id);
    try { this.applyDocument(await this.client.read(id)); } catch { /* A reconnect/load retries read receipts. */ }
    finally { this.reading.delete(id); }
  }
  async loadIndex() {
    const request = ++this.listRequest;
    const known = new Map([...this.conversations].map(([id, state]) => [id, state.metadata.revision]));
    this.index = { ...this.index, status: 'loading', error: undefined }; this.notifyIndex();
    try {
      const items = await this.client.list();
      if (request !== this.listRequest) return;
      const merged = new Map(items.filter(item => !this.deleted.has(item.id)).map(item => [item.id, item]));
      // A full sync is authoritative for deletions missed outside the replay window.
      for (const [id, revision] of known) {
        if (revision > 0 && !merged.has(id) && this.conversations.get(id)?.metadata.revision === revision) this.remove(id);
      }
      for (const [id, state] of this.conversations) {
        if (this.deleted.has(id)) continue;
        if (state.metadata.revision === 0 && !state.messageIds.length) continue;
        if (!merged.has(id) || merged.get(id)!.revision < state.metadata.revision) merged.set(id, state.metadata);
      }
      this.index = { items: [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), status: 'loaded' };
    } catch { if (request === this.listRequest) this.index = { ...this.index, status: 'error', error: 'Could not load your chats.' }; }
    this.notifyIndex();
  }
  async loadConversation(id: string, force = false): Promise<void> {
    if (this.deleted.has(id)) return;
    if (this.loading.has(id)) return this.loading.get(id);
    const existing = this.conversations.get(id);
    if (!force && existing?.loadState === 'loaded') return;
    const state = existing ?? this.empty(id);
    this.conversations.set(id, { ...state, loadState: 'loading', error: undefined }); this.notify(id);
    const promise = (async () => {
      try { this.applyDocument(await this.client.get(id)); }
      catch {
        if (this.deleted.has(id)) return;
        const latest = this.conversations.get(id)!;
        if (latest.metadata.revision > state.metadata.revision) return;
        this.conversations.set(id, { ...latest, loadState: 'error', error: 'Could not load this conversation.' }); this.notify(id);
      } finally { this.loading.delete(id); }
    })();
    this.loading.set(id, promise); return promise;
  }
  async resync() {
    await Promise.all([this.loadIndex(), ...[...this.conversations.keys()].map(id => this.loadConversation(id, true))]);
  }
  private empty(id: string, title = 'New chat'): ConversationState {
    const now = new Date().toISOString();
    return { metadata: { id, title, createdAt: now, updatedAt: now, revision: 0, generation: idleGeneration, lastAssistantAt: null, readAt: now }, messagesById: {}, messageIds: [], loadState: 'idle', unread: false, pending: false };
  }
  prepareConversation(content: string) {
    const id = crypto.randomUUID();
    this.conversations.set(id, { ...this.empty(id, content.slice(0, 64)), loadState: 'loaded' });
    return id;
  }
  async send(id: string, content: string, retryRequestId?: string) {
    const state = this.conversations.get(id);
    if (!state || state.pending || state.metadata.generation.status === 'running' || this.deleted.has(id)) return false;
    const requestId = retryRequestId ?? crypto.randomUUID();
    const existing = state.messageIds.map(key => state.messagesById[key]).find(m => m.role === 'user' && m.requestId === requestId);
    const message: Message = { id: existing?.id ?? `local:${requestId}`, conversationId: id, requestId, role: 'user', content, createdAt: existing?.createdAt ?? new Date().toISOString(), status: 'sending' };
    this.conversations.set(id, { ...state, pending: true, messagesById: { ...state.messagesById, [message.id]: message }, messageIds: existing ? state.messageIds : [...state.messageIds, message.id] });
    this.notify(id); this.updateIndex(state.metadata);
    try { this.applyDocument(await this.client.send(id, requestId, content)); return true; }
    catch {
      if (this.deleted.has(id)) return false;
      const latest = this.conversations.get(id)!;
      const accepted = latest.messageIds.map(key => latest.messagesById[key]).find(m => m.role === 'user' && m.requestId === requestId && m.status === 'sent');
      if (accepted) return true;
      this.conversations.set(id, { ...latest, pending: false, messagesById: { ...latest.messagesById, [message.id]: { ...message, status: 'failed' } } }); this.notify(id);
      return false;
    }
  }
  async rename(id: string, title: string) { this.applyDocument(await this.client.rename(id, title)); }
  async delete(id: string) { await this.client.delete(id); this.remove(id); }
  private remove(id: string) {
    this.deleted.add(id); this.conversations.delete(id); this.drafts.delete(id); this.scrollPositions.delete(id);
    this.index = { ...this.index, items: this.index.items.filter(item => item.id !== id) };
    this.notify(id); this.notifyIndex();
  }
  isDeleted(id: string) { return this.deleted.has(id); }
  getDraft(id: string) { return this.drafts.get(id) ?? ''; }
  setDraft(id: string, value: string) { this.drafts.set(id, value); }
}
export const chatStore = new ChatStore();
