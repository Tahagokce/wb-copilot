# Validation

Focused Vitest tests cover exact HTTP paths and bodyless creation, server-owned conversation IDs, exact outbound WebSocket frames, one socket across sends to multiple conversations, stream accumulation, tool/error transitions, optimistic acknowledgements and failed-send retry, independent background events and unread state, out-of-order HTTP loads, deleted-chat tombstones, stale history protection, bounded reconnect, offline recovery, intentional cleanup and stale socket callbacks.

Test doubles exist only inside tests; production always calls the configured backend. Run `npm test` and `npm run build`.

Live end-to-end backend verification remains pending: localhost:8080 refused connections during this implementation. Once the backend runs, manually check refresh/deep links, Back/Forward, simultaneous A/B generation, unread completion, network interruption, mobile drawer, and scroll-up/new-message behavior. The automated checks do not claim that the unavailable backend executed those scenarios.

Generic action coverage: merging/deduplication, continued streaming and tool state, conversation isolation, error preservation, empty/unknown/unsafe actions, history hydration and preservation, explicit navigation execution for both targets, and server-rendered button ordering/icon fallback. After this addition, 32 tests and the TypeScript/production build passed. Browser interaction with a live backend has not been verified by these unit tests.

Structured block coverage brings the suite to 39 passing tests: block upsert, simultaneous text/actions/tools, stream completion and errors, conversation isolation, stale history preservation and optional REST hydration, safe formatting, unknown column fallback, search, page reset/clamping, dynamic escaped table rendering, empty results and shared row-action rendering. TypeScript and production build pass. Tests use in-memory test data only; no production API mock or new server is introduced. Live browser/backend end-to-end verification remains separate from these automated checks.
