import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'demo',
  base: './',
  plugins: [react()],
  resolve: { alias: { 'paper-shaders-webgpu': resolve(__dirname, 'src/index.ts') } },
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'demo/index.html'),
        bench: resolve(__dirname, 'demo/bench.html'),
        benchAll: resolve(__dirname, "demo/bench-all.html"),
        diff: resolve(__dirname, 'demo/diff.html'),
      },
    },
  },
});
