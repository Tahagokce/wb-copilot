import { eventSchema, type ServerEvent, type ConnectionState } from '../../../../shared/protocol';

type Socket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'onopen' | 'onclose' | 'onerror' | 'onmessage'>;
type Options = {
  url: () => string;
  onEvent: (event: ServerEvent) => void;
  onState: (state: ConnectionState) => void;
  createSocket?: (url: string) => Socket;
  random?: () => number;
};

/** App-scoped transport. It deliberately knows nothing about the selected route. */
export class RealtimeClient {
  private socket?: Socket;
  private timer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private attempt = 0;
  private cursor = 0;
  private online = true;
  constructor(private options: Options) {}
  start(cursor = this.cursor) {
    if (!this.stopped) return;
    this.stopped = false;
    this.cursor = cursor;
    this.connect();
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
    this.options.onState(this.attempt ? 'reconnecting' : 'connecting');
    let socket: Socket;
    try { socket = (this.options.createSocket ?? (url => new WebSocket(url)))(this.options.url()); }
    catch { this.schedule(); return; }
    this.socket = socket;
    const current = () => !this.stopped && this.socket === socket;
    this.watchdog = setTimeout(() => { if (current()) { this.cleanup(); this.schedule(); } }, 12000);
    socket.onopen = () => { if (current()) socket.send(JSON.stringify({ type: 'resume', after: this.cursor })); };
    socket.onmessage = event => {
      if (!current()) return;
      let parsed;
      try { parsed = eventSchema.safeParse(JSON.parse(String(event.data))); } catch { return; }
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'ready') {
        clearTimeout(this.watchdog); this.attempt = 0;
        this.cursor = message.seq;
        this.options.onState('connected'); return;
      }
      if (message.type !== 'sync' && message.seq <= this.cursor) return;
      if (message.type === 'conversation.updated' && message.conversation.id !== message.conversationId) return;
      this.options.onEvent(message);
      this.cursor = message.seq;
    };
    socket.onerror = () => { if (current()) { this.cleanup(); this.schedule(); } };
    socket.onclose = () => { if (current()) { this.cleanup(); this.schedule(); } };
  }
  private schedule() {
    if (this.stopped || this.timer || !this.online) return;
    this.options.onState(this.attempt >= 8 ? 'error' : 'reconnecting');
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5));
    const jitter = 0.85 + (this.options.random ?? Math.random)() * 0.3;
    this.timer = setTimeout(() => { this.timer = undefined; this.connect(); }, delay * jitter);
  }
}
