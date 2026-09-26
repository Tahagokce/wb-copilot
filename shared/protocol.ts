/** Frontend model, not a protocol imposed on the existing backend. */
export interface Message {
  id: string;
  conversationId: string;
  requestId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status: 'sending' | 'sent' | 'streaming' | 'completed' | 'failed';
  /** Frontend-only marker for a BE USER_MESSAGE echo without a message ID. */
  echoConfirmed?: boolean;
}
export interface ToolExecution {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'failed';
}
export interface Generation {
  status: 'idle' | 'running' | 'completed' | 'failed';
  requestId: string | null;
  tools: ToolExecution[];
  error?: string;
  statusText?: string;
}
export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  generation: Generation;
  lastAssistantAt: string | null;
  readAt: string;
}
export interface ConversationDocument extends ConversationSummary { messages: Message[] }
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'offline' | 'error';
export const idleGeneration: Generation = { status: 'idle', requestId: null, tools: [] };
