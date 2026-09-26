import type { ConversationSummary } from '../../../../shared/protocol';
export function groupConversations(items: ConversationSummary[], now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const groups = new Map<string, ConversationSummary[]>();
  for (const item of items) {
    const date = new Date(item.updatedAt);
    const days = Math.round((Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) - Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
    const label = days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'Previous 7 Days' : days < 30 ? 'Previous 30 Days' : 'Older';
    const group = groups.get(label) ?? []; group.push(item); groups.set(label, group);
  }
  return [...groups.entries()];
}
