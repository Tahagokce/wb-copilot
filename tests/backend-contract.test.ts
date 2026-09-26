import { describe, it, expect, vi } from 'vitest';
import { createBackendApi } from '../src/features/chat/services/api';
import { backendContract } from '../src/features/chat/services/backend-contract';
import { reduceChatEvent } from '../src/features/chat/store/reduce-event';
import { ChatStore } from '../src/features/chat/store/chat-store';
import { client, deferred, document } from './fixtures';
import type { ConversationDocument } from '../shared/protocol';
const config = {apiBaseUrl:'http://localhost:8080/api/v1',wsUrl:'ws://localhost:8080/api/v1/copilot/chat'};
describe('real backend contract',()=>{
  it('creates with no body, loads exact paths, accepts any successful delete body',async()=>{
    const summary={id:'server-id',title:'Flight',createdAt:'2026-09-27T00:00:00Z',updatedAt:'2026-09-27T00:00:00Z'};
    const fetcher=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(summary)))
      .mockResolvedValueOnce(new Response(JSON.stringify([summary])))
      .mockResolvedValueOnce(new Response(JSON.stringify([{id:'m',role:'USER',content:'Flight',createdAt:summary.createdAt}])))
      .mockResolvedValueOnce(new Response('Deleted', {status:200}));
    const api=createBackendApi(config,backendContract,fetcher);
    expect((await api.create()).id).toBe('server-id');await api.list();
    expect((await api.get('server-id')).messages[0].role).toBe('user');await api.delete('server-id');
    expect(fetcher.mock.calls.map(([url])=>String(url))).toEqual([
      config.apiBaseUrl+'/conversations',config.apiBaseUrl+'/conversations',config.apiBaseUrl+'/conversations/server-id/messages',config.apiBaseUrl+'/conversations/server-id']);
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',body:undefined});
    expect(fetcher.mock.calls[3][1]?.method).toBe('DELETE');
  });
  it('handles start, tools, repeated deltas, and null completion independently',()=>{
    let state=document('a');
    for(const event of [
      {type:'ASSISTANT_STARTED',content:null}, {type:'ASSISTANT_STATUS',content:'Checking'},
      {type:'TOOL_STARTED',content:'Lookup'}, {type:'TOOL_COMPLETED',content:'Found'},
      {type:'ASSISTANT_DELTA',content:'ha'}, {type:'ASSISTANT_DELTA',content:'ha'},
      {type:'ASSISTANT_COMPLETED',content:null},
    ] as const) state=reduceChatEvent(state,{...event,conversationId:'a'});
    expect(state.messages).toHaveLength(1);expect(state.messages[0]).toMatchObject({content:'haha',status:'completed'});
    expect(state.generation.statusText).toBeUndefined();expect(state.generation.tools[0].status).toBe('completed');
    expect(backendContract.decodeEvent({type:'ASSISTANT_COMPLETED',conversationId:'a'})?.content).toBeNull();
  });
  it('clears temporary activity on error without discarding partial content',()=>{
    let state=document('a');
    state=reduceChatEvent(state,{type:'ASSISTANT_DELTA',conversationId:'a',content:'Partial'});
    state=reduceChatEvent(state,{type:'TOOL_STARTED',conversationId:'a',content:'Lookup'});
    state=reduceChatEvent(state,{type:'ERROR',conversationId:'a',content:'Unavailable'});
    expect(state.generation.tools).toEqual([]);expect(state.messages[0]).toMatchObject({content:'Partial',status:'failed'});
  });
  it('does not let stale persisted history erase streaming content',async()=>{
    const api=client();const store=new ChatStore(api);const pending=deferred<ConversationDocument>();
    vi.mocked(api.get).mockReturnValue(pending.promise);
    const loading=store.loadConversation('a');
    store.handleEvent({type:'ASSISTANT_DELTA',conversationId:'a',content:'Live'});
    pending.resolve(document('a',0));await loading;
    expect(Object.values(store.getConversation('a')!.messagesById)[0].content).toBe('Live');
  });
});
