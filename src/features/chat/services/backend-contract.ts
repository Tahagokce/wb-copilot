import type { ConversationDocument, ConversationSummary } from '../../../../shared/protocol';
import type { ChatEvent } from '../../../../shared/backend-types';
import { parseChatEvent, parseConversations, parseMessages } from './validation';

export interface BackendContract {
  decodeHistory: (payload: unknown) => ConversationSummary[];
  decodeConversation: (payload: unknown, conversationId: string) => ConversationDocument;
  decodeEvent: (payload: unknown) => ChatEvent | null;
}
const epoch = new Date(0).toISOString();
/** Known BE DTOs map to frontend state here. HTTP history is independent of the realtime transport. */
export const backendContract: BackendContract = {
  decodeHistory: payload => parseConversations(payload).map(conversation => ({
    ...conversation, revision: 0, generation: { status: 'idle', requestId: null, tools: [] },
    lastAssistantAt: null, readAt: epoch,
  })),
  decodeConversation: (payload, conversationId) => {
    let requestId = '';
    const messages = parseMessages(payload).map(message => {
      if (message.role === 'USER' || !requestId) requestId = message.id;
      return { ...message, conversationId, requestId, role: message.role === 'USER' ? 'user' as const : 'assistant' as const, status: message.role === 'USER' ? 'sent' as const : 'completed' as const };
    });
    return {
      id: conversationId, title: '', createdAt: messages[0]?.createdAt ?? epoch,
      updatedAt: messages.at(-1)?.createdAt ?? epoch, revision: 0,
      generation: { status: 'idle', requestId: null, tools: [] },
      lastAssistantAt: null, readAt: epoch, messages,
    };
  },
  decodeEvent: parseChatEvent,
};
