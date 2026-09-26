import type { ChatEvent } from '../../../../shared/backend-types';
import type { ConversationDocument, Message } from '../../../../shared/protocol';

/** Reduce exactly one BE event into its own conversation; never consult the route. */
export function reduceChatEvent(current: ConversationDocument, event: ChatEvent): ConversationDocument {
  if (event.conversationId !== current.id) return current;
  const now = new Date().toISOString();
  const document: ConversationDocument = {
    ...current, revision: current.revision + 1,
    messages: [...current.messages], generation: { ...current.generation, tools: [...current.generation.tools] },
  };
  const begin = () => {
    if (document.generation.status === 'running') return;
    const user = document.messages.findLast(message => message.role === 'user');
    document.generation = { status: 'running', requestId: user?.requestId ?? crypto.randomUUID(), tools: [] };
  };
  const assistant = () => document.messages.findLast(message => message.role === 'assistant' && message.requestId === document.generation.requestId && message.status === 'streaming');
  const writeAssistant = (content: string, status: Message['status']) => {
    const existing = assistant();
    const message: Message = {
      id: existing?.id ?? crypto.randomUUID(), conversationId: document.id,
      requestId: document.generation.requestId ?? crypto.randomUUID(), role: 'assistant',
      content, createdAt: existing?.createdAt ?? now, status,
    };
    if (existing) document.messages = document.messages.map(item => item.id === existing.id ? message : item);
    else document.messages.push(message);
  };
  switch (event.type) {
    case 'USER_MESSAGE': {
      if (event.content === null) return current;
      // An echo acknowledges the optimistic send. Without a BE message ID, do not
      // guess that other equal-content messages are duplicates.
      const optimistic = document.messages.find(message => message.role === 'user' && message.content === event.content && message.id.startsWith('local:') && !message.echoConfirmed);
      if (optimistic) document.messages = document.messages.map(message => message.id === optimistic.id ? { ...message, status: 'sent', echoConfirmed: true } : message);
      else document.messages.push({ id: crypto.randomUUID(), requestId: crypto.randomUUID(), conversationId: document.id, role: 'user', content: event.content, createdAt: now, status: 'sent' });
      if (!document.title || document.title === 'New chat' || document.title === 'Conversation') document.title = event.content.slice(0, 64);
      document.updatedAt = now;
      break;
    }
    case 'ASSISTANT_STARTED':
      begin();
      document.messages = document.messages.map(message => message.role === 'user' && message.requestId === document.generation.requestId ? { ...message, status: 'sent' } : message);
      if (!assistant()) writeAssistant('', 'streaming');
      if (event.content !== null) document.generation.statusText = event.content;
      break;
    case 'ASSISTANT_STATUS':
      begin(); document.generation.statusText = event.content ?? undefined;
      break;
    case 'ASSISTANT_DELTA':
      if (event.content === null) return current;
      begin(); writeAssistant((assistant()?.content ?? '') + event.content, 'streaming');
      break;
    case 'ASSISTANT_COMPLETED': {
      const last = document.messages.at(-1);
      if (document.generation.status === 'completed' && last?.role === 'assistant' && (event.content === null || event.content === last.content)) return current;
      begin();
      const content = event.content ?? assistant()?.content;
      if (content !== undefined) writeAssistant(content, 'completed');
      document.generation = { ...document.generation, status: 'completed', statusText: undefined, tools: document.generation.tools.filter(tool => tool.status === 'completed') };
      document.updatedAt = now;
      // Local activity timestamp, not a claimed BE sequence or job timestamp.
      document.lastAssistantAt = new Date(Math.max(Date.now(), Date.parse(document.readAt) + 1)).toISOString();
      break;
    }
    case 'TOOL_STARTED':
      begin();
      document.generation.tools.push({ id: crypto.randomUUID(), label: event.content ?? 'Tool running', status: 'running' });
      break;
    case 'TOOL_COMPLETED': {
      begin();
      const running = document.generation.tools.filter(tool => tool.status === 'running');
      const tool = running.find(item => item.label === event.content) ?? (running.length === 1 ? running[0] : undefined);
      if (tool) document.generation.tools = document.generation.tools.map(item => item.id === tool.id ? { ...item, label: event.content ?? item.label, status: 'completed' } : item);
      else document.generation.tools.push({ id: crypto.randomUUID(), label: event.content ?? 'Tool completed', status: 'completed' });
      break;
    }
    case 'ERROR': {
      const partial = assistant();
      if (partial) writeAssistant(partial.content, 'failed');
      document.generation = { ...document.generation, status: 'failed', statusText: undefined, tools: [], error: event.content || 'The response could not be completed. Please try again.' };
      break;
    }
  }
  return document;
}
