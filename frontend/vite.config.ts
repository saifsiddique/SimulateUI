import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// The backend (uvicorn) is reached through this proxy in `vite dev` and `vite preview`; in
// production FastAPI serves `dist/` itself, so relative URLs work everywhere. Unusual default
// ports (8765 backend, 5273 dev, 4273 preview) avoid clashes with other projects; run.ps1 /
// run.sh export EMSIM_PORT and EMSIM_DEV_PORT to override them.
const backend = `http://127.0.0.1:${process.env.EMSIM_PORT ?? 8765}`;

export default defineConfig({
  base: './',
  plugins: [svelte()],
  server: {
    port: Number(process.env.EMSIM_DEV_PORT ?? 5273),
    strictPort: true,
    proxy: { '/api': { target: backend, ws: true } },
  },
  preview: {
    port: 4273,
    strictPort: true,
    proxy: { '/api': { target: backend, ws: true } },
  },
  // three.js alone is ~500 kB minified; it loads with the viewer, not with the first paint.
  build: { target: 'es2023', chunkSizeWarningLimit: 900 },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
