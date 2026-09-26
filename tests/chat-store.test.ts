import { describe, it, expect, vi } from 'vitest';
import { ChatStore } from '../src/features/chat/store/chat-store';
import { client, document, deferred } from './fixtures';
import type { ConversationDocument } from '../shared/protocol';

describe('conversation isolation and reconciliation', () => {
  it('routes delayed A events to A while B is active and marks A unread', () => {
    const store = new ChatStore(client()); const a = document(); const b = document();
    store.applyDocument(a); store.applyDocument(b); store.setActive(b.id);
    store.handleEvent({ type: 'ASSISTANT_COMPLETED', conversationId: a.id, content: 'A only' });
    expect(Object.values(store.getConversation(a.id)!.messagesById)[0].content).toBe('A only');
    expect(store.getConversation(a.id)?.unread).toBe(true);
    expect(store.getConversation(b.id)?.messageIds).toEqual([]);
    store.setActive(a.id); expect(store.getConversation(a.id)?.unread).toBe(false);
  });
  it('never attributes a null conversationId to the active conversation', () => {
    const store = new ChatStore(client()); const a = document(); store.applyDocument(a); store.setActive(a.id);
    store.handleEvent({ type: 'ASSISTANT_COMPLETED', conversationId: null, content: 'Unroutable' });
    expect(store.getConversation(a.id)?.messageIds).toEqual([]);
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
    await store.delete(a.id);
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
  it('does not infer deletion from an incomplete backend list', async () => {
    const api = client(); const store = new ChatStore(api); const a = document(); store.applyDocument(a);
    await store.loadIndex(); expect(store.getConversation(a.id)?.metadata.id).toBe(a.id);
  });
  it('does not add a failed direct-link load to conversation history', async () => {
    const api = client(); vi.mocked(api.get).mockRejectedValue(new Error('Not found')); const store = new ChatStore(api);
    await store.loadConversation('missing'); await store.loadIndex(); expect(store.getIndex().items).toEqual([]);
  });
});

describe('message lifecycle', () => {
  it('uses server IDs and acknowledges optimistic messages on assistant start', async () => {
    const api = client(); const transport = vi.fn(); const store = new ChatStore(api, transport);
    const id = await store.createConversation('Hello');
    expect(id).toBe((await api.create()).id);
    await store.send(id, 'Hello');
    expect(Object.values(store.getConversation(id)!.messagesById)[0].status).toBe('sending');
    expect(await store.send(id, 'duplicate')).toBe(false);
    store.handleEvent({type:'ASSISTANT_STARTED',conversationId:id,content:null});
    expect(Object.values(store.getConversation(id)!.messagesById).map(m=>m.status)).toEqual(['sent','streaming']);
    expect(transport).toHaveBeenCalledExactlyOnceWith(id,'Hello');
  });
  it('retains a synchronous failed send and allows retry without a duplicate bubble', async () => {
    const transport = vi.fn().mockImplementationOnce(()=>{throw new Error('offline')});
    const store = new ChatStore(client(),transport); const id = await store.createConversation('Hello');
    await store.send(id,'Hello');
    const message = Object.values(store.getConversation(id)!.messagesById)[0];
    expect(message.status).toBe('failed');
    await store.send(id,'Hello',message.requestId);
    expect(store.getConversation(id)?.messageIds).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('allows independent requests in two conversations', async () => {
    const transport=vi.fn(); const store=new ChatStore(client(),transport);
    const a=document();const b=document();store.applyDocument(a);store.applyDocument(b);
    await store.send(a.id,'A'); await store.send(b.id,'B');
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('does not create a conversation on navigation',()=>{
    const api=client();const store=new ChatStore(api);store.setActive(null);
    expect(api.create).not.toHaveBeenCalled();
  });
});
