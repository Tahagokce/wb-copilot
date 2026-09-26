import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, CircleAlert, RotateCcw } from 'lucide-react';
import type { Message } from '../../../../shared/protocol';
import { chatStore, type ConversationState } from '../store/chat-store';
import { MessageRenderer } from './MessageRenderer';
import { ToolExecution } from './ToolExecution';
export function MessageList({ id, state, retryDisabled }: { id: string; state?: ConversationState; retryDisabled: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(chatStore.scrollPositions.get(id)?.following ?? true);
  const [newMessages, setNewMessages] = useState(false);
  const retry = useCallback((message: Message) => { void chatStore.send(id, message.content, message.requestId); }, [id]);
  const latest = () => { if (container.current) container.current.scrollTop = container.current.scrollHeight; following.current = true; setNewMessages(false); };
  useLayoutEffect(() => {
    const saved = chatStore.scrollPositions.get(id);
    if (saved && container.current) container.current.scrollTop = saved.top;
    else latest();
    const element = container.current;
    return () => { if (element) chatStore.scrollPositions.set(id, { top: element.scrollTop, following: following.current }); };
  }, [id]);
  useLayoutEffect(() => {
    if (following.current) latest();
    else if (state?.messageIds.length) setNewMessages(true);
  }, [state?.messagesById, state?.metadata.generation.status]);
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (following.current) latest(); });
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  const generation = state?.metadata.generation;
  const retryMessage = state && state.messageIds.map(key => state.messagesById[key]).find(message => message.role === 'user' && message.requestId === generation?.requestId);
  return <div className="message-list-shell"><div className="message-scroll" ref={container} onScroll={() => {
    const element = container.current;
    if (!element) return;
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
    chatStore.scrollPositions.set(id, { top: element.scrollTop, following: following.current });
    if (following.current) setNewMessages(false);
  }}><div className="message-column" ref={content}>
    {!state || (state.loadState === 'loading' && !state.messageIds.length) ? <div className="message-skeleton" aria-label="Loading conversation"><span /><span /><span /></div> : null}
    {state?.error && <div className="inline-error" role="alert"><CircleAlert size={18} /><div><p>{state.error}</p><button className="text-button" onClick={() => void chatStore.loadConversation(id, true)}>Try again</button></div></div>}
    {state?.messageIds.map(key => <MessageRenderer key={key} message={state.messagesById[key]} retry={retry} retryDisabled={retryDisabled || state.pending || generation?.status === 'running'} />)}
    {generation && <ToolExecution generation={generation} />}
    {generation?.status === 'failed' && <div className="inline-error generation-error" role="alert"><CircleAlert size={18} /><div><p>{generation.error}</p>{retryMessage && <button className="text-button" disabled={retryDisabled || state?.pending} onClick={() => retry(retryMessage)}><RotateCcw size={14} />Retry response</button>}</div></div>}
  </div></div>{newMessages && <button className="new-messages" onClick={latest}><ArrowDown size={15} />New messages</button>}</div>;
}
