import { useId, useMemo, useReducer } from 'react';
import type { TableBlock } from '../../../../shared/backend-types';
import { formatTableValue, tableNavigation, tablePage } from '../utils/table';
import { ChatActions } from './ChatActions';

export function TableBlockView({ block }: { block: TableBlock }) {
  const labelId = useId();
  const [navigation, dispatch] = useReducer(tableNavigation, { query: '', page: 1 });
  const result = useMemo(() => tablePage(block, navigation.query, navigation.page), [block, navigation]);
  const hasActions = block.rows.some(row => row.actions?.length);
  return <section className="table-block" aria-labelledby={labelId}>
    <div className="table-block-toolbar"><h3 id={labelId}>{block.title || 'Results'}</h3>
      {block.searchable && <input type="search" aria-label={`Search ${block.title || 'results'}`} placeholder="Search results…" value={navigation.query}
        onChange={event => dispatch({ type: 'search', query: event.target.value })} />}
    </div>
    <div className="table-block-scroll" tabIndex={0} role="region" aria-label={`${block.title || 'Results'} table`}>
      <table><thead><tr>{block.columns.map(column => <th scope="col" key={column.key}>{column.label}</th>)}{hasActions && <th scope="col">Actions</th>}</tr></thead>
        <tbody>{result.rows.map(row => <tr key={row.id}>{block.columns.map(column => {
          const value = formatTableValue(Object.hasOwn(row.values, column.key) ? row.values[column.key] : undefined, column.type);
          return <td key={column.key}>{column.type === 'STATUS' && value !== '—' ? <span className="table-status">{value}</span> : value}</td>;
        })}{hasActions && <td><ChatActions actions={row.actions} /></td>}</tr>)}
          {!result.rows.length && <tr><td colSpan={Math.max(1, block.columns.length + Number(hasActions))} className="table-empty">No results</td></tr>}
        </tbody>
      </table>
    </div>
    {result.pages > 1 && <nav className="table-pagination" aria-label={`${block.title || 'Results'} pagination`}>
      <button type="button" disabled={result.page === 1} onClick={() => dispatch({ type: 'page', page: result.page - 1 })}>Previous</button>
      <span role="status">{result.page} / {result.pages} · {result.total} results</span>
      <button type="button" disabled={result.page === result.pages} onClick={() => dispatch({ type: 'page', page: result.page + 1 })}>Next</button>
    </nav>}
  </section>;
}
