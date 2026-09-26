import type { ChatEvent } from '../../../../shared/backend-types';
import type { ConnectionState } from '../../../../shared/protocol';
import { parseChatEvent } from './validation';

type Socket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'onopen' | 'onclose' | 'onerror' | 'onmessage'>;
type Options = {
  url: () => string;
  onEvent: (event: ChatEvent) => void;
  onState: (state: ConnectionState) => void;
  decodeEvent?: (payload: unknown) => ChatEvent | null;
  onConnected?: () => void;
  createSocket?: (url: string) => Socket;
  random?: () => number;
};

/** A browser WebSocket listener for the existing BE. No server or invented handshake. */
export class RealtimeClient {
  private socket?: Socket;
  private timer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private attempt = 0;
  private online = true;
  private delivery: Promise<void> = Promise.resolve();
  constructor(private options: Options) {}
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }
  send(conversationId: string, content: string) {
    if (this.stopped || this.socket?.readyState !== 1) throw new Error('Connection unavailable.');
    this.socket.send(JSON.stringify({ type: 'USER_MESSAGE', conversationId, content }));
  }
  stop() {
    this.stopped = true;
    this.cleanup();
    this.options.onState('disconnected');
  }
  setOnline(online: boolean) {
    this.online = online;
    if (this.stopped) return;
    if (!online) { this.cleanup(); this.options.onState('offline'); }
    else { this.attempt = 0; this.connect(); }
  }
  retry() {
    if (this.stopped || !this.online) return;
    this.cleanup(); this.attempt = 0; this.connect();
  }
  private cleanup() {
    clearTimeout(this.timer); this.timer = undefined;
    clearTimeout(this.watchdog);
    const old = this.socket; this.socket = undefined;
    if (old) { old.onopen = old.onmessage = old.onclose = old.onerror = null; old.close(); }
  }
  private connect() {
    if (this.stopped || this.socket || this.timer) return;
    if (!this.online) { this.options.onState('offline'); return; }
    const url = this.options.url();
    if (!url) { this.options.onState('disconnected'); return; }
    this.options.onState(this.attempt ? 'reconnecting' : 'connecting');
    let socket: Socket;
    try { socket = (this.options.createSocket ?? (address => new WebSocket(address)))(url); }
    catch { this.schedule(); return; }
    this.socket = socket;
    const current = () => !this.stopped && this.socket === socket;
    this.watchdog = setTimeout(() => { if (current()) { this.cleanup(); this.schedule(); } }, 12000);
    socket.onopen = () => {
      if (!current()) return;
      clearTimeout(this.watchdog); this.attempt = 0;
      this.options.onState('connected');
      this.options.onConnected?.();
    };
    socket.onmessage = event => {
      // Serialize Blob decoding too: deltas must be delivered in wire order.
      this.delivery = this.delivery.then(async () => {
        if (!current()) return;
        const data: unknown = event.data;
        const text = typeof data === 'string' ? data : data instanceof Blob ? await data.text() : null;
        if (text === null || !current()) return;
        const message = (this.options.decodeEvent ?? parseChatEvent)(JSON.parse(text) as unknown);
        if (message) this.options.onEvent(message);
      }).catch(() => { /* Malformed frames do not stop subsequent delivery. */ });
    };
    socket.onerror = () => { if (current()) { this.cleanup(); this.schedule(); } };
    socket.onclose = () => { if (current()) { this.cleanup(); this.schedule(); } };
  }
  private schedule() {
    if (this.stopped || this.timer || !this.online) return;
    this.options.onState(this.attempt >= 8 ? 'error' : 'reconnecting');
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5));
    const jitter = 0.85 + (this.options.random ?? Math.random)() * 0.3;
    this.timer = setTimeout(() => { this.timer = undefined; this.connect(); }, Math.min(30000, delay * jitter));
  }
}
