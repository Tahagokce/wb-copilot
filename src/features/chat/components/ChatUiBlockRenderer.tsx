import type { ChatUiBlock } from '../../../../shared/backend-types';
import { TableBlockView } from './TableBlockView';

export function ChatUiBlockRenderer({ block }: { block: ChatUiBlock }) {
  switch (block.type) {
    case 'TABLE': return <TableBlockView block={block} />;
    default: return null;
  }
}
