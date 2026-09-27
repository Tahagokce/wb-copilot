import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatAction, ChatEvent } from '../shared/backend-types';
import { parseChatEvent } from '../src/features/chat/services/validation';
import { backendContract } from '../src/features/chat/services/backend-contract';
import { executeChatAction } from '../src/features/chat/services/actions';
import { MessageRenderer } from '../src/features/chat/components/MessageRenderer';
import { ChatStore } from '../src/features/chat/store/chat-store';
import { client, document } from './fixtures';
const action: ChatAction = {id:'open',type:'OPEN_URL',label:'Open document',icon:'file-text',url:'https://example.com/document?q=1',target:'NEW_TAB'};
function setup() {
  const api=client();const store=new ChatStore(api);store.applyDocument(document('a'));store.applyDocument(document('b'));
  const event=(type:ChatEvent['type'],content:string|null=null,actions?:ChatAction[])=>store.handleEvent({type,conversationId:'a',content,actions});
  event('ASSISTANT_STARTED');
  const message=()=>Object.values(store.getConversation('a')!.messagesById)[0];
  return {api,store,event,message};
}
afterEach(()=>vi.unstubAllGlobals());
describe('generic chat actions',()=>{
  it('merges by ID into the same assistant across streaming and completion',()=>{
    const {event,message,store}=setup();event('ASSISTANT_DELTA','Answer');
    event('TOOL_STARTED','Checking');event('ACTIONS',null,[action,{...action,id:'second'}]);
    event('ACTIONS',null,[{...action,label:'Updated'}]);
    expect(message().actions?.map(a=>a.label)).toEqual(['Updated','Open document']);
    expect(store.getConversation('a')?.metadata.generation.tools).toHaveLength(1);
    expect(message().status).toBe('streaming');event('ASSISTANT_DELTA',' more');
    event('TOOL_COMPLETED','Checked');event('ASSISTANT_COMPLETED');
    expect(message()).toMatchObject({content:'Answer more',status:'completed'});
    expect(message().actions).toHaveLength(2);expect(store.getConversation('a')?.messageIds).toHaveLength(1);
  });
  it('keeps background actions isolated and preserves them through errors',()=>{
    const {event,message,store}=setup();store.setActive('b');event('ACTIONS',null,[action]);event('ERROR','Unavailable');
    expect(message().actions).toEqual([action]);expect(message().status).toBe('failed');
    expect(store.getConversation('b')?.messageIds).toEqual([]);
    event('ACTIONS',null,[{...action,id:'late'}]);expect(message().actions).toHaveLength(1);
  });
  it('ignores empty, unknown and unsafe actions without dropping valid siblings',()=>{
    const decoded=parseChatEvent({type:'ACTIONS',conversationId:'a',content:null,actions:[action,{...action,id:'bad',type:'UNKNOWN'},{...action,id:'script',url:'javascript:alert(1)'}]});
    expect(decoded?.actions).toEqual([action]);
    const {event,message}=setup();event('ACTIONS',null,[]);expect(message().actions).toBeUndefined();
  });
  it('preserves live actions when reconnect history has no actions and hydrates REST actions',async()=>{
    const {api,store,event,message}=setup();event('ASSISTANT_DELTA','Answer');event('ACTIONS',null,[action]);event('ASSISTANT_COMPLETED');
    const history=[{id:'persisted',role:'ASSISTANT',content:'Answer',createdAt:message().createdAt}];
    vi.mocked(api.get).mockResolvedValue(backendContract.decodeConversation(history,'a'));
    await store.loadConversation('a',true);expect(message().actions).toEqual([action]);
    expect(backendContract.decodeConversation([{...history[0],actions:[action]}],'a').messages[0].actions).toEqual([action]);
  });
  it('executes only when explicitly invoked and uses the requested target',()=>{
    const open=vi.fn();const assign=vi.fn();vi.stubGlobal('window',{open,location:{assign}});
    const {event}=setup();event('ACTIONS',null,[action]);expect(open).not.toHaveBeenCalled();
    executeChatAction(action);expect(open).toHaveBeenCalledExactlyOnceWith(action.url,'_blank','noopener,noreferrer');
    executeChatAction({...action,target:'SAME_TAB'});expect(assign).toHaveBeenCalledExactlyOnceWith(action.url);
    executeChatAction({...action,url:'javascript:alert(1)'});expect(open).toHaveBeenCalledTimes(1);
  });
  it('renders accessible buttons below content and falls back to external-link icon',()=>{
    const {event,message}=setup();event('ASSISTANT_DELTA','Visible answer');event('ACTIONS',null,[{...action,icon:'unknown'}]);
    const html=renderToStaticMarkup(createElement(MessageRenderer,{message:message(),retry:vi.fn(),retryDisabled:false}));
    expect(html.indexOf('Visible answer')).toBeLessThan(html.indexOf('Open document'));
    expect(html).toContain('lucide-external-link');expect(html).toContain('opens in a new tab');
    expect(html).not.toContain('onclick=');
  });
});
