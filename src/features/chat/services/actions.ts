import type { ChatAction } from '../../../../shared/backend-types';
import { safeActionUrl } from './validation';

/** Called only by explicit user interaction. Backend owns the resolved URL. */
export function executeChatAction(action: ChatAction): void {
  if (action.type !== 'OPEN_URL' || !safeActionUrl(action.url)) return;
  switch (action.target) {
    case 'NEW_TAB': window.open(action.url, '_blank', 'noopener,noreferrer'); break;
    case 'SAME_TAB': window.location.assign(action.url); break;
  }
}
