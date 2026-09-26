# Validation

Focused Vitest tests cover exact HTTP paths and bodyless creation, server-owned conversation IDs, exact outbound WebSocket frames, one socket across sends to multiple conversations, stream accumulation, tool/error transitions, optimistic acknowledgements and failed-send retry, independent background events and unread state, out-of-order HTTP loads, deleted-chat tombstones, stale history protection, bounded reconnect, offline recovery, intentional cleanup and stale socket callbacks.

Test doubles exist only inside tests; production always calls the configured backend. Run `npm test` and `npm run build`.

Live end-to-end backend verification remains pending: localhost:8080 refused connections during this implementation. Once the backend runs, manually check refresh/deep links, Back/Forward, simultaneous A/B generation, unread completion, network interruption, mobile drawer, and scroll-up/new-message behavior. The automated checks do not claim that the unavailable backend executed those scenarios.
