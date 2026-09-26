# WB Copilot frontend

React + TypeScript chat client for the existing W&B backend. This repository runs no backend or WebSocket server and contains no mock API implementation.

## Run

Use Node 22.13 or newer, run `npm install`, then `npm run dev`. Optionally copy `.env.example` to `.env.local`:

```env
VITE_API_BASE_URL=http://localhost:8080/api/v1
VITE_COPILOT_WS_URL=ws://localhost:8080/api/v1/copilot/chat
```

The backend must allow the frontend origin for HTTP/CORS and WebSocket access. HTTP uses credentials; authentication is owned by the existing backend. Production hosting must serve index.html for `/chat` and `/chat/:conversationId`.

`npm test` runs focused contract, state, and transport tests. `npm run build` checks TypeScript and builds the frontend.

Runtime dependencies are limited to react, react-dom, react-router-dom, and lucide-react. TypeScript, Vite, and Vitest are development tools.

## Behavior

New chat is lazy: the first send creates the conversation with HTTP POST and uses the returned server ID. History/list/delete use HTTP. All chat messages use one application WebSocket. Navigation never selects a different socket endpoint. Background events update their own conversations and completed inactive chats become unread.

See [architecture](docs/architecture.md), [protocol](docs/protocol.md), [integration limits](docs/service-integration.md), and [validation](docs/validation.md).
