# Validation record

Validated locally on 2026-09-27. The real service at `http://localhost:8080` was unavailable; no claim below represents a successful integration with that service.

## Executed checks

- `npm test`: **34 passed**, across store, realtime and server/repository suites.
- `npm run build`: strict TypeScript and optimized production bundle succeeded.
- `npm ls --depth=0`: installed top-level dependencies resolved successfully.
- Dependency installation after the Vitest security update reported **0 known vulnerabilities**.
- Local browser checks against the real unconfigured application: first-send URL creation, saved user message, honest service-unavailable response, direct-link reload restoration.
- Local browser checks against `tests/ui-fixture.ts`: independent A/B generation, unread completion, returning to A, Back/Forward, refresh, long-content auto-follow, user scroll preservation, new-message button, 390px mobile layout, mobile drawer, rename, title search and delete confirmation/cancel.

The separate Playwright suite in `tests/browser/chat.spec.ts` is provided for repeatable CI coverage. **Its CLI run was not executed in this session**; browser scenarios above were exercised through the available browser-control tools. Run it with the commands in the README after installing Chromium.

## Requested scenarios

| Scenario | Evidence |
| --- | --- |
| 1. Send, respond, refresh | Real HTTP/SQLite tests; completed test-provider response restored by browser refresh |
| 2. A generates while B is active | Independent server jobs plus browser fixture: B stayed isolated; A showed unread and retained its response |
| 3. Rapid A → B → C with delayed loads | Store test resolves loads out of order; revisions reject stale snapshots |
| 4. Connection loss/recovery | Fake-clock transport tests and real socket disconnect/replay tests; history remains in the store/repository |
| 5. Empty New Chat | No creation API call in store test; fresh browser screen had no history until first send |
| 6. Direct conversation URL | Browser reload loads the ID's persisted messages; server serves deep routes |
| 7. Back/Forward | Browser checked A/B navigation and corresponding response content |
| 8. Reader scrolled up | Long browser fixture stayed at test section 1 while new content arrived; New messages scrolled to the latest reply |
| 9. Send failure and retry | Store tests retain text, reuse request ID and reconcile socket acknowledgements; browser displayed retry for an initial transport rejection |
| 10. Concurrent realtime events | Store and real server/socket tests verify correct conversation attribution |

## Issues found and corrected during validation

- A development reverse proxy rewrote the Host header; explicit configured Origin validation now supports the frontend while rejecting unrelated origins.
- MessageList and Composer had the same React key; distinct prefixes prevent stale DOM during conversation switches. The A/B browser scenario was repeated after this correction.
- Full sync now reconciles deletions missed outside the replay window, and failed direct-link loads do not become phantom history entries.
- The event journal is bounded, deleted message content is removed from retained snapshots, and old cursors receive authoritative full sync.
- Jobs have a bounded timeout; explicit cancellation and shutdown clear pending timers.

## Not verified / remaining integration

Actual service authentication, upstream persistence, upstream WebSocket DTOs, real tool failures, real streaming, real concurrency limits and upstream restart/replay support cannot be verified until that service and its contract are available. Production identity, multi-device ownership and multiple backend replicas remain deployment/integration work, not silently simulated behavior.
