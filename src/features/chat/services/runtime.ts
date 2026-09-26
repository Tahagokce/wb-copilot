import { RealtimeClient } from './realtime';
import { chatStore } from '../store/chat-store';
import { backendCapabilities, backendConfig } from './backend-config';
import { backendContract } from './backend-contract';

export const realtime = new RealtimeClient({
  url: () => backendConfig.wsUrl,
  decodeEvent: backendContract.decodeEvent,
  onEvent: event => {
    if (event.type === 'ERROR' && !event.conversationId) chatStore.setRuntime({ error: event.content || 'The backend reported an error.' });
    else chatStore.handleEvent(event);
    if (event.type === 'ASSISTANT_COMPLETED') void chatStore.loadIndex();
  },
  onState: connection => chatStore.setRuntime({ connection }),
  onConnected: () => {
    // The BE DTO has no replay cursor. Recover only through configured history APIs.
    if (backendCapabilities.history) void chatStore.loadIndex();
    if (backendCapabilities.detail) void chatStore.reloadKnownConversations();
  },
});
chatStore.setTransport((id, content) => realtime.send(id, content));
let started = false;
const online = () => realtime.setOnline(true);
const offline = () => realtime.setOnline(false);
export function initialize() {
  if (started) return;
  started = true;
  window.addEventListener('online', online); window.addEventListener('offline', offline);
  chatStore.setRuntime({ initialized: true, backendConfigured: backendCapabilities.realtime,
    canSend: backendCapabilities.send, connection: 'disconnected',
    error: backendCapabilities.realtime ? undefined : 'The backend connection has not been configured yet.' });
  realtime.setOnline(navigator.onLine);
  realtime.start();
  if (backendCapabilities.history) void chatStore.loadIndex();
}
export function shutdown() {
  realtime.stop(); window.removeEventListener('online', online); window.removeEventListener('offline', offline); started = false;
}

// Defer release by one microtask so React StrictMode's effect probe reuses the socket.
let owners = 0;
export function acquireRuntime() {
  owners++; initialize();
  return () => { owners--; queueMicrotask(() => { if (owners === 0) shutdown(); }); };
}
