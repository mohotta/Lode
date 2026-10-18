import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Manual, real-provider evals (HLD §12 "Manual" row). Never part of `pnpm test`.
// Endpoint, model and key come from the environment and are never written to disk.
export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(import.meta.dirname, 'src/core'),
      '@shared': resolve(import.meta.dirname, 'src/shared'),
    },
  },
  test: { include: ['tests/evals/**/*.eval.ts'], testTimeout: 900_000 },
});
