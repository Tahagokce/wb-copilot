export interface BackendConfig { apiBaseUrl: string; wsUrl: string }
export const backendConfig: BackendConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1',
  wsUrl: import.meta.env.VITE_COPILOT_WS_URL || 'ws://localhost:8080/api/v1/copilot/chat',
};
export const backendCapabilities = { realtime: true, history: true, detail: true, send: true, rename: false, delete: true };
