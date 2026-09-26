/** DTOs supplied by the existing backend. Keep their field names and nullability. */
export type ChatEventType =
  | 'USER_MESSAGE' | 'ASSISTANT_STARTED' | 'ASSISTANT_STATUS'
  | 'ASSISTANT_DELTA' | 'ASSISTANT_COMPLETED'
  | 'TOOL_STARTED' | 'TOOL_COMPLETED' | 'ERROR';
export interface ChatEvent {
  type: ChatEventType;
  conversationId: string | null;
  content: string | null;
}
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; error?: boolean }
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
export type MessageRole = 'USER' | 'ASSISTANT';
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string }
export interface ConversationMessage { id: string; role: MessageRole; content: string; createdAt: string }
