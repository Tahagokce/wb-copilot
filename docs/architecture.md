# Architecture and implementation assessment

## Starting point

The workspace contained an empty Git repository; there was no frontend, persisted conversation model, API implementation, or WebSocket contract to refactor. The user clarified that this is a new project. An existing service was identified at `http://localhost:8080`, but is currently unavailable and its DTOs have not been supplied. No external endpoints were guessed.

## Boundaries

```text
React Router (/chat, /chat/:id)
  └── ChatLayout → Sidebar / MessageList / Composer
        └── useSyncExternalStore subscriptions
              ├── conversation-scoped normalized ChatStore
              ├── HTTP API adapter
              └── application RealtimeClient (no route dependency)
                         │
                local application server
                  ├── session-scoped WebSocket event fan-out
                  ├── SQLite conversation snapshots + bounded event journal
                  ├── independent per-conversation job runner
                  └── CopilotProvider ← real service integration pending
```

### Conversation lifecycle

`New chat` changes only the route. The first send reserves a browser-generated UUID, immediately inserts an optimistic user message and navigates to its URL. The server atomically persists the conversation, user message and generation state. `requestId` makes delivery retry idempotent. A second conversation can start a job while the first is still running; a second distinct request in the same running conversation receives 409. The included runner admits up to 20 concurrent jobs and times out a job after five minutes.

The store uses `Map<conversationId, ConversationState>`, with a message dictionary and ordered message IDs in each entity. The active ID is derived from the route and affects only display/read receipts. Conversation, history-list and runtime subscriptions are separate. Unchanged message objects are reused for tool-only updates, so memoized messages do not re-render unnecessarily. The sidebar ignores token/tool-only revision changes.

### WebSocket lifecycle

`runtime.ts` initializes the cookie session and owns one `RealtimeClient`; it is outside the React render lifecycle. Navigation and component unmounts do not disconnect it. HMR explicitly tears down listeners and the socket. Multiple browser tabs may each have one socket for the same session.

The client resumes with its last event sequence. Event IDs prevent duplicates, socket identity checks reject obsolete callbacks, and server snapshots carry monotonically increasing conversation revisions. Reconnect starts at approximately 1, 2, 4, 8, 16, and 30 seconds with jitter and stays capped. An incomplete handshake is replaced after 12 seconds. Offline cancels retries; online resumes. Server ping/pong detects dead peers.

The journal retains at most 200 events per session. Older cursors receive a full-sync request. Deletion removes retained message snapshots for that conversation from the replay journal and raises a replay floor. Full sync reconciles deletions as well as updates.

### Asynchronous safety

- HTTP results always address their original ID. A → B → C navigation cannot replace C with A.
- A snapshot older than the current revision is rejected, even if delivered by HTTP after a socket event.
- In-flight loads are deduplicated by ID.
- Deleted IDs are tombstoned on client and server; late events, loads and retry attempts cannot resurrect them.
- An acknowledgement replaces the optimistic message by request ID, even when the backend message ID differs.
- If HTTP fails after a socket acknowledgement, the accepted user message is not marked failed.
- Closing a socket does not abort generation. Deleting a chat explicitly does.
- Generation callbacks check the job's controller and current identity before writing.

### Persistence and recovery

SQLite WAL is the source of truth for the local workspace. The browser stores only the session cookie and a sidebar preference; drafts and scroll positions live in memory. User messages and final/partial assistant content survive browser refresh. In-progress jobs survive browser navigation and socket loss because they run in the server. Server restarts mark interrupted jobs as failed; replayable events and snapshots restore the true state.

### Tool and content rendering

Tool events are generation runtime records with IDs, labels and states. They never become assistant messages. The provider may publish accumulated partial text; writes are throttled to 100 ms. Completed tool details collapse. Failed/running tools keep their actual status instead of being automatically labeled successful.

`MessageRenderer` is the rendering boundary. Markdown disallows raw HTML, sanitizes link protocols through react-markdown and does not load remote images. Domain renderers can register predicates, but no domain card is created without a real typed payload.

## Main files

- `src/features/chat/components/`: layout, sidebar, dialogs, composer, messages, tools and connection notice.
- `src/features/chat/store/`: normalized state, subscriptions and reconciliation.
- `src/features/chat/services/`: validated HTTP DTOs and app-scoped realtime transport.
- `shared/protocol.ts`: typed and runtime-validated internal contract.
- `server/repository.ts`: local persistence and event journal.
- `server/app.ts`: local API, routing, ownership, replay and job lifecycle.
- `server/provider.ts`: external service boundary, deliberately unconfigured.
- `tests/`: focused model/transport/integration tests and browser scenarios.

## Integration phase still required

Inspect the real service DTOs and choose one authoritative owner for conversations/history. If it already owns persistence, replace the local repository/API adapter with forwarding to those APIs; do not maintain a second independent history. If its sockets are conversation-specific, keep provider connections in an app/server-level manager until the jobs finish. If the upstream cancels work on disconnect or cannot replay/restore running work, document that limit and request only the smallest server change: durable request state and conversation-tagged events or result retrieval.
