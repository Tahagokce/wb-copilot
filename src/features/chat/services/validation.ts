import type { ChatEvent, ChatEventType, Conversation, ConversationMessage } from '../../../../shared/backend-types';

export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const identifier = (value: unknown): value is string => text(value) && value.trim().length > 0;
const date = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const eventTypes: readonly ChatEventType[] = ['USER_MESSAGE', 'ASSISTANT_STARTED', 'ASSISTANT_STATUS', 'ASSISTANT_DELTA', 'ASSISTANT_COMPLETED', 'TOOL_STARTED', 'TOOL_COMPLETED', 'ERROR'];
export function parseChatEvent(value: unknown): ChatEvent | null {
  if (!isRecord(value) || !eventTypes.some(type => type === value.type)
    || !(value.conversationId === null || identifier(value.conversationId))
    || !(value.content == null || text(value.content))) return null;
  return { type: value.type as ChatEventType, conversationId: value.conversationId, content: value.content ?? null };
}
function isConversation(value: unknown): value is Conversation {
  return isRecord(value) && identifier(value.id) && text(value.title) && date(value.createdAt) && date(value.updatedAt);
}
function isMessage(value: unknown): value is ConversationMessage {
  return isRecord(value) && identifier(value.id) && (value.role === 'USER' || value.role === 'ASSISTANT') && text(value.content) && date(value.createdAt);
}
export function parseConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value) || !value.every(isConversation) || new Set(value.map(item => item.id)).size !== value.length) {
    throw new Error('The backend conversation list could not be understood.');
  }
  return value;
}
export function parseMessages(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value) || !value.every(isMessage) || new Set(value.map(item => item.id)).size !== value.length) {
    throw new Error('The backend conversation history could not be understood.');
  }
  return value;
}
