import { CloudOff, LoaderCircle, RotateCcw, Info } from 'lucide-react';
import { useRuntime } from '../store/hooks';
import { initialize, realtime } from '../services/runtime';
export function ConnectionStatus() {
  const runtime = useRuntime();
  if (runtime.connection === 'connected' && !runtime.error) return null;
  const message = runtime.error ?? ({ connected: 'Connected.', connecting: 'Connecting to your workspace…', reconnecting: 'Connection lost. Reconnecting…', disconnected: 'Connection closed.', offline: 'You’re offline. Your loaded chats are still here.', error: 'Still trying to reconnect…' }[runtime.connection]);
  return <div className="connection-notice" role="status">{!runtime.backendConfigured ? <Info size={16} /> : runtime.connection === 'offline' ? <CloudOff size={16} /> : <LoaderCircle size={16} className="spin" />}<span>{message}</span>{runtime.backendConfigured && runtime.connection !== 'offline' && <button className="text-button" onClick={() => runtime.initialized ? realtime.retry() : void initialize()}><RotateCcw size={13} />Retry</button>}</div>;
}
