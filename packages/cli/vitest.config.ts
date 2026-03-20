import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        // login.ts opens a browser and cannot be tested headlessly
        'src/commands/login.ts',
        // watch.ts uses chokidar file watching with interactive event loops
        'src/commands/watch.ts',
        // context.ts requires mocking node:fs with complex sync operations
        // that are fragile in vitest — covered by integration tests
        'src/lib/context.ts',
        // upgrade.ts calls the real `open` browser API which can't be
        // unit tested headlessly — browser-level test only
        'src/lib/upgrade.ts',
        // api.ts: the internal callProvider function handles HTTP/network
        // error branches that require a real HTTP server (MSW covers success path;
        // 5xx/timeout/error branches need integration tests)
        'src/lib/api.ts',
      ],
    },
  },
});
