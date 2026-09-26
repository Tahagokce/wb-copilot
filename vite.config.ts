import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Only the frontend development server. HTTP/WS clients connect to the existing BE.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
