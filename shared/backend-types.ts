export type ChatActionType = 'OPEN_URL';
export type ChatActionTarget = 'SAME_TAB' | 'NEW_TAB';
export interface ChatAction {
  id: string;
  type: ChatActionType;
  label: string;
  icon?: string;
  url: string;
  target: ChatActionTarget;
}
/** DTOs supplied by the existing backend. Keep their field names and nullability. */
export type ChatEventType =
  | 'USER_MESSAGE' | 'ASSISTANT_STARTED' | 'ASSISTANT_STATUS'
  | 'ASSISTANT_DELTA' | 'ASSISTANT_COMPLETED'
  | 'UI_BLOCK' | 'ACTIONS' | 'TOOL_STARTED' | 'TOOL_COMPLETED' | 'ERROR';
export interface ChatEvent {
  type: ChatEventType;
  conversationId: string | null;
  content: string | null;
  actions?: ChatAction[];
  block?: ChatUiBlock;
}
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; error?: boolean }
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
export type MessageRole = 'USER' | 'ASSISTANT';
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string }
export interface ConversationMessage { id: string; role: MessageRole; content: string; createdAt: string; actions?: ChatAction[]; blocks?: ChatUiBlock[] }

export type ChatUiBlockType = 'TABLE';
export type TableColumnType = 'TEXT' | 'NUMBER' | 'DATE' | 'DATETIME' | 'BOOLEAN' | 'STATUS';
export interface TableColumn { key: string; label: string; type: TableColumnType }
export interface TableRow { id: string; values: Record<string, unknown>; actions?: ChatAction[] }
export interface TableBlock {
  id: string;
  type: 'TABLE';
  title?: string;
  columns: TableColumn[];
  rows: TableRow[];
  searchable?: boolean;
  pageSize?: number;
}
export type ChatUiBlock = TableBlock;
