# Backend protocol

HTTP base: `http://localhost:8080/api/v1`.

| Method | Path | Body / response |
| --- | --- | --- |
| POST | /conversations | No request body; Conversation response |
| GET | /conversations | Conversation[] |
| GET | /conversations/{id}/messages | ConversationMessage[] |
| DELETE | /conversations/{id} | No request body; any 2xx accepted |

One WebSocket connects to `ws://localhost:8080/api/v1/copilot/chat`.

Outbound: `{ "type": "USER_MESSAGE", "conversationId": "server-generated-id", "content": "user text" }`.

Inbound ChatEvent types: USER_MESSAGE, ASSISTANT_STARTED, ASSISTANT_STATUS, ASSISTANT_DELTA, ASSISTANT_COMPLETED, TOOL_STARTED, TOOL_COMPLETED, ERROR. Every routed frame uses its own conversationId. Null or omitted content is supported. Deltas append, including repeated identical chunks. Completion finalizes accumulated content. Errors clear temporary activity without closing the socket.

DTO definitions are in shared/backend-types.ts. Internal UI types in shared/protocol.ts are not transmitted to the server. No invented handshake, subscribe, resume, rename, read-receipt, HTTP-send, or cancellation endpoints exist.

## Generic response actions

`ACTIONS` carries optional `actions: ChatAction[]` alongside conversationId and null content. Supported action: OPEN_URL, with id, label, optional icon, final absolute HTTP(S) url, and SAME_TAB/NEW_TAB target. Unsupported or malformed entries are ignored individually. Multiple events merge by action ID into the current streaming assistant message; later values replace the same ID. Actions do not finish generation or become tool/text messages. Events outside a running response are ignored to avoid attaching them to an unrelated answer.

Buttons render below assistant content. Navigation occurs only on click: NEW_TAB uses window.open with noopener,noreferrer; SAME_TAB uses location.assign. No URLs are constructed. Icons plane/file-text/external-link are supported, with ExternalLink fallback.

REST messages can optionally carry the same actions field. Existing history without it continues to work; matching live messages retain their actions during history refresh. After a full browser reload, actions cannot be restored unless the backend persists and returns them. The existing lack of stable realtime message IDs also limits reconciliation when disconnected history differs from partial live content.

## Structured UI blocks

`UI_BLOCK` carries conversationId and a single `block`; content may be null or omitted. TABLE blocks carry id, optional title, dynamic columns (key, label, type), rows (id, values, optional existing ChatAction[]), optional searchable and pageSize. Column types are TEXT, NUMBER, DATE, DATETIME, BOOLEAN and STATUS. Unknown column types normalize to TEXT; unsupported/malformed blocks are ignored. Missing/invalid cell values render an em dash and all values remain escaped React text.

Blocks attach to the current streaming assistant message, alongside actions and text. Block IDs upsert in insertion order. Deltas, completion and errors preserve the attached data. Events never consult the active route, open another socket, or create separate tool/message records for a block. Renderer order is text, structured blocks, message actions.

TableBlockView is domain independent. It uses ChatActions for row navigation, filters formatted visible values case-insensitively, and paginates locally (default 10). Search resets page selection; updated rows clamp the displayed page. A contained horizontal/vertical scroll region handles wide/long tables. No backend pagination or business URL construction is introduced.

Optional REST message `blocks` are validated and hydrated using the same types. Existing histories need not supply them. Matching live messages preserve blocks/actions when history omits them, and stale history cannot overwrite newer live structured data. Full browser reload can only restore data actually persisted and returned by the backend.
