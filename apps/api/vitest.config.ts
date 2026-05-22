import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Env applied before test modules are evaluated. The tested modules
    // (jwt.ts, s3.ts) read process.env at import time, so the secret must
    // be present before their static imports run.
    env: {
      JWT_SECRET: 'test-secret-do-not-use-in-production',
    },
    include: ['src/**/*.test.ts'],
  },
});
