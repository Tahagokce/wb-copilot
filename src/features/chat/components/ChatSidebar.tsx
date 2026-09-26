import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Check, LoaderCircle, MessageSquare, MoreHorizontal, PanelLeftClose, Plus, Search, Trash2, X } from 'lucide-react';
import { useChatIndex } from '../store/hooks';
import { chatStore } from '../store/chat-store';
import { groupConversations } from '../utils/dates';
import { Brand } from './Brand';
import { ConversationDialog, type ConversationAction } from './ConversationDialog';

export function ChatSidebar({ activeId, collapsed, mobileOpen, closeMobile, collapse, canDelete, hasHistory }: {
  activeId?: string; collapsed: boolean; mobileOpen: boolean; closeMobile: () => void; collapse: () => void; canDelete: boolean; hasHistory: boolean;
}) {
  const index = useChatIndex();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [action, setAction] = useState<ConversationAction | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [day, setDay] = useState(new Date());
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { const timer = setInterval(() => setDay(new Date()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (mobileOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [mobileOpen]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 761px)');
    const changed = () => { if (desktop.matches) closeMobile(); };
    desktop.addEventListener('change', changed);
    return () => desktop.removeEventListener('change', changed);
  }, [closeMobile]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.conversation-menu')) setMenu(null); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !collapsed && !mobileOpen) { event.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', keydown); };
  }, [collapsed, mobileOpen]);
  const filtered = index.items.filter(item => item.title.toLocaleLowerCase().includes(deferredQuery.toLocaleLowerCase()));
  const content = (mobile: boolean) => <>
    <div className="sidebar-brand"><Link to="/chat" className="brand-link" onClick={closeMobile}><Brand small /><span>WB Copilot</span></Link><button className="icon-button muted" aria-label={mobile ? 'Close navigation' : 'Collapse sidebar'} onClick={mobile ? closeMobile : collapse}>{mobile ? <X size={18} /> : <PanelLeftClose size={18} />}</button></div>
    <Link className="new-chat" to="/chat" onClick={() => { closeMobile(); setMenu(null); }}><Plus size={19} /><span>New chat</span><span className="new-chat-hint"><ArrowUpRight size={15} /></span></Link>
    <label className="chat-search"><Search size={16} /><input ref={mobile ? undefined : search} aria-label="Search chats" placeholder="Search chats" value={query} onChange={event => setQuery(event.target.value)} /><kbd>⌘ K</kbd></label>
    <nav className="conversation-navigation" aria-label="Conversation history">
      {!hasHistory && index.status === 'idle' && !index.items.length && <div className="sidebar-empty"><MessageSquare size={23} /><p>No chats loaded</p><span>Chat history will be available when the backend connection is configured.</span></div>}
      {index.status === 'loading' && !index.items.length && <div className="history-skeleton" aria-label="Loading chat history"><span /><span /><span /></div>}
      {index.status === 'error' && <div className="sidebar-notice" role="alert"><p>{index.error}</p><button className="text-button" onClick={() => void chatStore.loadIndex()}>Try again</button></div>}
      {index.status === 'loaded' && !filtered.length && <div className="sidebar-empty"><MessageSquare size={23} /><p>{query ? 'No matching chats' : 'A fresh start'}</p><span>{query ? 'Try a different title.' : 'Your conversations will appear here.'}</span></div>}
      {groupConversations(filtered, day).map(([label, conversations]) => <section className="conversation-group" key={label}><h2>{label}</h2><ul>{conversations.map(item => {
        const unread = item.id !== activeId && !!item.lastAssistantAt && item.lastAssistantAt > item.readAt;
        return <li key={item.id} className={`conversation-item ${activeId === item.id ? 'active' : ''}`}>
          <Link to={`/chat/${item.id}`} onClick={() => { closeMobile(); setMenu(null); }} aria-current={activeId === item.id ? 'page' : undefined} title={item.title}><span>{item.title}</span>{item.generation.status === 'running' ? <LoaderCircle size={14} className="spin" aria-label="Generating response" /> : unread ? <span className="unread-dot" role="img" aria-label="New response" /> : null}</Link>
          {canDelete && <div className="conversation-menu"><button className="icon-button" aria-label={`Actions for ${item.title}`} aria-expanded={menu === item.id} aria-haspopup="true" onClick={() => setMenu(menu === item.id ? null : item.id)}><MoreHorizontal size={17} /></button>
            {menu === item.id && <div className="overflow-menu">{canDelete && <button className="delete-action" onClick={() => { setMenu(null); setAction({ type: 'delete', id: item.id, title: item.title }); }}><Trash2 size={15} />Delete</button>}</div>}
          </div>}
        </li>;
      })}</ul></section>)}
    </nav>
    <div className="sidebar-footer"><div className="workspace-avatar">WB</div><div><strong>Operations workspace</strong><span>Weight & balance</span></div><Check size={15} className="workspace-check" /></div>
  </>;
  return <>
    {!collapsed && <aside className="sidebar desktop-sidebar">{content(false)}</aside>}
    <dialog ref={dialog} className="mobile-drawer" aria-label="Chat navigation" onCancel={closeMobile} onClick={event => { if (event.target === dialog.current) closeMobile(); }}><div className="sidebar">{content(true)}</div></dialog>
    <ConversationDialog action={action} close={() => setAction(null)} onDeleted={id => { if (activeId === id) navigate('/chat'); }} />
  </>;
}
