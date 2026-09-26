import { describe, it, expect, vi } from 'vitest';
import { ChatStore } from '../src/features/chat/store/chat-store';
import { client, document, deferred } from './fixtures';
import type { ConversationDocument } from '../shared/protocol';

describe('conversation isolation and reconciliation', () => {
  it('routes delayed A events to A while B is active and marks A unread', () => {
    const store = new ChatStore(client()); const a = document(); const b = document();
    store.applyDocument(a); store.applyDocument(b); store.setActive(b.id);
    a.revision++; a.lastAssistantAt = '2026-09-27T09:00:00.000Z'; a.generation.status = 'completed';
    a.messages = [{ id: 'answer-a', conversationId: a.id, requestId: 'request', role: 'assistant', content: 'A only', createdAt: a.lastAssistantAt, status: 'completed' }];
    store.handleEvent({ type: 'conversation.updated', conversationId: a.id, conversation: a, seq: 3 });
    expect(store.getConversation(a.id)?.messagesById['answer-a'].content).toBe('A only');
    expect(store.getConversation(a.id)?.unread).toBe(true);
    expect(store.getConversation(b.id)?.messageIds).toEqual([]);
    store.setActive(a.id); expect(store.getConversation(a.id)?.unread).toBe(false);
  });
  it('rejects mismatched envelopes instead of routing by the visible conversation', () => {
    const store = new ChatStore(client()); const a = document();
    store.handleEvent({ type: 'conversation.updated', conversationId: 'wrong', conversation: a, seq: 1 });
    expect(store.getConversation(a.id)).toBeUndefined();
  });
  it('A → B → C loads may resolve in any order without replacing C', async () => {
    const api = client(); const store = new ChatStore(api); const a = document(); const b = document(); const c = document();
    const pending = new Map([a,b,c].map(d => [d.id, deferred<ConversationDocument>()]));
    vi.mocked(api.get).mockImplementation(id => pending.get(id)!.promise);
    const loads = [a,b,c].map(d => { store.setActive(d.id); return store.loadConversation(d.id); });
    pending.get(c.id)!.resolve(c); pending.get(a.id)!.resolve(a); pending.get(b.id)!.resolve(b);
    await Promise.all(loads);
    expect(store.getConversation(c.id)?.metadata.id).toBe(c.id);
    expect([a,b,c].map(d => store.getConversation(d.id)?.metadata.id)).toEqual([a.id,b.id,c.id]);
  });
  it('ignores an old HTTP snapshot after a newer realtime update', async () => {
    const api = client(); const store = new ChatStore(api); const old = document(); const pending = deferred<ConversationDocument>();
    vi.mocked(api.get).mockReturnValue(pending.promise);
    const loading = store.loadConversation(old.id);
    store.applyDocument({ ...old, title: 'New title', revision: 3 });
    pending.resolve(old); await loading;
    expect(store.getConversation(old.id)?.metadata.title).toBe('New title');
  });
  it('does not resurrect a deleted conversation from delayed HTTP or socket events', async () => {
    const api = client(); const store = new ChatStore(api); const a = document(); const pending = deferred<ConversationDocument>();
    vi.mocked(api.get).mockReturnValue(pending.promise); const loading = store.loadConversation(a.id);
    store.handleEvent({ type: 'conversation.deleted', conversationId: a.id, seq: 3 });
    pending.resolve(a); await loading; store.applyDocument({ ...a, revision: 99 });
    expect(store.getConversation(a.id)).toBeUndefined(); expect(store.getIndex().items).toHaveLength(0);
  });
  it('scopes subscriptions and preserves message references for tool-only events', () => {
    const store = new ChatStore(client()); const a = document(); const b = document();
    a.messages.push({ id: 'm', conversationId: a.id, role: 'user', requestId: 'r', content: 'Hello', status: 'sent', createdAt: a.createdAt });
    store.applyDocument(a); store.applyDocument(b);
    const listener = vi.fn(); store.subscribe(b.id, listener);
    const before = store.getConversation(a.id)!.messagesById;
    store.applyDocument({ ...structuredClone(a), revision: 2, generation: { status: 'running', requestId: 'r', tools: [{ id: 't', label: 'Actual tool event', status: 'running' }] } });
    expect(listener).not.toHaveBeenCalled(); expect(store.getConversation(a.id)!.messagesById).toBe(before);
  });
  it('deduplicates concurrent loads', async () => {
    const api = client(); const a = document(); vi.mocked(api.get).mockResolvedValue(a); const store = new ChatStore(api);
    await Promise.all([store.loadConversation(a.id), store.loadConversation(a.id)]); expect(api.get).toHaveBeenCalledTimes(1);
  });
  it('full resync removes conversations deleted outside the replay window', async () => {
    const api = client(); const store = new ChatStore(api); const a = document(); store.applyDocument(a);
    await store.loadIndex(); expect(store.getConversation(a.id)).toBeUndefined();
  });
  it('does not add a failed direct-link load to conversation history', async () => {
    const api = client(); vi.mocked(api.get).mockRejectedValue(new Error('Not found')); const store = new ChatStore(api);
    await store.loadConversation('missing'); await store.loadIndex(); expect(store.getIndex().items).toEqual([]);
  });
});

describe('message lifecycle', () => {
  it('renders immediately, prevents duplicate sends, and reconciles acknowledgement', async () => {
    const api = client(); const store = new ChatStore(api); const pending = deferred<ConversationDocument>(); vi.mocked(api.send).mockReturnValue(pending.promise);
    const id = store.prepareConversation('Hello'); const send = store.send(id, 'Hello');
    const optimistic = Object.values(store.getConversation(id)!.messagesById)[0]; expect(optimistic.status).toBe('sending');
    expect(await store.send(id, 'Hello')).toBe(false); expect(api.send).toHaveBeenCalledTimes(1);
    const saved = document(id); saved.messages = [{ ...optimistic, id: 'server-id', status: 'sent' }]; pending.resolve(saved); await send;
    expect(store.getConversation(id)?.messageIds).toEqual(['server-id']); expect(store.getConversation(id)?.pending).toBe(false);
  });
  it('retains failed sends and retries with the same idempotency key', async () => {
    const api = client(); const store = new ChatStore(api); vi.mocked(api.send).mockRejectedValue(new Error('network'));
    const id = store.prepareConversation('Hello'); await store.send(id, 'Hello');
    const message = Object.values(store.getConversation(id)!.messagesById)[0]; expect(message.status).toBe('failed');
    await store.send(id, message.content, message.requestId);
    expect(api.send).toHaveBeenNthCalledWith(2, id, message.requestId, 'Hello');
    expect(store.getConversation(id)?.messageIds).toHaveLength(1);
  });
  it('does not label an acknowledged message failed if HTTP fails after the socket acknowledgement', async () => {
    const api = client(); const store = new ChatStore(api); const pending = deferred<ConversationDocument>(); vi.mocked(api.send).mockReturnValue(pending.promise);
    const id = store.prepareConversation('Hello'); const sending = store.send(id, 'Hello');
    const message = Object.values(store.getConversation(id)!.messagesById)[0]; const saved = document(id); saved.messages = [{ ...message, id: 'accepted', status: 'sent' }];
    store.applyDocument(saved); pending.reject(new Error('network')); await sending;
    expect(store.getConversation(id)?.messagesById.accepted.status).toBe('sent');
  });
  it('allows B to send while A is generating', async () => {
    const api = client(); const store = new ChatStore(api); const a = document(); a.generation.status = 'running'; store.applyDocument(a);
    const b = store.prepareConversation('B'); vi.mocked(api.send).mockResolvedValue(document(b)); await store.send(b, 'B');
    expect(api.send).toHaveBeenCalledTimes(1); expect(store.getConversation(a.id)?.metadata.generation.status).toBe('running');
  });
  it('new-chat navigation alone never invokes a create/save API', () => {
    const api = client(); const store = new ChatStore(api); store.setActive(null); store.setActive(null);
    expect(api.send).not.toHaveBeenCalled(); expect(store.getIndex().items).toEqual([]);
  });
});
