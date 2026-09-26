import { z } from 'zod';

export const messageSchema = z.object({
  id: z.string(), conversationId: z.string(), requestId: z.string(),
  role: z.enum(['user', 'assistant']), content: z.string(), createdAt: z.string(),
  status: z.enum(['sending', 'sent', 'streaming', 'completed', 'failed']),
});
export type Message = z.infer<typeof messageSchema>;
export const toolSchema = z.object({
  id: z.string(), label: z.string(), status: z.enum(['running', 'completed', 'failed']),
});
export type ToolExecution = z.infer<typeof toolSchema>;
export const generationSchema = z.object({
  status: z.enum(['idle', 'running', 'completed', 'failed']),
  requestId: z.string().nullable(), tools: z.array(toolSchema),
  error: z.string().optional(),
});
export type Generation = z.infer<typeof generationSchema>;
export const summarySchema = z.object({
  id: z.string(), title: z.string(), createdAt: z.string(), updatedAt: z.string(),
  revision: z.number(), generation: generationSchema,
  lastAssistantAt: z.string().nullable(), readAt: z.string(),
});
export type ConversationSummary = z.infer<typeof summarySchema>;
export const documentSchema = summarySchema.extend({ messages: z.array(messageSchema) });
export type ConversationDocument = z.infer<typeof documentSchema>;
export const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('conversation.updated'), seq: z.number(), conversationId: z.string(), conversation: documentSchema }),
  z.object({ type: z.literal('conversation.deleted'), seq: z.number(), conversationId: z.string() }),
  z.object({ type: z.literal('sync'), seq: z.number() }),
  z.object({ type: z.literal('ready'), seq: z.number() }),
]);
export type ServerEvent = z.infer<typeof eventSchema>;
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'offline' | 'error';
export const sendSchema = z.object({ requestId: z.string().uuid(), content: z.string().trim().min(1).max(16000) });
export const idleGeneration: Generation = { status: 'idle', requestId: null, tools: [] };
