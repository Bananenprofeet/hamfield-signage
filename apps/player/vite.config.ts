import { defineConfig } from 'vite';

// base './' so the bundle works when served by the device agent at any path.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5174 },
});
