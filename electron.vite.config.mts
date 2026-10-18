import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = {
  '@core': resolve(import.meta.dirname, 'src/core'),
  '@shared': resolve(import.meta.dirname, 'src/shared'),
};

export default defineConfig({
  main: {
    resolve: { alias },
    // Bundle runtime dependencies so packaged builds need no node_modules.
    build: { externalizeDeps: false },
  },
  preload: {
    resolve: { alias },
    // The sandboxed preload must be one self-contained CommonJS file.
    build: { externalizeDeps: false },
  },
  renderer: {
    resolve: { alias: { ...alias, '@renderer': resolve(import.meta.dirname, 'src/renderer/src') } },
    plugins: [react()],
  },
});
