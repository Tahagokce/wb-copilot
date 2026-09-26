import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient } from '../src/features/chat/services/realtime';
class Socket {
  readyState = 0;
  onopen: WebSocket['onopen'] = null; onclose: WebSocket['onclose'] = null;
  onerror: WebSocket['onerror'] = null; onmessage: WebSocket['onmessage'] = null;
  send = vi.fn(); close = vi.fn(() => { this.readyState = 3; });
  open() { this.readyState = 1; this.onopen?.call(this as unknown as WebSocket, {} as Event); }
  message(value: unknown) { this.onmessage?.call(this as unknown as WebSocket, { data: JSON.stringify(value) } as MessageEvent); }
  disconnect() { this.onclose?.call(this as unknown as WebSocket, {} as CloseEvent); }
}
function setup() {
  const sockets: Socket[] = []; const onEvent = vi.fn(); const onState = vi.fn();
  const client = new RealtimeClient({ url: () => 'ws://localhost/realtime', onEvent, onState, random: () => .5, createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
  return { sockets, onEvent, onState, client };
}
describe('application realtime transport', () => {
  beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
  it('opens exactly one browser socket and does not send an invented handshake', () => {
    const { client, sockets, onState } = setup(); client.start(); client.start(); expect(sockets).toHaveLength(1);
    sockets[0].open(); expect(sockets[0].send).not.toHaveBeenCalled();
    expect(onState).toHaveBeenLastCalledWith('connected'); client.stop();
  });
  it('sends the exact USER_MESSAGE frame over the same socket for A and B', () => {
    const {client,sockets}=setup();client.start();
    expect(()=>client.send('a','Hello')).toThrow();sockets[0].open();
    client.send('a','Hello');client.send('b','World');
    expect(sockets).toHaveLength(1);
    expect(sockets[0].send.mock.calls.map(([data])=>JSON.parse(data))).toEqual([
      {type:'USER_MESSAGE',conversationId:'a',content:'Hello'},
      {type:'USER_MESSAGE',conversationId:'b',content:'World'},
    ]);client.stop();expect(()=>client.send('a','Late')).toThrow();
  });
  it('reconnects at 1s, 2s and keeps backoff bounded', () => {
    const { client, sockets } = setup(); client.start(); sockets[0].disconnect();
    vi.advanceTimersByTime(999); expect(sockets).toHaveLength(1); vi.advanceTimersByTime(1); expect(sockets).toHaveLength(2);
    sockets[1].disconnect(); vi.advanceTimersByTime(1999); expect(sockets).toHaveLength(2); vi.advanceTimersByTime(1); expect(sockets).toHaveLength(3);
    for (let i = 0; i < 8; i++) { sockets.at(-1)!.disconnect(); vi.advanceTimersByTime(30000); }
    expect(sockets.length).toBeGreaterThan(8); client.stop();
  });
  it('does not reconnect after intentional disconnect', () => {
    const { client, sockets } = setup(); client.start(); sockets[0].disconnect(); client.stop(); vi.advanceTimersByTime(60000); expect(sockets).toHaveLength(1);
  });
  it('offline closes transport, online creates exactly one new socket', () => {
    const { client, sockets, onState } = setup(); client.start(); client.setOnline(false); vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1); expect(onState).toHaveBeenLastCalledWith('offline'); client.setOnline(true); client.setOnline(true); expect(sockets).toHaveLength(2); client.stop();
  });
  it('delivers real BE deltas in order without content-based deduplication', async () => {
    const { client, sockets, onEvent } = setup(); client.start(); sockets[0].open();
    const event = { type: 'ASSISTANT_DELTA', conversationId: 'a', content: 'ha' };
    sockets[0].message(event); sockets[0].message(event);
    await vi.advanceTimersByTimeAsync(0);
    expect(onEvent).toHaveBeenCalledTimes(2);
    sockets[0].disconnect(); vi.advanceTimersByTime(1000); sockets[1].open();
    expect(sockets[1].send).not.toHaveBeenCalled(); client.stop();
  });
  it('ignores stale socket callbacks after a replacement', async () => {
    const { client, sockets, onEvent } = setup(); client.start(); const stale = sockets[0].onmessage; client.retry();
    stale?.call(sockets[0] as unknown as WebSocket, { data: JSON.stringify({ type: 'ASSISTANT_COMPLETED', conversationId: 'a', content: 'late' }) } as MessageEvent);
    await vi.advanceTimersByTimeAsync(0); expect(onEvent).not.toHaveBeenCalled(); client.stop();
  });
  it('invalid data never enters the store', async () => {
    const { client, sockets, onEvent } = setup(); client.start(); sockets[0].message({ type: 'ASSISTANT_DELTA', content: 9 }); await vi.advanceTimersByTimeAsync(0); expect(onEvent).not.toHaveBeenCalled(); client.stop();
  });
  it('replaces a connection that never completes its handshake', () => {
    const { client, sockets } = setup(); client.start(); vi.advanceTimersByTime(13000); expect(sockets).toHaveLength(2); expect(sockets[0].close).toHaveBeenCalled(); client.stop();
  });
});
