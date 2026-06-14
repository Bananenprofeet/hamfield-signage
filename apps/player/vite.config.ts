import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// base './' so the bundle works when served by the device agent at any path.
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      // Bundle the shared package from source: its dist build is CommonJS,
      // whose named exports Rollup cannot statically resolve.
      '@signage/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5174 },
});
