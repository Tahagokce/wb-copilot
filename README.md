# WB Copilot

A multi-conversation aviation chat workspace built with React, TypeScript, Vite, a small Node server, and SQLite. Conversations belong to the application store and server, not to React routes or WebSocket connections.

**Integration status:** the supplied upstream address is `http://localhost:8080`. Its contract is not available and it is intentionally not contacted. The production entry point uses `UnconfiguredProvider`: messages and history work, but no AI answer or flight/tool data is fabricated. Complete the adapter once the real HTTP/WebSocket contract is supplied. See [service integration](docs/service-integration.md).

## Run locally

Requires Node **22.13+** (developed and tested on Node 24). Node's built-in SQLite currently prints an experimental warning on some versions.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open **http://127.0.0.1:5173/chat**. The local application server listens on `127.0.0.1:3001`. Keep the same browser hostname: `localhost` and `127.0.0.1` have separate cookies. If changing the frontend origin, change `APP_ORIGIN` too.

```sh
npm run build
npm start
```

The built app and API are served together at **http://127.0.0.1:3001/chat**. Deep links fall back to the application HTML. In an HTTPS deployment set `APP_ORIGIN` to the real origin and `COOKIE_SECURE=true`. Keep `.data/` on persistent storage and back it up. No service secrets belong in `VITE_` variables.

## Implemented

- Lazy conversation creation on the first send; `/chat` and `/chat/:id`, refresh, Back/Forward.
- Persistent history, title search, dynamic date groups, rename, confirmed deletion, unread completions.
- Application-level socket with explicit states, heartbeat, handshake timeout, bounded exponential reconnect and jitter, offline handling, event replay/full sync, duplicate and stale socket protection.
- Per-conversation generation, drafts, optimistic messages, retry with the same idempotency key, acknowledgements, independent background updates.
- Separate tool runtime state, streaming-ready messages, safe Markdown with tables and copyable code, a domain renderer extension point.
- Follow-bottom scrolling, saved per-conversation scroll positions, new-message indicator, multiline/IME-friendly composer.
- Desktop sidebar and mobile modal drawer, keyboard focus, native confirmation dialogs, reduced-motion styling.
- Session ownership checks, same-origin checks, request validation, deleted-conversation tombstones and bounded event journal.

## Validation

```sh
npm test                  # Store, transport, real HTTP/WS and SQLite tests
npm run build             # Strict TypeScript + production bundle
npx playwright install chromium
npm run test:e2e           # Browser scenarios, using test-only controlled provider
```

The browser suite requires a successful build first. `tests/ui-fixture.ts` runs on port 4174 with an in-memory database. It is imported only by test tooling, uses explicitly labeled synthetic responses, and does not call the upstream service. It is not an application mode or environment-variable shortcut in production.

See [architecture](docs/architecture.md), [internal protocol](docs/protocol.md), and [validation record](docs/validation.md).

## Deployment boundaries

This is a working local application foundation, not a claim that the unavailable aviation service has been integrated or certified for operations. The local session cookie restores one browser's workspace; enterprise identity, cross-device access, and the upstream authorization model must be connected to the real service before broader deployment.

The included server is a **single-process** job runner. A process restart marks unfinished generations as interrupted and retryable; it never reports invented completion. Multiple replicas require a shared durable job queue and event broker. Snapshot persistence is intentionally small and replaceable; very large histories should move to paged message storage and delta events after the upstream contract is known.
