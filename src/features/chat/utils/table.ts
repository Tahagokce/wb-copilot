import type { TableBlock, TableColumnType } from '../../../../shared/backend-types';

const fallback = '—';
export function formatTableValue(value: unknown, type: TableColumnType, locale?: string): string {
  if (value === null || value === undefined || value === '') return fallback;
  switch (type) {
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat(locale).format(value) : fallback;
    case 'BOOLEAN': return typeof value === 'boolean' ? value ? 'Yes' : 'No' : fallback;
    case 'DATE':
    case 'DATETIME': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return fallback;
      const calendar = value.slice(0, 10);
      const day = new Date(calendar + 'T00:00:00Z');
      if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== calendar) return fallback;
      const date = type === 'DATE' ? day : new Date(value);
      if (!Number.isFinite(date.getTime())) return fallback;
      return new Intl.DateTimeFormat(locale, type === 'DATE'
        ? { dateStyle: 'medium', timeZone: 'UTC' }
        : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    }
    default: return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? String(value) : fallback;
  }
}

export function tablePage(block: TableBlock, query: string, requestedPage: number) {
  const needle = block.searchable ? query.trim().toLocaleLowerCase() : '';
  const filtered = needle ? block.rows.filter(row => block.columns.some(column =>
    formatTableValue(Object.hasOwn(row.values, column.key) ? row.values[column.key] : undefined, column.type).toLocaleLowerCase().includes(needle))) : block.rows;
  const size = Number.isSafeInteger(block.pageSize) && block.pageSize! > 0 ? block.pageSize! : 10;
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const page = Math.max(1, Math.min(pages, requestedPage));
  return { rows: filtered.slice((page - 1) * size, page * size), total: filtered.length, page, pages };
}
export type TableNavigation = { query: string; page: number };
export function tableNavigation(state: TableNavigation, event: { type: 'search'; query: string } | { type: 'page'; page: number }): TableNavigation {
  return event.type === 'search' ? { query: event.query, page: 1 } : { ...state, page: event.page };
}
