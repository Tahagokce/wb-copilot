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
