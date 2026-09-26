import { createApp } from './app';
const app = createApp({ databasePath: process.env.DATABASE_PATH, staticDirectory: 'dist', allowedOrigins: [process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173'] });
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3001);
app.server.listen(port, host, () => console.log(`WB Copilot API: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
