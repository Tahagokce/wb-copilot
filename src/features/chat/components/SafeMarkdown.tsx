import { Fragment, type ReactNode } from 'react';

/** Intentionally small Markdown subset. Everything is React text, never raw HTML. */
function safeHref(href: string): string | undefined {
  if (/[\u0000-\u0020\u007f]/.test(href)) return undefined;
  if (href.startsWith('#') || (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\'))) return href;
  try { const url = new URL(href); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}
function inline(text: string, depth = 0): ReactNode {
  if (depth > 5) return text;
  const parts: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    parts.push(text.slice(cursor, start));
    const value = match[0];
    let node: ReactNode;
    if (value.startsWith('`')) node = <code>{value.slice(1, -1)}</code>;
    else if (value.startsWith('**') || value.startsWith('__')) node = <strong>{inline(value.slice(2, -2), depth + 1)}</strong>;
    else if (value.startsWith('*')) node = <em>{inline(value.slice(1, -1), depth + 1)}</em>;
    else {
      const end = value.indexOf('](');
      const label = value.slice(1, end);
      const href = safeHref(value.slice(end + 2, -1));
      node = href ? <a href={href} target="_blank" rel="noreferrer noopener">{label}</a> : label;
    }
    parts.push(<Fragment key={start}>{node}</Fragment>);
    cursor = start + value.length;
  }
  parts.push(text.slice(cursor));
  return parts;
}
const listItem = (line: string) => /^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/.exec(line);
const tableCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
const tableDivider = (line: string) => line.includes('|') && tableCells(line).every(cell => /^:?-{3,}:?$/.test(cell));
const isBlock = (line: string) => /^\s*```/.test(line) || /^#{1,6}\s/.test(line) || /^>\s?/.test(line) || !!listItem(line);
export function SafeMarkdown({ content, renderCode }: { content: string; renderCode: (code: string, language: string) => ReactNode }) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const key = index;
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const fence = /^\s*```([^`]*)$/.exec(line);
    if (fence) {
      const code: string[] = []; index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<Fragment key={key}>{renderCode(code.join('\n'), fence[1].trim())}</Fragment>); continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const text = inline(heading[2]);
      const Heading = `h${heading[1].length}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Heading key={key}>{text}</Heading>); index++; continue;
    }
    if (index + 1 < lines.length && line.includes('|') && tableDivider(lines[index + 1])) {
      const headers = tableCells(line); index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) rows.push(tableCells(lines[index++]));
      blocks.push(<div className="table-scroll" key={key}><table><thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{inline(row[cellIndex] ?? '')}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    const firstItem = listItem(line);
    if (firstItem) {
      const ordered = !!firstItem[2]; const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = listItem(lines[index]); if (!item || !!item[2] !== ordered) break;
        items.push(<li key={index}>{inline(item[3])}</li>); index++;
      }
      blocks.push(ordered ? <ol key={key} start={Number(firstItem[2])}>{items}</ol> : <ul key={key}>{items}</ul>); continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key}>{inline(quote.join('\n'))}</blockquote>); continue;
    }
    const paragraph = [line]; index++;
    while (index < lines.length && lines[index].trim() && !isBlock(lines[index]) && !(index + 1 < lines.length && tableDivider(lines[index + 1]))) paragraph.push(lines[index++]);
    blocks.push(<p key={key}>{inline(paragraph.join('\n'))}</p>);
  }
  return blocks;
}
