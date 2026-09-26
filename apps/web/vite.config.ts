import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // The API (`apps/api`, port 3000) serves the built app on the same origin in production.
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
