import { idleGeneration, type ConversationDocument, type ConversationSummary, type Message, type ConnectionState } from '../../../../shared/protocol';
import { api, type ChatApi } from '../services/api';
import type { ChatEvent } from '../../../../shared/backend-types';
import { reduceChatEvent } from './reduce-event';

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
type RuntimeState = { connection: ConnectionState; backendConfigured: boolean; canSend: boolean; initialized: boolean; error?: string };
type Listener = () => void;
export class ChatStore {
  private conversations = new Map<string, ConversationState>();
  private deleted = new Set<string>();
  private listeners = new Map<string, Set<Listener>>();
  private indexListeners = new Set<Listener>();
  private runtimeListeners = new Set<Listener>();
  private index: IndexState = { items: [], status: 'idle' };
  private runtime: RuntimeState = { connection: 'connecting', backendConfigured: false, canSend: false, initialized: false };
  private loading = new Map<string, Promise<void>>();
  private sending = new Set<string>();
  private activeId: string | null = null;
  private listRequest = 0;
  private drafts = new Map<string, string>();
  readonly scrollPositions = new Map<string, { top: number; following: boolean }>();
  constructor(private client: ChatApi = api, private transport: (id: string, content: string) => void = () => { throw new Error('Not connected'); }) {}
  setTransport(transport: (id: string, content: string) => void) { this.transport = transport; }
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
  setRuntime(patch: Partial<RuntimeState>) {
    if (this.runtime.connection === 'connected' && patch.connection && patch.connection !== 'connected') {
      for (const [id, state] of this.conversations) {
        if (state.metadata.generation.status !== 'running') continue;
        const metadata = { ...state.metadata, generation: { ...state.metadata.generation, status: 'failed' as const, tools: [], statusText: undefined, error: 'Connection interrupted. Delivery is uncertain; history will refresh after reconnecting.' } };
        const messagesById = Object.fromEntries(Object.entries(state.messagesById).map(([key, message]) => [key, message.status === 'streaming' ? { ...message, status: 'failed' as const } : message]));
        this.conversations.set(id, { ...state, metadata, messagesById, pending: false }); this.notify(id); this.updateIndex(metadata);
      }
    }
    this.runtime = { ...this.runtime, ...patch }; this.runtimeListeners.forEach(fn => fn());
  }
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
      return previous && previous.status === message.status && previous.content === message.content && previous.echoConfirmed === message.echoConfirmed && previous.actions === message.actions && previous.blocks === message.blocks ? previous : message;
    });
    const ids = all.map(m => m.id);
    const messageIds = existing && ids.length === existing.messageIds.length && ids.every((id, index) => id === existing.messageIds[index]) ? existing.messageIds : ids;
    const messagesById = existing && messageIds === existing.messageIds && all.every(m => existing.messagesById[m.id] === m) ? existing.messagesById : Object.fromEntries(all.map(m => [m.id, m]));
    const unread = !!metadata.lastAssistantAt && metadata.lastAssistantAt > metadata.readAt && document.id !== this.activeId;
    this.conversations.set(document.id, { metadata, messagesById, messageIds, loadState: 'loaded', unread, pending: this.sending.has(document.id) || optimistic.some(m => m.status === 'sending') });
    this.notify(document.id); this.updateIndex(metadata);
    if (document.id === this.activeId && metadata.lastAssistantAt && metadata.lastAssistantAt > metadata.readAt) void this.markRead(document.id);
  }
  handleEvent = (event: ChatEvent) => {
    if (!event.conversationId || this.deleted.has(event.conversationId)) return;
    const id = event.conversationId;
    const existing = this.conversations.get(id);
    const known = this.index.items.find(item => item.id === id);
    const state = existing ?? { ...this.empty(id, 'Conversation'), ...(known ? { metadata: known } : {}) };
    const document = { ...state.metadata, messages: state.messageIds.map(key => state.messagesById[key]) };
    const updated = reduceChatEvent(document, event);
    if (updated === document) return;
    this.applyDocument(updated);
    // A realtime message is not proof that the complete persisted history loaded.
    if (!existing || existing.loadState === 'idle' || existing.loadState === 'loading') {
      const next = this.conversations.get(id)!;
      this.conversations.set(id, { ...next, loadState: existing?.loadState ?? 'idle' });
      this.notify(id);
    }
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
    if (!state?.metadata.lastAssistantAt || state.metadata.readAt >= state.metadata.lastAssistantAt) return;
    const metadata = { ...state.metadata, readAt: state.metadata.lastAssistantAt };
    this.conversations.set(id, { ...state, metadata, unread: false });
    this.notify(id); this.updateIndex(metadata);

  }
  async loadIndex() {
    const request = ++this.listRequest;
    this.index = { ...this.index, status: 'loading', error: undefined }; this.notifyIndex();
    try {
      const items = await this.client.list();
      if (request !== this.listRequest) return;
      const merged = new Map(items.filter(item => !this.deleted.has(item.id)).map(item => [item.id, item]));
      for (const [id, state] of this.conversations) {
        if (this.deleted.has(id)) continue;
        if (state.metadata.revision === 0 && !state.messageIds.length) continue;
        const incoming = merged.get(id);
        merged.set(id, incoming ? { ...state.metadata, title: incoming.title, createdAt: incoming.createdAt, updatedAt: incoming.updatedAt > state.metadata.updatedAt ? incoming.updatedAt : state.metadata.updatedAt } : state.metadata);
      }
      for (const [id, metadata] of merged) {
        const state = this.conversations.get(id);
        if (state) { this.conversations.set(id, { ...state, metadata }); this.notify(id); }
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
      try {
        const document = await this.client.get(id);
        if (document.revision === 0) this.applyHistory(document, state.metadata.revision);
        else this.applyDocument(document);
      }
      catch {
        if (this.deleted.has(id)) return;
        const latest = this.conversations.get(id)!;
        if (latest.metadata.revision > state.metadata.revision) {
          this.conversations.set(id, { ...latest, loadState: 'error', error: 'Could not load earlier messages. Live updates are still shown.' }); this.notify(id); return;
        }
        this.conversations.set(id, { ...latest, loadState: 'error', error: 'Could not load this conversation.' }); this.notify(id);
      } finally { this.loading.delete(id); }
    })();
    this.loading.set(id, promise); return promise;
  }
  async reloadKnownConversations() {
    await Promise.all([...this.conversations.keys()].map(id => this.loadConversation(id, true)));
  }
  async resync() {
    await Promise.all([this.loadIndex(), ...[...this.conversations.keys()].map(id => this.loadConversation(id, true))]);
  }
  /** Reconcile HTTP history with events received while that request was in flight. */
  private applyHistory(document: ConversationDocument, startedRevision: number) {
    if (this.deleted.has(document.id)) return;
    const current = this.conversations.get(document.id);
    const live = current?.messageIds.map(id => current.messagesById[id]) ?? [];
    const changed = !!current && current.metadata.revision > startedRevision;
    const remaining = new Set(live.map(message => message.id));
    const messages = document.messages.map(saved => {
      const match = live.find(message => remaining.has(message.id) && (message.id === saved.id || (message.role === saved.role && (message.content === saved.content || (message.role === 'assistant' && (message.status === 'streaming' || message.status === 'failed') && saved.content.startsWith(message.content))))));
      if (!match) return saved;
      remaining.delete(match.id);
      return { ...saved, actions: changed ? match.actions ?? saved.actions : saved.actions ?? match.actions, blocks: changed ? match.blocks ?? saved.blocks : saved.blocks ?? match.blocks, requestId: match.requestId, echoConfirmed: match.echoConfirmed, ...(changed && match.status === 'streaming' ? { content: match.content, status: match.status } : {}) };
    });
    for (const message of live) {
      if (remaining.has(message.id) && (changed || message.status === 'sending' || message.status === 'failed' || message.status === 'streaming')) messages.push(message);
    }
    const known = this.index.items.find(item => item.id === document.id);
    const title = known?.title || current?.metadata.title || document.title || 'Conversation';
    this.applyDocument({
      ...document, ...(current ? { readAt: current.metadata.readAt, lastAssistantAt: current.metadata.lastAssistantAt } : {}),
      title, messages, revision: (current?.metadata.revision ?? 0) + 1,
      generation: changed || current?.metadata.generation.status === 'running' ? current!.metadata.generation : document.generation,
    });
  }
  private empty(id: string, title = 'New chat'): ConversationState {
    const now = new Date().toISOString();
    return { metadata: { id, title, createdAt: now, updatedAt: now, revision: 0, generation: idleGeneration, lastAssistantAt: null, readAt: now }, messagesById: {}, messageIds: [], loadState: 'idle', unread: false, pending: false };
  }
  async createConversation(content: string) {
    const summary = await this.client.create();
    this.applyDocument({ ...summary, title: summary.title || content.slice(0, 64), messages: [] });
    return summary.id;
  }
  async send(id: string, content: string, retryRequestId?: string) {
    const state = this.conversations.get(id);
    if (!state || this.sending.has(id) || state.pending || state.metadata.generation.status === 'running' || this.deleted.has(id)) return false;
    this.sending.add(id);
    const requestId = retryRequestId ?? crypto.randomUUID();
    const existing = state.messageIds.map(key => state.messagesById[key]).find(m => m.role === 'user' && m.requestId === requestId);
    const message: Message = { id: existing?.id ?? `local:${requestId}`, conversationId: id, requestId, role: 'user', content, createdAt: existing?.createdAt ?? new Date().toISOString(), status: 'sending' };
    this.conversations.set(id, { ...state, pending: true, messagesById: { ...state.messagesById, [message.id]: message }, messageIds: existing ? state.messageIds : [...state.messageIds, message.id] });
    this.notify(id); this.updateIndex(state.metadata);
    try {
      this.transport(id, content);
      const latest = this.conversations.get(id)!;
      const metadata = { ...latest.metadata, revision: latest.metadata.revision + 1, generation: { status: 'running' as const, requestId, tools: [] } };
      this.conversations.set(id, { ...latest, metadata, pending: false });
      this.notify(id); this.updateIndex(metadata);
      return true;
    }
    catch {
      if (this.deleted.has(id)) return false;
      const latest = this.conversations.get(id)!;
      const accepted = latest.messageIds.map(key => latest.messagesById[key]).find(m => m.role === 'user' && m.requestId === requestId && m.status === 'sent');
      if (accepted) return true;
      this.conversations.set(id, { ...latest, pending: false, messagesById: { ...latest.messagesById, [message.id]: { ...message, status: 'failed' } } }); this.notify(id);
      return false;
    }
    finally {
      this.sending.delete(id);
      const latest = this.conversations.get(id);
      if (latest?.pending) { this.conversations.set(id, { ...latest, pending: false }); this.notify(id); }
    }
  }
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
