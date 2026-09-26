import { api } from './api';
import { RealtimeClient } from './realtime';
import { chatStore } from '../store/chat-store';
export const realtime = new RealtimeClient({
  url: () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/realtime`,
  onEvent: chatStore.handleEvent,
  onState: connection => chatStore.setRuntime({ connection }),
});
let initialization: Promise<void> | undefined;
let started = false;
const online = () => { realtime.setOnline(true); if (!chatStore.getRuntime().initialized) void initialize(); };
const offline = () => realtime.setOnline(false);
export function initialize() {
  if (initialization) return initialization;
  if (!started) { window.addEventListener('online', online); window.addEventListener('offline', offline); started = true; }
  initialization = (async () => {
    try {
      const session = await api.session();
      chatStore.setRuntime({ initialized: true, serviceAvailable: session.service.available, error: undefined });
      // Replay from zero on refresh; revision checks reconcile concurrent HTTP loads.
      realtime.setOnline(navigator.onLine);
      realtime.start();
      await chatStore.loadIndex();
    } catch { chatStore.setRuntime({ connection: 'error', error: 'Could not connect to WB Copilot.' }); }
    finally { initialization = undefined; }
  })();
  return initialization;
}
export function shutdown() {
  realtime.stop(); window.removeEventListener('online', online); window.removeEventListener('offline', offline); started = false;
}
