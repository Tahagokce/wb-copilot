import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { idleGeneration, sendSchema, type ConversationDocument, type ServerEvent } from '../shared/protocol';
import { Repository } from './repository';
import { type CopilotProvider, publicGenerationError, UnconfiguredProvider } from './provider';

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const uuid = z.string().uuid();
const sessionCookie = (request: IncomingMessage) => request.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith('wb_session='))?.slice(11);
const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
};
async function body(request: IncomingMessage): Promise<unknown> {
  let data = '';
  for await (const chunk of request) {
    data += chunk;
    if (data.length > 70000) throw new HttpError(413, 'This message is too long.');
  }
  try { return JSON.parse(data); } catch { throw new HttpError(400, 'Invalid request.'); }
}

export function createApp(options: { databasePath?: string; provider?: CopilotProvider; staticDirectory?: string; allowedOrigins?: string[] } = {}) {
  const repository = new Repository(options.databasePath ?? '.data/copilot.sqlite');
  repository.interruptRunning();
  const provider = options.provider ?? new UnconfiguredProvider();
  const peers = new Map<WebSocket, { owner: string; resumed: boolean; alive: boolean }>();
  const jobs = new Map<string, AbortController>();
  const allowedOrigin = (request: IncomingMessage) => {
    const origin = request.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === request.headers.host || !!options.allowedOrigins?.includes(origin); }
    catch { return false; }
  };
  const publish = (owner: string, event: ServerEvent) => {
    const data = JSON.stringify(event);
    for (const [socket, peer] of peers) {
      if (peer.owner === owner && peer.resumed && socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  };
  const save = (owner: string, document: ConversationDocument) => {
    publish(owner, repository.save(owner, document));
    return document;
  };
  function generate(owner: string, id: string, requestId: string) {
    const controller = new AbortController();
    jobs.set(id, controller);
    // Job lifetime belongs to the server, never to an HTTP request or WebSocket.
    const current = () => !controller.signal.aborted && jobs.get(id) === controller ? repository.get(owner, id) : undefined;
    const initial = current();
    if (!initial) return;
    const assistantId = randomUUID();
    const started = new Date().toISOString();
    let lastPartialWrite = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const generation = provider.generate({
          conversationId: id, requestId, messages: initial.messages.filter(m => m.status !== 'failed'), signal: controller.signal,
          onTool(tool) {
            const document = current();
            if (!document) return;
            const tools = document.generation.tools.filter(t => t.id !== tool.id);
            document.generation.tools = [...tools, tool];
            save(owner, document);
          },
          onText(content) {
            if (Date.now() - lastPartialWrite < 100) return;
            lastPartialWrite = Date.now();
            const document = current();
            if (!document) return;
            document.messages = document.messages.filter(m => m.id !== assistantId);
            document.messages.push({ id: assistantId, requestId, conversationId: id, role: 'assistant', content, createdAt: started, status: 'streaming' });
            save(owner, document);
          },
        });
        const interrupted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('GENERATION_ABORTED')), { once: true }));
        const content = await Promise.race([generation, interrupted, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('GENERATION_TIMEOUT')), 300000); })]);
        const document = current();
        if (!document) return;
        if (!content.trim()) throw new Error('EMPTY_RESPONSE');
        const now = new Date().toISOString();
        document.messages = document.messages.filter(m => m.id !== assistantId);
        document.messages.push({ id: assistantId, requestId, conversationId: id, role: 'assistant', content, createdAt: started, status: 'completed' });
        document.generation = { ...document.generation, status: 'completed' };
        document.updatedAt = now;
        document.lastAssistantAt = now;
        save(owner, document);
      } catch (error) {
        const document = current();
        if (!document) return;
        document.messages = document.messages.map(m => m.id === assistantId ? { ...m, status: 'failed' } : m);
        document.generation = { ...document.generation, status: 'failed', error: publicGenerationError(error), tools: document.generation.tools.map(t => t.status === 'running' ? { ...t, status: 'failed' } : t) };
        save(owner, document);
      } finally { clearTimeout(timeout); controller.abort(); if (jobs.get(id) === controller) jobs.delete(id); }
    })();
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (!path.startsWith('/api/')) {
        if (!options.staticDirectory) throw new HttpError(404, 'Not found.');
        const root = resolve(options.staticDirectory);
        const requested = resolve(root, '.' + decodeURIComponent(path));
        if (requested !== root && !requested.startsWith(root + '/')) throw new HttpError(404, 'Not found.');
        const file = extname(path) ? requested : resolve(root, 'index.html');
        const content = await readFile(file).catch(() => { throw new HttpError(404, 'Not found.'); });
        const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
        response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'" });
        response.end(content);
        return;
      }
      if (!allowedOrigin(request)) throw new HttpError(403, 'Request not allowed.');
      let owner = sessionCookie(request);
      if (path === '/api/session' && request.method === 'GET') {
        if (!owner || !repository.hasSession(owner)) {
          owner = randomUUID(); repository.createSession(owner);
          response.setHeader('Set-Cookie', `wb_session=${owner}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
        }
        json(response, 200, { service: { available: provider.available, name: provider.name }, cursor: repository.cursor(owner) });
        return;
      }
      if (!owner || !repository.hasSession(owner)) throw new HttpError(401, 'Your session expired. Refresh to reconnect.');
      if (path === '/api/conversations' && request.method === 'GET') {
        json(response, 200, repository.list(owner).map(({ messages: _messages, ...summary }) => summary)); return;
      }
      const match = /^\/api\/conversations\/([^/]+)(?:\/(messages|read))?$/.exec(path);
      if (!match || !uuid.safeParse(match[1]).success) throw new HttpError(404, 'Conversation not found.');
      const [, id, action] = match;
      let document = repository.get(owner, id);
      if (action === 'messages' && request.method === 'POST') {
        const input = sendSchema.parse(await body(request));
        const existing = document?.messages.find(m => m.role === 'user' && m.requestId === input.requestId);
        if (existing && existing.content !== input.content) throw new HttpError(409, 'This request was already used for a different message.');
        if (existing && (document?.generation.status !== 'failed' || document.generation.requestId !== input.requestId)) {
          json(response, 200, document); return;
        }
        if (document?.generation.status === 'running') throw new HttpError(409, 'Wait for this conversation to finish before sending another message.');
        if (jobs.size >= 20) throw new HttpError(429, 'The service is busy. Please try again shortly.');
        if (!document) {
          if (repository.exists(id) || repository.deleted(id)) throw new HttpError(404, 'Conversation not found.');
          const now = new Date().toISOString();
          document = { id, title: input.content.slice(0, 64), createdAt: now, updatedAt: now, revision: 0, messages: [], generation: idleGeneration, lastAssistantAt: null, readAt: now };
        }
        if (!existing) document.messages.push({ id: randomUUID(), conversationId: id, requestId: input.requestId, role: 'user', content: input.content, createdAt: new Date().toISOString(), status: 'sent' });
        document.generation = { status: 'running', requestId: input.requestId, tools: [] };
        document.updatedAt = new Date().toISOString();
        save(owner, document);
        json(response, 202, document);
        generate(owner, id, input.requestId);
        return;
      }
      if (!document) throw new HttpError(404, 'Conversation not found.');
      if (request.method === 'GET' && !action) { json(response, 200, document); return; }
      if (request.method === 'PATCH' && !action) {
        const { title } = z.object({ title: z.string().trim().min(1).max(100) }).parse(await body(request));
        document.title = title; json(response, 200, save(owner, document)); return;
      }
      if (request.method === 'POST' && action === 'read') {
        document.readAt = new Date().toISOString(); json(response, 200, save(owner, document)); return;
      }
      if (request.method === 'DELETE' && !action) {
        jobs.get(id)?.abort(); jobs.delete(id);
        publish(owner, repository.delete(owner, id)); json(response, 200, { ok: true }); return;
      }
      throw new HttpError(405, 'Method not allowed.');
    } catch (error) {
      if (response.headersSent) return;
      const status = error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500;
      if (status === 500) console.error('Request failed:', error);
      json(response, status, { error: error instanceof HttpError ? error.message : status === 400 ? 'Please check your request.' : 'The service is temporarily unavailable. Please try again.' });
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  server.on('upgrade', (request, socket, head) => {
    const owner = sessionCookie(request);
    const origin = request.headers.origin;
    if (request.url !== '/realtime' || !owner || !repository.hasSession(owner) || !origin || !allowedOrigin(request)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(request, socket, head, ws => {
      peers.set(ws, { owner, resumed: false, alive: true });
      ws.on('pong', () => { const peer = peers.get(ws); if (peer) peer.alive = true; });
      ws.on('close', () => peers.delete(ws));
      ws.on('error', () => ws.close());
      ws.on('message', data => {
        try {
          const resume = z.object({ type: z.literal('resume'), after: z.number().int().nonnegative() }).parse(JSON.parse(data.toString()));
          const peer = peers.get(ws);
          if (!peer || peer.resumed) return;
          const events = repository.replay(owner, resume.after);
          const cursor = repository.cursor(owner);
          if (repository.needsSync(owner, resume.after) || events.length > 500 || resume.after > cursor) ws.send(JSON.stringify({ type: 'sync', seq: cursor }));
          else for (const event of events) ws.send(JSON.stringify(event));
          peer.resumed = true;
          ws.send(JSON.stringify({ type: 'ready', seq: cursor }));
        } catch { ws.close(1008, 'Invalid protocol message'); }
      });
    });
  });
  const heartbeat = setInterval(() => {
    for (const [socket, peer] of peers) {
      if (!peer.alive) { socket.terminate(); continue; }
      peer.alive = false; socket.ping();
    }
  }, 15000);
  heartbeat.unref();
  return { server, repository, jobs, async close() {
    clearInterval(heartbeat);
    for (const controller of jobs.values()) controller.abort();
    for (const socket of peers.keys()) socket.terminate();
    wss.close();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    repository.close();
  } };
}
