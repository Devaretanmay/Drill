import chalk from 'chalk';
import { getStatus } from '../lib/identity.js';
import { getApiKey, loadAuth } from '../lib/auth.js';

export async function statusCommand(): Promise<void> {
  const apiKey = getApiKey();
  const config = loadAuth();

  if (!apiKey) {
    console.log(chalk.yellow('\n  Not registered. Run: drill register\n'));
    return;
  }

  const status = await getStatus(apiKey);

  if (!status.found) {
    console.log(chalk.yellow('\n  Not registered. Run: drill register\n'));
    return;
  }

  const limit   = status.limit ?? 100;
  const used    = status.runsWeek ?? 0;
  const pct     = Math.min(100, Math.round((used / limit) * 100));
  const filled  = Math.round(pct / 10);
  const bar     = chalk.hex('#3FB950')('█'.repeat(filled)) +
                  chalk.hex('#30363D')('░'.repeat(10 - filled));
  const reset   = status.weekReset
    ? new Date(status.weekReset).toLocaleDateString('en-US',
        { weekday: 'long', month: 'short', day: 'numeric' })
    : 'Monday';

  console.log('\n' + chalk.bold('  drill status'));
  console.log(chalk.dim('  ────────────────────────────'));
  console.log(`  ${chalk.dim('email')}     ${status.email}`);
  console.log(`  ${chalk.dim('plan')}      ${chalk.bold(status.plan ?? 'free')}`);
  console.log(`  ${chalk.dim('usage')}     ${bar} ${used}/${limit === 999999 ? '∞' : limit}`);
  console.log(`  ${chalk.dim('resets')}    ${reset}`);
  console.log(`  ${chalk.dim('provider')}  ${config?.provider ? chalk.cyan(config.provider) : chalk.dim('not set')}`);
  if (config?.providerModel) {
    console.log(`  ${chalk.dim('model')}     ${config.providerModel}`);
  }
  console.log(chalk.dim('  ────────────────────────────\n'));
}
