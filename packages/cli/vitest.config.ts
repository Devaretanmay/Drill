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
        'src/types.ts',
        'src/commands/login.ts',
        'src/commands/register.ts',
        'src/commands/status.ts',
        'src/commands/watch.ts',
        'src/lib/upgrade.ts',
        'src/lib/supabase.ts',
        'src/lib/identity.ts',
        'src/lib/api.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '../../src/lib/models': '/Users/tanmaydevare/Tanmay/drill/packages/cli/src/lib/models.ts',
      '../../src/lib/context': '/Users/tanmaydevare/Tanmay/drill/packages/cli/src/lib/context.ts',
    },
  },
});
