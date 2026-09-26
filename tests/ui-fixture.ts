/** Test-only server. Never imported by the production entry point. No real flight data. */
import { createApp } from '../server/app';
import type { CopilotProvider } from '../server/provider';
const provider: CopilotProvider = {
  available: true, name: 'Controlled test fixture',
  async generate({ messages, signal, onTool }) {
    const content = messages.filter(message => message.role === 'user').at(-1)!.content;
    onTool({ id: 'fixture', label: 'Running isolated integration fixture', status: 'running' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, content.includes('[slow]') ? 12000 : 200);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
    });
    onTool({ id: 'fixture', label: 'Isolated integration fixture completed', status: 'completed' });
    if (content.includes('[long]')) return Array.from({ length: 50 }, (_, index) => `### Test section ${index + 1}\n\nThis is deterministic test content for scroll verification. It is not operational flight information.\n`).join('\n');
    return `**Test response:** ${content}\n\nThis response is from the isolated test fixture. No AI or flight service was contacted.`;
  },
};
const app = createApp({ databasePath: ':memory:', provider, staticDirectory: 'dist' });
app.server.listen(4174, '127.0.0.1', () => console.log('WB isolated UI test fixture: http://127.0.0.1:4174/chat'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
