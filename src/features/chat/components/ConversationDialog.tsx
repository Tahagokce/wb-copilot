import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { chatStore } from '../store/chat-store';
export type ConversationAction = { type: 'delete'; id: string; title: string };
export function ConversationDialog({ action, close, onDeleted }: { action: ConversationAction | null; close: () => void; onDeleted: (id: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (action) { setError(''); ref.current?.showModal(); }
    else ref.current?.close();
  }, [action]);
  const submit = async () => {
    if (!action || busy) return;
    setBusy(true); setError('');
    try {
      { await chatStore.delete(action.id); onDeleted(action.id); }
      close();
    } catch { setError(`Could not ${action.type} this chat. Please try again.`); }
    finally { setBusy(false); }
  };
  return <dialog ref={ref} className="action-dialog" aria-labelledby="action-title" onCancel={event => { if (busy) event.preventDefault(); else close(); }} onClick={event => { if (event.target === ref.current && !busy) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="dialog-heading"><h2 id="action-title">{action?.type === 'delete' ? 'Delete this chat?' : 'Rename chat'}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={close} disabled={busy}><X size={18} /></button></div>
      <p>“{action?.title}” and its messages will be permanently deleted.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button><button className={`button ${action?.type === 'delete' ? 'danger' : 'primary'}`} disabled={busy}>{busy ? 'Saving…' : action?.type === 'delete' ? 'Delete chat' : 'Save'}</button></div>
    </form>
  </dialog>;
}
