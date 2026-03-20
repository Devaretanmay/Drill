/**
 * Status Command Module
 *
 * Shows current authentication status, plan info, and provider config.
 */

import chalk from 'chalk';
import { loadAuth, maskKey, hasStoredAuth, getProvider, getProviderModel } from '../lib/auth.js';
import { getProviderApiKey, getProviderEnvVar } from '../lib/providers.js';

/**
 * Shows current auth status and plan info from local cache.
 */
export async function statusCommand(): Promise<void> {
  const auth = loadAuth();
  const hasKey = hasStoredAuth();
  const envKey = process.env['DRILL_API_KEY'];
  const provider = getProvider();
  const providerModel = getProviderModel();

  console.log(`\n  ${chalk.bold('Drill Status')}\n`);

  // Provider section
  console.log(`  ${chalk.bold('Provider:')}`);
  console.log(`    ${chalk.cyan(provider.padEnd(12))} (${chalk.dim(providerModel)})`);

  if (provider === 'ollama') {
    console.log(`  ${chalk.dim('  Local model — no API key needed.')}`);
    console.log(`  ${chalk.dim('  Check if running:')} ${chalk.cyan('ollama serve')}\n`);
  } else {
    const envVar = getProviderEnvVar(provider);
    console.log(`  ${chalk.dim(`  Env var: ${envVar}`)}`);
  }

  console.log('');

  // API Key section
  console.log(`  ${chalk.bold('API Key:')}`);
  const configKey = auth?.apiKey ?? '';
  const providerKey = configKey || envKey || '';

  if (providerKey) {
    console.log(`    ${chalk.green('✓')} ${chalk.dim(maskKey(providerKey))}`);
    console.log(`    Source: ${chalk.dim(hasKey && configKey ? '~/.drill/config' : envKey ? 'DRILL_API_KEY' : '~/.drill/config')}`);
  } else {
    console.log(`    ${chalk.red('✗')} No API key found`);
    const envVar = getProviderEnvVar(provider);
    if (envVar) {
      console.log(`  ${chalk.dim(`  Set ${envVar} in your environment, or run`)}`);
      console.log(`  ${chalk.cyan('  drill setup')}`);
    }
  }

  console.log('');

  // Plan section
  if (auth) {
    console.log(`  ${chalk.bold('Plan:')} ${chalk.bold(auth.plan)}`);

    const remaining = Math.max(0, auth.runLimit - auth.runCount);
    if (remaining <= 5) {
      console.log(`  ${chalk.yellow(`  Runs: ${auth.runCount}/${auth.runLimit} (${remaining} remaining)`)}`);
    } else {
      console.log(`    Runs: ${chalk.dim(`${auth.runCount}/${auth.runLimit} (${remaining} remaining)`)}`);
    }
    console.log(`  ${chalk.dim('  (Run counts are cached locally)')}`);
  } else {
    console.log(`  ${chalk.bold('Plan:')} ${chalk.dim('unknown')}`);
    console.log(`  ${chalk.dim('  Run "drill login" to link your account.')}`);
  }

  console.log('\n');
}
