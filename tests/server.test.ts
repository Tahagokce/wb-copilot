import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { createApp } from '../server/app';
import { Repository } from '../server/repository';
import { UnconfiguredProvider, type CopilotProvider } from '../server/provider';
import type { ConversationDocument, ServerEvent } from '../shared/protocol';
import { deferred, document } from './fixtures';

class ControlledProvider implements CopilotProvider {
  available = true; name = 'Test fixture only';
  requests = new Map<string, { input: Parameters<CopilotProvider['generate']>[0]; result: ReturnType<typeof deferred<string>> }>();
  generate(input: Parameters<CopilotProvider['generate']>[0]) {
    const result = deferred<string>(); this.requests.set(input.conversationId, { input, result }); return result.promise;
  }
}
describe('real HTTP, SQLite and WebSocket contract', () => {
  let app: ReturnType<typeof createApp>; let provider: ControlledProvider; let base: string; let cookie: string;
  const sockets: WebSocket[] = [];
  beforeEach(async () => {
    provider = new ControlledProvider(); app = createApp({ databasePath: ':memory:', provider });
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No port');
    base = `http://127.0.0.1:${address.port}`;
    const session = await fetch(`${base}/api/session`); cookie = session.headers.get('set-cookie')!.split(';')[0];
  });
  afterEach(async () => { for (const socket of sockets.splice(0)) socket.terminate(); await app.close(); });
  async function request(path: string, method = 'GET', payload?: unknown, session = cookie) {
    return fetch(`${base}/api${path}`, { method, headers: { cookie: session, origin: base, 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  }
  async function send(id = randomUUID(), content = 'Test message', requestId = randomUUID()) {
    const response = await request(`/conversations/${id}/messages`, 'POST', { content, requestId });
    return { id, requestId, response, document: await response.json() as ConversationDocument };
  }
  async function socket(after = 0) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/realtime', { headers: { cookie, origin: base } });
    const events: ServerEvent[] = []; sockets.push(ws);
    ws.on('message', data => events.push(JSON.parse(data.toString()) as ServerEvent));
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ type: 'resume', after }));
    await vi.waitFor(() => expect(events.some(event => event.type === 'ready')).toBe(true));
    return { ws, events };
  }
  it('creates lazily, persists messages, and restores by URL id', async () => {
    expect(await (await request('/conversations')).json()).toEqual([]);
    const a = await send(); expect(a.response.status).toBe(202); provider.requests.get(a.id)!.result.resolve('Completed A');
    await vi.waitFor(() => expect(app.repository.get(cookie.slice(11), a.id)?.generation.status).toBe('completed'));
    const restored = await (await request(`/conversations/${a.id}`)).json() as ConversationDocument;
    expect(restored.messages.map(m => m.content)).toEqual(['Test message', 'Completed A']);
    expect(await (await request('/conversations')).json()).toHaveLength(1);
  });
  it('continues A without its socket and independently completes B', async () => {
    const connection = await socket(); const a = await send(); connection.ws.terminate();
    const b = await send(randomUUID(), 'B'); expect(app.jobs.size).toBe(2);
    provider.requests.get(a.id)!.result.resolve('Only A'); provider.requests.get(b.id)!.result.resolve('Only B');
    await vi.waitFor(() => expect(app.jobs.size).toBe(0));
    const docs = await Promise.all([a,b].map(async item => await (await request(`/conversations/${item.id}`)).json() as Promise<ConversationDocument>));
    expect(docs[0].messages.at(-1)?.content).toBe('Only A'); expect(docs[1].messages.at(-1)?.content).toBe('Only B');
    const resumed = await socket(); expect(resumed.events.filter(event => event.type === 'conversation.updated').length).toBeGreaterThanOrEqual(4);
  });
  it('replays only events after the acknowledged cursor on reconnect', async () => {
    const connection = await socket(); const a = await send();
    await vi.waitFor(() => expect(connection.events.some(event => event.type === 'conversation.updated')).toBe(true));
    const cursor = Math.max(...connection.events.map(event => event.seq)); connection.ws.terminate();
    provider.requests.get(a.id)!.result.resolve('Later result'); await vi.waitFor(() => expect(app.jobs.size).toBe(0));
    const resumed = await socket(cursor); const changes = resumed.events.filter(event => event.type === 'conversation.updated');
    expect(changes).toHaveLength(1); expect(changes[0].conversationId).toBe(a.id);
  });
  it('uses idempotency keys and refuses concurrent sends within one conversation', async () => {
    const a = await send(); const duplicate = await send(a.id, 'Test message', a.requestId);
    expect(duplicate.response.status).toBe(200); expect(duplicate.document.messages).toHaveLength(1);
    expect((await send(a.id, 'second')).response.status).toBe(409);
  });
  it('deletion aborts the job and late callbacks cannot recreate the chat', async () => {
    const a = await send(); const work = provider.requests.get(a.id)!;
    expect((await request(`/conversations/${a.id}`, 'DELETE')).status).toBe(200);
    expect(work.input.signal.aborted).toBe(true); work.input.onTool({ id: 'late', label: 'Late event', status: 'completed' }); work.result.resolve('Too late');
    await Promise.resolve(); expect((await request(`/conversations/${a.id}`)).status).toBe(404); expect((await send(a.id)).response.status).toBe(404);
  });
  it('isolates sessions and rejects cross-origin writes and sockets', async () => {
    const a = await send(); const other = await fetch(`${base}/api/session`); const otherCookie = other.headers.get('set-cookie')!.split(';')[0];
    expect((await request(`/conversations/${a.id}`, 'GET', undefined, otherCookie)).status).toBe(404);
    expect((await request(`/conversations/${a.id}/messages`, 'POST', { requestId: randomUUID(), content: 'Other' }, otherCookie)).status).toBe(404);
    const response = await fetch(`${base}/api/conversations/${a.id}`, { method: 'DELETE', headers: { cookie, origin: 'https://other.example' } }); expect(response.status).toBe(403);
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/realtime', { headers: { cookie, origin: 'https://other.example' } });
    await new Promise<void>(resolve => ws.once('error', error => { expect(error.message).toContain('403'); resolve(); }));
  });
  it('tool events remain runtime state and final content stays separate', async () => {
    const a = await send(); const work = provider.requests.get(a.id)!;
    work.input.onTool({ id: 't', label: 'Real label from provider', status: 'running' });
    work.input.onTool({ id: 't', label: 'Real label from provider', status: 'completed' }); work.result.resolve('Final answer');
    await vi.waitFor(() => expect(app.jobs.size).toBe(0));
    const restored = await (await request(`/conversations/${a.id}`)).json() as ConversationDocument;
    expect(restored.generation.tools).toEqual([{ id: 't', label: 'Real label from provider', status: 'completed' }]); expect(restored.messages).toHaveLength(2);
  });
  it('renames, acknowledges unread completion, and deletes durably', async () => {
    const a = await send(); provider.requests.get(a.id)!.result.resolve('Done'); await vi.waitFor(() => expect(app.jobs.size).toBe(0));
    const renamed = await (await request(`/conversations/${a.id}`, 'PATCH', { title: 'Renamed' })).json() as ConversationDocument; expect(renamed.title).toBe('Renamed');
    const read = await (await request(`/conversations/${a.id}/read`, 'POST')).json() as ConversationDocument; expect(read.readAt >= read.lastAssistantAt!).toBe(true);
    await request(`/conversations/${a.id}`, 'DELETE'); expect(await (await request('/conversations')).json()).toEqual([]);
  });
});

it('SQLite survives restart and marks interrupted work honestly', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wb-test-')); const path = join(directory, 'chat.sqlite'); const owner = randomUUID(); const a = document(); a.generation.status = 'running';
  let repository = new Repository(path); repository.createSession(owner); repository.save(owner, a); repository.close();
  repository = new Repository(path); repository.interruptRunning();
  expect(repository.get(owner, a.id)?.generation.status).toBe('failed'); expect(repository.get(owner, a.id)?.generation.error).toContain('server restarted');
  repository.close(); rmSync(directory, { recursive: true });
});
it('unconfigured provider cannot manufacture a successful AI response', async () => {
  const provider = new UnconfiguredProvider(); expect(provider.available).toBe(false); await expect(provider.generate()).rejects.toThrow('SERVICE_NOT_CONFIGURED');
});

it('bounds replay retention and requests full sync for an expired cursor', () => {
  const repository = new Repository(':memory:'); const owner = randomUUID(); repository.createSession(owner); const a = document();
  for (let index = 0; index < 205; index++) repository.save(owner, a);
  expect(repository.replay(owner, 0)).toHaveLength(200); expect(repository.needsSync(owner, 1)).toBe(true);
  expect(repository.needsSync(owner, 205)).toBe(false); repository.close();
});

it('deleting a conversation erases its content from retained replay events', () => {
  const repository = new Repository(':memory:'); const owner = randomUUID(); repository.createSession(owner); const a = document();
  a.title = 'Content to erase'; repository.save(owner, a); repository.delete(owner, a.id);
  expect(JSON.stringify(repository.replay(owner, 0))).not.toContain('Content to erase'); expect(repository.needsSync(owner, 0)).toBe(true); repository.close();
});
