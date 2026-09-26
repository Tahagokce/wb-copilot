# Architecture

The workspace began as a new project. The supplied backend contract is now authoritative; the earlier local backend scaffold and server dependencies have been removed.

- React Router owns active selection at `/chat` and `/chat/:conversationId`.
- ChatStore owns normalized independent conversation/message state and scoped subscriptions. Local revision counters protect in-flight history reconciliation; they are not backend versions.
- api.ts owns POST/GET/DELETE conversation management and validates backend DTOs.
- RealtimeClient owns one browser WebSocket, parsing, ordered Blob delivery, socket identity guards, online/offline listeners through runtime, and bounded exponential reconnect with jitter.
- Runtime is acquired by the application root and released on unmount. StrictMode effect probing reuses it. Routes do not own transport lifetime.
- reduce-event.ts routes only by the event conversationId. Null-ID events are never attributed to the active conversation. Global errors appear in connection status.
- Messages have optimistic, streaming, completed and failure states. Tool/status content belongs to generation state. SafeMarkdown renders escaped React nodes without arbitrary HTML or external Markdown dependencies.

First send calls POST without a body, registers the returned ID, navigates only if the user has stayed on the originating route, and sends USER_MESSAGE through WebSocket. Duplicate sends within a running conversation are blocked; other conversations remain available. A synchronous socket send failure retains the user message for retry. ASSISTANT_STARTED acknowledges the send and creates the streaming assistant message.

History loads are deduplicated per ID, merge against live updates, and never replace another route's entity. Successful deletion tombstones the ID so delayed events cannot resurrect it. Backend titles are refreshed on completion. Rename is absent because no endpoint exists.

Connection interruption preserves messages, shows uncertain delivery, and refreshes known histories on reconnect. It does not automatically replay user requests. Browser refresh retrieves persisted history; drafts, tool activity, unread markers and scroll positions are local session state.
