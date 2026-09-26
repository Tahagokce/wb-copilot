import type { ConversationDocument, ConversationSummary } from '../../../../shared/protocol';
import { backendConfig, type BackendConfig } from './backend-config';
import { backendContract, type BackendContract } from './backend-contract';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface ChatApi {
  create(): Promise<ConversationSummary>;
  list(): Promise<ConversationSummary[]>;
  get(id: string): Promise<ConversationDocument>;
  delete(id: string): Promise<void>;
}
export function createBackendApi(config: BackendConfig, contract: BackendContract = backendContract, fetcher: typeof fetch = fetch): ChatApi {
  async function request(path: string, id?: string, method = 'GET', body?: unknown): Promise<unknown> {
    const endpoint = path.replaceAll(':conversationId', encodeURIComponent(id ?? ''));
    const url = new URL(endpoint, config.apiBaseUrl.endsWith('/') ? config.apiBaseUrl : config.apiBaseUrl + '/');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid backend URL.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetcher(url, { method, credentials: 'include', signal: controller.signal,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) throw new ApiError(response.status, response.status === 404 ? 'Conversation not found.' : response.status === 401 ? 'Your session expired. Sign in to reconnect.' : 'The request could not be completed. Please try again.');
      if (method === 'DELETE' || response.status === 204) return undefined;
      const content = await response.text();
      return content ? JSON.parse(content) as unknown : undefined;
    } finally { clearTimeout(timeout); }
  }
  const document = async (path: string, id: string, method?: string, body?: unknown) => {
    const result = contract.decodeConversation(await request(path, id, method, body), id);
    if (result.id !== id) throw new Error('The backend returned a different conversation.');
    return result;
  };
  return {
    create: async () => contract.decodeHistory([await request('conversations', undefined, 'POST')])[0],
    list: async () => contract.decodeHistory(await request('conversations')),
    get: id => document('conversations/:conversationId/messages', id),
    delete: async id => { await request('conversations/:conversationId', id, 'DELETE'); },
  };
}
export const api = createBackendApi(backendConfig);
