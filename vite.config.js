import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Set VITE_API_BASE_URL to http://localhost:3001 in .env for local work.
    // No dev proxy is configured, because the deployed app talks to the API
    // cross-origin and a proxy here would hide a broken CORS setup until
    // production.
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // The app is one bundle by design: it is an internal control plane behind
    // a login, not a public site where first paint is the metric that matters.
    chunkSizeWarningLimit: 700,
  },
});
