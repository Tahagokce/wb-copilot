import { ExternalLink, FileText, Plane } from 'lucide-react';
import type { ChatAction } from '../../../../shared/backend-types';
import { executeChatAction } from '../services/actions';
import { parseActions } from '../services/validation';

export function ChatActions({ actions }: { actions?: ChatAction[] }) {
  const supported = parseActions(actions);
  if (!supported.length) return null;
  return <div className="chat-actions" role="group" aria-label="Response actions">{supported.map(action => {
    const Icon = action.icon === 'plane' ? Plane : action.icon === 'file-text' ? FileText : ExternalLink;
    return <button key={action.id} type="button" className="chat-action-button" onClick={() => executeChatAction(action)}>
      <Icon size={16} aria-hidden="true" /><span>{action.label}</span>
      {action.target === 'NEW_TAB' && <span className="sr-only"> (opens in a new tab)</span>}
    </button>;
  })}</div>;
}
