import { Command } from 'commander';
import { runCommand } from './commands/run.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { statusCommand } from './commands/status.js';
import { configCommand } from './commands/config.js';
import { watchCommand } from './commands/watch.js';
import { setupCommand } from './commands/setup.js';
import type { WatchOptions } from './commands/watch.js';

declare const __VERSION__: string;
const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

const program = new Command();

program
  .name('drill')
  .description('AI-powered log diagnosis — pipe any log, get the root cause')
  .version(version, '-v, --version')
  .argument('[input]', 'Log text to analyze (alternative to stdin pipe)')
  .option('--no-redact', 'Disable PII redaction (use only for non-sensitive logs)')
  .option('--lines <n>', 'Analyze only the last N lines of input')
  .option('--context <dir>', 'Add source code context from directory')
  .option('--json', 'Output raw JSON result to stdout (status messages to stderr)')
  .option('--ci', 'CI mode: exit code 1 if cause found with confidence >= 50%')
  .option('--local', 'Use local Ollama model (nothing sent to API)')
  .option('--model <name>', 'Local model name when using --local (default: llama3.2)')
  .option('--verbose', 'Show redaction stats, timing, and debug info')
  .option('--timeout <seconds>', 'Request timeout in seconds (default: 90)')
  .option('--watch <file>', 'Watch a file for errors and auto-analyze')
  .action(async (input: string | undefined, options: Record<string, unknown>) => {
    if (options['watch']) {
      await watchCommand(options as unknown as WatchOptions);
    } else {
      await runCommand(input, options as Parameters<typeof runCommand>[1]);
    }
  });

program
  .command('setup')
  .description('Configure your LLM provider (interactive wizard)')
  .action(async () => {
    await setupCommand();
  });

program
  .command('login')
  .description('Authenticate with drill.dev to unlock your account')
  .action(async () => {
    await loginCommand();
  });

program
  .command('logout')
  .description('Remove stored authentication token')
  .action(async () => {
    await logoutCommand();
  });

program
  .command('status')
  .description('Show current plan, run count, and API key status')
  .action(async () => {
    await statusCommand();
  });

const configCmd = program
  .command('config')
  .description('Show or modify drill configuration');

configCmd
  .command('list')
  .description('List all configuration values')
  .action(async () => {
    await configCommand({ action: 'list' });
  });

configCmd
  .command('get')
  .description('Get a configuration value')
  .argument('<key>', 'Configuration key')
  .action(async (key: string) => {
    await configCommand({ action: 'get', key });
  });

configCmd
  .command('set')
  .description('Set a configuration value')
  .argument('<key>', 'Configuration key')
  .argument('<value>', 'Value to set')
  .action(async (key: string, value: string) => {
    await configCommand({ action: 'set', key, value });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n  Unexpected error: ${msg}\n`);
  process.exit(1);
});
