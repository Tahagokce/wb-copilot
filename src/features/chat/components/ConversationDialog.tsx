import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { chatStore } from '../store/chat-store';
export type ConversationAction = { type: 'rename' | 'delete'; id: string; title: string };
export function ConversationDialog({ action, close, onDeleted }: { action: ConversationAction | null; close: () => void; onDeleted: (id: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (action) { setTitle(action.title); setError(''); ref.current?.showModal(); if (action.type === 'rename') ref.current?.querySelector('input')?.focus(); }
    else ref.current?.close();
  }, [action]);
  const submit = async () => {
    if (!action || busy) return;
    setBusy(true); setError('');
    try {
      if (action.type === 'rename') await chatStore.rename(action.id, title.trim());
      else { await chatStore.delete(action.id); onDeleted(action.id); }
      close();
    } catch { setError(`Could not ${action.type} this chat. Please try again.`); }
    finally { setBusy(false); }
  };
  return <dialog ref={ref} className="action-dialog" aria-labelledby="action-title" onCancel={event => { if (busy) event.preventDefault(); else close(); }} onClick={event => { if (event.target === ref.current && !busy) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="dialog-heading"><h2 id="action-title">{action?.type === 'delete' ? 'Delete this chat?' : 'Rename chat'}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={close} disabled={busy}><X size={18} /></button></div>
      {action?.type === 'delete' ? <p>“{action.title}” and its messages will be permanently deleted. Any response in progress will stop.</p> : <label className="field-label">Chat title<input autoFocus value={title} onChange={event => setTitle(event.target.value)} maxLength={100} required /></label>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button><button className={`button ${action?.type === 'delete' ? 'danger' : 'primary'}`} disabled={busy || (action?.type === 'rename' && !title.trim())}>{busy ? 'Saving…' : action?.type === 'delete' ? 'Delete chat' : 'Save'}</button></div>
    </form>
  </dialog>;
}
