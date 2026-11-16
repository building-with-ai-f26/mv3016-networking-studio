/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    // Browser calls /api/...; Vite forwards them to the local API server (app/server).
    proxy: { '/api': 'http://127.0.0.1:8787', '/auth': 'http://127.0.0.1:8787' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
