import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { ConversationDocument } from '../shared/protocol';
import type { ChatApi } from '../src/features/chat/services/api';
export function document(id: string = randomUUID(), revision = 1): ConversationDocument {
  return { id, title: `Chat ${id}`, revision, createdAt: '2026-09-27T08:00:00.000Z', updatedAt: '2026-09-27T08:00:00.000Z', readAt: '2026-09-27T08:00:00.000Z', lastAssistantAt: null, generation: { status: 'idle', requestId: null, tools: [] }, messages: [] };
}
export function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
export function client(): ChatApi {
  return { create: vi.fn().mockResolvedValue(document()), list: vi.fn().mockResolvedValue([]), get: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
}
