# Real service integration

Known address: `http://localhost:8080`. The service is not currently running. No endpoint, auth header, message DTO, tool event or final-response shape has been assumed.

The UI badge and failure message intentionally expose the missing integration. There is no demo AI fallback. The local API persists a user message and records an honest failed generation while `UnconfiguredProvider` is selected; retry reuses the saved message and request ID.

## Information required

1. Authentication method and user/session identity; secrets are server-only environment variables.
2. Conversation creation, generated IDs, list/history pagination, rename/delete, title generation.
3. Send protocol and acknowledgement/idempotency semantics.
4. WebSocket URL, handshake, session versus conversation scope, event types and correlation fields.
5. Actual tool status/result events, streaming events and final/error events.
6. Concurrent request limits; reconnect replay, result retrieval and running-job restoration.

## Adapter contract

Implement `CopilotProvider` in `server/provider.ts` and explicitly select it in `server/index.ts`:

```ts
interface CopilotProvider {
  available: boolean;
  name: string;
  generate(input: {
    conversationId: string;
    requestId: string;
    messages: Message[];
    signal: AbortSignal;
    onTool: (tool: ToolExecution) => void;
    onText: (accumulatedText: string) => void;
  }): Promise<string>;
}
```

`onText` receives accumulated content, not a token delta. Final return content is authoritative. Forward only genuine tool labels and statuses. Correlate using both conversation and request IDs. Persist any mapping to upstream conversation/request IDs if the upstream generates different IDs. Do not assume that a local UUID is valid upstream.

The application server—not the browser connection—owns the call. Honor cancellation for explicit deletion/timeouts/shutdown, never for tab/route switching. Translate upstream errors into safe categories without forwarding secrets, raw stack traces or internal payloads.

If the upstream already provides the complete conversation and realtime contract, replacing `src/features/chat/services/api.ts` and the realtime protocol adapter may be the smaller solution. Retain the store's revision/idempotency invariants and adapt the focused tests to actual DTOs. The local backend is replaceable support for this new frontend, not a required rewrite of the existing service.

## Limits to verify before connecting

- No correlation field: require conversation/request identity in events, or maintain one managed socket per upstream conversation.
- Cancellation on socket close: require durable server-side execution or keep the provider socket alive independent of navigation.
- No replay/history/status lookup: background work can continue while connected, but browser-refresh recovery cannot be promised.
- No idempotency: do not blindly resend requests with an unknown outcome; reconcile history/request status first.
- One job per session: explicitly queue or show the actual limitation rather than pretending parallel generation works.
