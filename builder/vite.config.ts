import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Reached in prod/local-preview via nginx at localhost:10004/builder/ (see
  // therum-os/conf/nginx/site.conf.hbs) — base must match that mount path so
  // asset/HMR URLs resolve correctly through the proxy. Direct :5174 access
  // (bypassing nginx) still works fine with this set.
  base: '/builder/',
  server: {
    port: 5174,
    // Allow importing the shared token file from the repo root (../shared).
    fs: { allow: ['..'] },
    proxy: {
      // Builder talks to the live API for real data binding.
      '/api': { target: 'http://localhost:4100', changeOrigin: true },
    },
  },
});
