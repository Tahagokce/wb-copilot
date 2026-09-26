# Local application contract

These are **new internal endpoints implemented in this repository**, not claims about the service at port 8080. Runtime DTO validation is in `shared/protocol.ts` and `services/api.ts`.

## HTTP

All requests are same-origin and use an HttpOnly, SameSite=Strict `wb_session` cookie. `GET /api/session` creates the browser workspace session; other endpoints require it. IDs are UUIDs. The server rejects ownership violations and cross-origin mutations. `APP_ORIGIN` is the explicit frontend-origin allowlist entry for development/reverse-proxy setups.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/session` | Session cookie, provider availability, current event cursor |
| GET | `/api/conversations` | Summaries, sorted by latest activity; title filtering is client-side |
| GET | `/api/conversations/:id` | Full revisioned document |
| POST | `/api/conversations/:id/messages` | `{ requestId, content }`; lazy creation, persisted acknowledgement, asynchronous job |
| PATCH | `/api/conversations/:id` | `{ title }`, maximum 100 characters |
| POST | `/api/conversations/:id/read` | Persist completion read receipt |
| DELETE | `/api/conversations/:id` | Abort job, erase active history and retained snapshots, tombstone ID |

Message content is trimmed, required, and at most 16,000 characters. Existing request IDs never add duplicate user messages. A retry of the current failed request can restart generation; retries of an already completed/running request return the current snapshot. Reusing a request ID for different content is rejected.

## WebSocket

Connect to same-origin `/realtime` using the session cookie. A valid browser Origin is required. Immediately send:

```json
{ "type": "resume", "after": 0 }
```

The server replays missed events and sends `ready`. Event sequences are globally increasing but scoped by session on replay; gaps between a session's event IDs are normal.

```ts
type ServerEvent =
  | { type: 'conversation.updated'; seq: number; conversationId: string; conversation: ConversationDocument }
  | { type: 'conversation.deleted'; seq: number; conversationId: string }
  | { type: 'sync'; seq: number }
  | { type: 'ready'; seq: number };
```

`sync` means fetch authoritative history and loaded conversations because the cursor is outside the replay window. Every mutation increments its conversation revision. The client rejects older snapshots and mismatched envelope/document IDs. Route identity is never used for event attribution.

Messages have `sending | sent | streaming | completed | failed` states. Optimistic sending/failed-send states are client-side until an acknowledgement exists. Generation has `idle | running | completed | failed` and holds tool execution records separately from chat messages.
