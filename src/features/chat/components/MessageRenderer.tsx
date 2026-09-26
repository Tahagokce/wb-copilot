import { memo, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, RotateCcw } from 'lucide-react';
import type { Message } from '../../../../shared/protocol';
import { Brand } from './Brand';

/** Register a renderer here only when the backend supplies a typed domain payload. */
export interface MessageContentRenderer { matches(message: Message): boolean; render(message: Message): ReactNode }
const contentRenderers: MessageContentRenderer[] = [];
export function registerMessageRenderer(renderer: MessageContentRenderer) { contentRenderers.push(renderer); return () => { const index = contentRenderers.indexOf(renderer); if (index >= 0) contentRenderers.splice(index, 1); }; }
function CopyButton({ content, label = 'Copy response' }: { content: () => string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return <button className="icon-button copy-button" aria-label={state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed. Try again' : label} title={state === 'copied' ? 'Copied' : label} onClick={() => void navigator.clipboard.writeText(content()).then(() => setState('copied'), () => setState('failed'))}>{state === 'copied' ? <Check size={15} /> : <Copy size={15} />}{state === 'failed' && <span>Try again</span>}</button>;
}
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return <div className="code-block"><div className="code-toolbar"><span>Code</span><CopyButton label="Copy code" content={() => ref.current?.textContent ?? ''} /></div><pre ref={ref}>{children}</pre></div>;
}
function MessageContent({ message }: { message: Message }) {
  const renderer = contentRenderers.find(candidate => candidate.matches(message));
  if (renderer) return renderer.render(message);
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
    img: ({ alt }) => <span className="markdown-image-label">{alt || 'Image'}</span>,
    table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
  }}>{message.content}</Markdown>;
}
export const MessageRenderer = memo(function MessageRenderer({ message, retry, retryDisabled }: { message: Message; retry: (message: Message) => void; retryDisabled: boolean }) {
  if (message.role === 'user') return <article className="user-message" aria-label="Your message"><div className="user-bubble">{message.content}</div>{message.status === 'sending' && <span className="message-state">Sending…</span>}{message.status === 'failed' && <div className="message-state failed" role="alert">Could not send message.<button className="text-button" disabled={retryDisabled} onClick={() => retry(message)}><RotateCcw size={13} />Retry</button></div>}</article>;
  return <article className="assistant-message" aria-label="WB Copilot response"><div className="assistant-heading"><Brand small /><strong>WB Copilot</strong>{message.status === 'streaming' && <span className="message-state">Responding</span>}</div><div className="markdown"><MessageContent message={message} /></div>{message.status === 'completed' && <div className="message-actions"><CopyButton content={() => message.content} /></div>}{message.status === 'failed' && <span className="message-state failed">This response was interrupted.</span>}</article>;
});
