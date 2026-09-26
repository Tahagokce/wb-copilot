import { z } from 'zod';
import { documentSchema, summarySchema } from '../../../../shared/protocol';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function request<T>(path: string, schema: z.ZodType<T>, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', signal: controller.signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new ApiError(response.status, response.status === 404 ? 'Conversation not found.' : response.status === 401 ? 'Your session expired. Refresh to reconnect.' : 'The request could not be completed. Please try again.');
    return schema.parse(await response.json());
  } finally { clearTimeout(timeout); }
}
const sessionSchema = z.object({ service: z.object({ available: z.boolean(), name: z.string() }), cursor: z.number() });
export const api = {
  session: () => request('/session', sessionSchema),
  list: () => request('/conversations', z.array(summarySchema)),
  get: (id: string) => request(`/conversations/${encodeURIComponent(id)}`, documentSchema),
  send: (id: string, requestId: string, content: string) => request(`/conversations/${encodeURIComponent(id)}/messages`, documentSchema, 'POST', { requestId, content }),
  rename: (id: string, title: string) => request(`/conversations/${encodeURIComponent(id)}`, documentSchema, 'PATCH', { title }),
  read: (id: string) => request(`/conversations/${encodeURIComponent(id)}/read`, documentSchema, 'POST'),
  delete: (id: string) => request(`/conversations/${encodeURIComponent(id)}`, z.object({ ok: z.boolean() }), 'DELETE'),
};
export type ChatApi = typeof api;
