# Integration limits

The provided contract has no event ID, sequence, request ID, replay cursor, running-job query, or idempotency key. Therefore the client cannot guarantee replay of missed deltas, exactly-once delivery after an uncertain disconnect, or restoration of in-progress generation after refresh. Reconnect reloads persisted history and does not automatically resend requests. Local request/message IDs exist only for UI bookkeeping.

HTTP history and concurrent live events are reconciled conservatively. Identical repeated messages without stable event IDs remain inherently ambiguous. Server-provided message/request IDs and a replay cursor would eliminate that ambiguity; a job-state endpoint would permit reliable recovery of running work.

Navigation keeps the socket open, allowing background generation. Whether generation survives a browser refresh or socket loss depends on the backend. No client-side promise of backend job continuation or cancellation on deletion is made.

The contract exposes no rename, content-search, server unread receipts, or structured domain cards. Search filters real conversation titles, read markers remain local, and no fake domain data is rendered.
