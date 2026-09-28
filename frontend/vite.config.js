import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development Vite proxies /api to the backend, so the browser only ever
// talks to one origin and there is no CORS to configure. In production the
// NGINX Ingress does the same job (see kubernetes/ingress/).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
