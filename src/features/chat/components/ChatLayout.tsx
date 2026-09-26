import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Menu, PanelLeftOpen, Plus, ShieldCheck } from 'lucide-react';
import { chatStore } from '../store/chat-store';
import { backendCapabilities } from '../services/backend-config';
import { useConversation, useRuntime } from '../store/hooks';
import { ChatSidebar } from './ChatSidebar';
import { ConnectionStatus } from './ConnectionStatus';
import { EmptyConversation } from './EmptyConversation';
import { ChatComposer } from './ChatComposer';
import { MessageList } from './MessageList';

export function ChatLayout() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const currentLocation = useRef(location.key);
  currentLocation.current = location.key;
  const creating = useRef(false);
  const [creation, setCreation] = useState<{ content: string; error?: string } | null>(null);
  const conversation = useConversation(conversationId ?? '');
  const runtime = useRuntime();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('wb-sidebar-collapsed') === 'true'; } catch { return false; } });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<{ text: string; nonce: number } | null>(null);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const collapse = () => { setCollapsed(value => { try { localStorage.setItem('wb-sidebar-collapsed', String(!value)); } catch { /* Device preference only. */ } return !value; }); };
  useEffect(() => {
    chatStore.setActive(conversationId ?? null);
    setMobileOpen(false); setSuggestion(null);
    if (conversationId && runtime.initialized) void chatStore.loadConversation(conversationId);
    return () => chatStore.setActive(null);
  }, [conversationId, runtime.initialized]);
  useEffect(() => { if (conversationId && chatStore.isDeleted(conversationId)) navigate('/chat', { replace: true }); }, [conversation, conversationId, navigate]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); navigate('/chat'); } };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [navigate]);
  const send = async (content: string) => {
    if (conversationId) { await chatStore.send(conversationId, content); return; }
    if (creating.current) return;
    creating.current = true;
    const origin = currentLocation.current;
    setCreation({ content });
    try {
      const id = await chatStore.createConversation(content);
      if (currentLocation.current === origin) { chatStore.setActive(id); navigate(`/chat/${encodeURIComponent(id)}`); }
      await chatStore.send(id, content);
      setCreation(null);
    } catch { setCreation({ content, error: 'Could not create this chat. Please retry.' }); }
    finally { creating.current = false; }
  };
  const unavailable = !runtime.canSend || !runtime.initialized || runtime.connection !== 'connected' || !!conversation?.error;
  return <div className="chat-layout"><a className="skip-link" href="#message-input">Skip to message composer</a><ChatSidebar activeId={conversationId} collapsed={collapsed} collapse={collapse} canDelete={backendCapabilities.delete} hasHistory={backendCapabilities.history} mobileOpen={mobileOpen} closeMobile={closeMobile} /><main className="chat-main"><header className="chat-header"><div className="header-start"><button className="icon-button mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={21} /></button>{collapsed && <button className="icon-button desktop-expand" aria-label="Expand sidebar" onClick={collapse}><PanelLeftOpen size={20} /></button>}<div className="header-title"><span>WB Copilot</span><span className="header-separator">/</span><span className="current-title">{conversationId ? conversation?.metadata.title ?? 'Conversation' : 'New conversation'}</span></div></div><div className="header-actions"><span className={`service-status ${runtime.connection === 'connected' ? 'available' : ''}`} title={runtime.connection === 'connected' ? 'Listening to the backend' : 'Backend connection is unavailable'}><span />{runtime.connection === 'connected' ? 'Connected' : 'Not connected'}</span><button className="icon-button header-new-chat" aria-label="New chat" onClick={() => navigate('/chat')}><Plus size={19} /></button></div></header><ConnectionStatus />
    <div className={`conversation-surface ${!conversationId ? 'is-empty' : ''}`}>{conversationId ? <MessageList key={`messages:${conversationId}`} id={conversationId} state={conversation} retryDisabled={unavailable} /> : creation ? <div className="message-list"><p>{creation.content}</p>{creation.error ? <p role="alert">{creation.error} <button onClick={() => void send(creation.content)}>Retry</button></p> : <p role="status">Creating conversation…</p>}</div> : <EmptyConversation onSuggest={text => setSuggestion({ text, nonce: Date.now() })} />}
      <ChatComposer key={`composer:${conversationId ?? 'new'}`} conversationKey={conversationId ?? 'new'} suggestion={suggestion} disabled={(!conversationId && !!creation && !creation.error) || unavailable || !!conversation?.pending || (!!conversationId && !conversation)} generating={conversation?.metadata.generation.status === 'running'} onSend={send} />
      {!conversationId && <div className="welcome-footnote"><ShieldCheck size={13} /><span>Built for focused operations.</span></div>}
    </div></main></div>;
}
