import type { ChatUiBlock, TableColumnType, TableColumn, TableRow, ChatAction, ChatEvent, ChatEventType, Conversation, ConversationMessage } from '../../../../shared/backend-types';

export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const identifier = (value: unknown): value is string => text(value) && value.trim().length > 0;
const date = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const eventTypes: readonly ChatEventType[] = ['USER_MESSAGE', 'ASSISTANT_STARTED', 'ASSISTANT_STATUS', 'ASSISTANT_DELTA', 'ASSISTANT_COMPLETED', 'UI_BLOCK', 'ACTIONS', 'TOOL_STARTED', 'TOOL_COMPLETED', 'ERROR'];
export function parseChatEvent(value: unknown): ChatEvent | null {
  if (!isRecord(value) || !eventTypes.some(type => type === value.type)
    || !(value.conversationId === null || identifier(value.conversationId))
    || !(value.content == null || text(value.content))) return null;
  return { type: value.type as ChatEventType, conversationId: value.conversationId, content: value.content ?? null, ...(value.type === 'UI_BLOCK' ? { block: parseUiBlock(value.block) } : {}), ...(value.type === 'ACTIONS' ? { actions: parseActions(value.actions) } : {}) };
}
/** Drop unsupported or malformed actions individually without losing valid siblings. */
export function parseActions(value: unknown): ChatAction[] {
  if (!Array.isArray(value)) return [];
  const actions = new Map<string, ChatAction>();
  for (const item of value) {
    if (!isRecord(item) || !identifier(item.id) || item.type !== 'OPEN_URL'
      || !identifier(item.label) || !text(item.url) || !safeActionUrl(item.url)
      || (item.target !== 'SAME_TAB' && item.target !== 'NEW_TAB')
      || (item.icon !== undefined && !text(item.icon))) continue;
    actions.set(item.id, { id: item.id, type: item.type, label: item.label, url: item.url,
      target: item.target, ...(item.icon !== undefined ? { icon: item.icon } : {}) });
  }
  return [...actions.values()];
}
export function safeActionUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; }
  catch { return false; }
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
  return value.map(message => ({ ...message, ...(message.blocks !== undefined ? { blocks: parseUiBlocks(message.blocks) } : {}), ...(message.actions !== undefined ? { actions: parseActions(message.actions) } : {}) }));
}

const columnTypes: readonly TableColumnType[] = ['TEXT', 'NUMBER', 'DATE', 'DATETIME', 'BOOLEAN', 'STATUS'];
export function parseUiBlock(value: unknown): ChatUiBlock | undefined {
  if (!isRecord(value) || value.type !== 'TABLE' || !identifier(value.id)
    || !Array.isArray(value.columns) || !Array.isArray(value.rows)) return undefined;
  const columns = new Map<string, TableColumn>();
  for (const column of value.columns) {
    if (!isRecord(column) || !identifier(column.key) || !text(column.label)) continue;
    const type = columnTypes.find(type => type === column.type) ?? 'TEXT';
    columns.set(column.key, { key: column.key, label: column.label, type });
  }
  const rows = new Map<string, TableRow>();
  for (const row of value.rows) {
    if (!isRecord(row) || !identifier(row.id) || !isRecord(row.values)) continue;
    rows.set(row.id, { id: row.id, values: row.values, ...(row.actions !== undefined ? { actions: parseActions(row.actions) } : {}) });
  }
  return { id: value.id, type: 'TABLE', columns: [...columns.values()], rows: [...rows.values()],
    ...(text(value.title) ? { title: value.title } : {}), searchable: value.searchable === true,
    pageSize: typeof value.pageSize === 'number' && Number.isSafeInteger(value.pageSize) && value.pageSize > 0 ? value.pageSize : 10 };
}
export function parseUiBlocks(value: unknown): ChatUiBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks = new Map<string, ChatUiBlock>();
  for (const item of value) { const block = parseUiBlock(item); if (block) blocks.set(block.id, block); }
  return [...blocks.values()];
}
