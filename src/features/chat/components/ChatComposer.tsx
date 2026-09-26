import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, CornerDownLeft } from 'lucide-react';
import { chatStore } from '../store/chat-store';
export function ChatComposer({ conversationKey, disabled, generating, suggestion, onSend }: {
  conversationKey: string; disabled: boolean; generating: boolean; suggestion: { text: string; nonce: number } | null; onSend: (content: string) => void;
}) {
  const [value, setValue] = useState(() => chatStore.getDraft(conversationKey));
  const input = useRef<HTMLTextAreaElement>(null);
  const setDraft = (next: string) => { setValue(next); chatStore.setDraft(conversationKey, next); };
  useEffect(() => { if (suggestion) { setDraft(suggestion.text); input.current?.focus(); } }, [suggestion]); // mounted per conversation
  useLayoutEffect(() => { if (input.current) { input.current.style.height = 'auto'; input.current.style.height = `${Math.min(input.current.scrollHeight, 190)}px`; } }, [value]);
  const send = () => {
    if (disabled || generating || !value.trim()) return;
    onSend(value.trim()); setDraft(''); input.current?.focus();
  };
  return <div className="composer-area"><form className={`composer ${generating ? 'generating' : ''}`} onSubmit={event => { event.preventDefault(); send(); }}><label className="sr-only" htmlFor="message-input">Message WB Copilot</label><textarea id="message-input" ref={input} value={value} maxLength={16000} rows={1} placeholder="Ask WB Copilot…" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} /><div className="composer-toolbar"><span className="composer-caption">{generating ? <><span className="activity-dot" /> Response in progress in this chat</> : <>WB Copilot <span className="composer-divider">/</span> Aviation operations</>}</span><button type="submit" className="send-button" disabled={disabled || generating || !value.trim()} aria-label="Send message" title="Send message"><ArrowUp size={20} /></button></div></form><div className="composer-footnote"><span>Verify operational information against your approved systems.</span><span className="keyboard-hint"><CornerDownLeft size={11} /> Send <span>·</span> Shift + Enter for a new line</span></div></div>;
}
