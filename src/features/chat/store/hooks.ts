import { useCallback, useSyncExternalStore } from 'react';
import { chatStore } from './chat-store';
export function useConversation(id: string) {
  return useSyncExternalStore(useCallback(fn => chatStore.subscribe(id, fn), [id]), useCallback(() => chatStore.getConversation(id), [id]));
}
export const useChatIndex = () => useSyncExternalStore(chatStore.subscribeIndex, chatStore.getIndex);
export const useRuntime = () => useSyncExternalStore(chatStore.subscribeRuntime, chatStore.getRuntime);
