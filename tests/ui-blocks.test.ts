import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TableBlock, TableColumnType } from '../shared/backend-types';
import { parseChatEvent, parseUiBlock } from '../src/features/chat/services/validation';
import { backendContract } from '../src/features/chat/services/backend-contract';
import { ChatStore } from '../src/features/chat/store/chat-store';
import { TableBlockView } from '../src/features/chat/components/TableBlockView';
import { MessageRenderer } from '../src/features/chat/components/MessageRenderer';
import { formatTableValue, tablePage, tableNavigation } from '../src/features/chat/utils/table';
import { client, document, deferred } from './fixtures';
import type { ConversationDocument } from '../shared/protocol';
const block: TableBlock = {id:'results',type:'TABLE',title:'Records',columns:[{key:'name',label:'Name',type:'TEXT'}],rows:[{id:'1',values:{name:'Alpha'}},{id:'2',values:{name:'Beta'}},{id:'3',values:{name:null}}],searchable:true,pageSize:1};
function setup() {
  const api=client();const store=new ChatStore(api);store.applyDocument(document('a'));store.applyDocument(document('b'));
  store.handleEvent({type:'ASSISTANT_STARTED',conversationId:'a',content:null});
  const push=(value:unknown)=>{ const event=parseChatEvent(value); if(event) store.handleEvent(event); };
  const message=()=>Object.values(store.getConversation('a')!.messagesById)[0];
  return {store,api,push,message};
}
describe('structured blocks',()=>{
  it('upserts blocks alongside actions, streaming and tools in the owning response',()=>{
    const {store,push,message}=setup();store.setActive('b');
    push({type:'TOOL_STARTED',conversationId:'a',content:'Checking'});
    push({type:'UI_BLOCK',conversationId:'a',block});
    push({type:'UI_BLOCK',conversationId:'a',block:{...block,id:'other'}});
    push({type:'UI_BLOCK',conversationId:'a',block:{...block,title:'Updated'}});
    push({type:'ACTIONS',conversationId:'a',actions:[{id:'open',type:'OPEN_URL',label:'Open',url:'https://example.com',target:'NEW_TAB'}]});
    expect(message().blocks?.map(b=>b.title)).toEqual(['Updated','Records']);
    expect(store.getConversation('a')?.metadata.generation.tools).toHaveLength(1);
    expect(message().status).toBe('streaming');
    push({type:'ASSISTANT_DELTA',conversationId:'a',content:'Text'});
    push({type:'TOOL_COMPLETED',conversationId:'a',content:'Checked'});
    push({type:'ASSISTANT_COMPLETED',conversationId:'a'});
    expect(message()).toMatchObject({content:'Text',status:'completed'});
    expect(message().blocks).toHaveLength(2);expect(message().actions).toHaveLength(1);
    expect(store.getConversation('a')?.messageIds).toHaveLength(1);expect(store.getConversation('b')?.messageIds).toEqual([]);
    expect(store.getConversation('a')?.unread).toBe(true);
    const html=renderToStaticMarkup(createElement(MessageRenderer,{message:message(),retry:vi.fn(),retryDisabled:false}));
    expect(html.indexOf('Text')).toBeLessThan(html.indexOf('Updated'));
    expect(html.indexOf('Updated')).toBeLessThan(html.indexOf('Response actions'));
  });
  it('preserves blocks on ERROR and ignores malformed or late blocks',()=>{
    const {push,message}=setup();push({type:'UI_BLOCK',conversationId:'a',block});
    push({type:'UI_BLOCK',conversationId:'a',block:{id:'unknown',type:'ALERT'}});
    push({type:'ERROR',conversationId:'a',content:'Failed'});
    push({type:'UI_BLOCK',conversationId:'a',block:{...block,id:'late'}});
    expect(message().blocks).toHaveLength(1);expect(message().status).toBe('failed');
    expect(parseUiBlock({type:'TABLE',id:'x',rows:null,columns:[]})).toBeUndefined();
  });
  it('retains live blocks during history recovery and supports optional REST hydration',async()=>{
    const {api,store,push,message}=setup();push({type:'UI_BLOCK',conversationId:'a',block});
    push({type:'ASSISTANT_DELTA',conversationId:'a',content:'Text'});push({type:'ASSISTANT_COMPLETED',conversationId:'a'});
    const history=[{id:'persisted',role:'ASSISTANT',content:'Text',createdAt:message().createdAt}];
    vi.mocked(api.get).mockResolvedValue(backendContract.decodeConversation(history,'a'));await store.loadConversation('a',true);
    expect(message().blocks?.[0].id).toBe('results');
    expect(backendContract.decodeConversation([{...history[0],blocks:[block]}],'a').messages[0].blocks?.[0].id).toBe('results');
  });
  it('keeps an updated block when a stale history request resolves',async()=>{
    const {api,store,push,message}=setup();push({type:'UI_BLOCK',conversationId:'a',block});
    const pending=deferred<ConversationDocument>();vi.mocked(api.get).mockReturnValue(pending.promise);
    const load=store.loadConversation('a',true);
    push({type:'UI_BLOCK',conversationId:'a',block:{...block,title:'Newest'}});
    const saved=backendContract.decodeConversation([{id:'persisted',role:'ASSISTANT',content:'',createdAt:message().createdAt,blocks:[block]}],'a');
    pending.resolve(saved);await load;expect(message().blocks?.[0].title).toBe('Newest');
  });
});
describe('generic table rendering and navigation',()=>{
  it('formats values safely and uses text for unknown column types',()=>{
    expect(formatTableValue(1234,'NUMBER','en-US')).toBe('1,234');
    expect(formatTableValue(true,'BOOLEAN')).toBe('Yes');expect(formatTableValue(false,'BOOLEAN')).toBe('No');
    expect(formatTableValue('2026-09-27','DATE','en-US')).toContain('2026');
    expect(formatTableValue('2026-09-27T14:30:00','DATETIME','en-US')).toContain('2026');
    for(const type of ['TEXT','NUMBER','DATE','DATETIME','BOOLEAN','STATUS'] as TableColumnType[]) expect(formatTableValue({},type)).toBe('—');
    expect(formatTableValue('2026-02-30','DATE')).toBe('—');expect(formatTableValue('bad','DATETIME')).toBe('—');
    const parsed=parseUiBlock({...block,columns:[{key:'name',label:'Name',type:'FUTURE'}]});expect(parsed?.columns[0].type).toBe('TEXT');
  });
  it('searches rendered values case-insensitively without mutating rows and resets page',()=>{
    const before=JSON.stringify(block);
    expect(tablePage(block,'',2).rows[0].id).toBe('2');
    const navigation=tableNavigation({query:'',page:3},{type:'search',query:'ALPHA'});
    expect(navigation.page).toBe(1);expect(tablePage(block,navigation.query,navigation.page)).toMatchObject({total:1,pages:1,page:1});
    expect(tablePage(block,'no match',3).rows).toEqual([]);expect(JSON.stringify(block)).toBe(before);
    expect(tablePage({...block,searchable:false},'ALPHA',1).total).toBe(3);
    expect(tablePage({...block,pageSize:undefined},'',1).rows).toHaveLength(3);
    expect(tablePage({...block,pageSize:0},'',99).page).toBe(1);
  });
  it('renders dynamic headings, escaped cells, shared row actions and an empty state',()=>{
    const html=renderToStaticMarkup(createElement(TableBlockView,{block:{...block,rows:[{id:'x',values:{name:'<script>alert(1)</script>'},actions:[{id:'open',type:'OPEN_URL',label:'Open record',target:'NEW_TAB',url:'https://example.com'}]}]}}));
    expect(html).toContain('Name');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
    expect(html).toContain('chat-action-button');expect(html).toContain('Open record');expect(html).toContain('Search Records');
    const empty=renderToStaticMarkup(createElement(TableBlockView,{block:{...block,rows:[],searchable:false}}));
    expect(empty).toContain('No results');expect(empty).not.toContain('type="search"');expect(empty).not.toContain('pagination');
    const paged=renderToStaticMarkup(createElement(TableBlockView,{block}));expect(paged).toContain('Next');expect(paged).toContain('1 / 3');
  });
});
