/**
 * Config Command Module
 *
 * drill config list     — show all configuration
 * drill config get <key> — show a specific key
 * drill config set <key> <value> — set a key
 *
 * Note: apiKey is managed by `drill login` / `drill logout`.
 * Setting apiKey directly is not supported.
 */

import chalk from 'chalk';
import { loadAuth, saveAuth, maskKey, hasStoredAuth } from '../lib/auth.js';
import { VALID_PROVIDERS } from '../lib/providers.js';
import type { ProviderName } from '../types.js';

type ConfigAction = 'list' | 'get' | 'set';

export interface ConfigOptions {
  action: ConfigAction;
  key?: string;
  value?: string;
}

/**
 * Executes the config command.
 */
export async function configCommand(options: ConfigOptions): Promise<void> {
  switch (options.action) {
    case 'list':
      await listConfig();
      break;
    case 'get':
      if (!options.key) {
        console.error('\n  Error: key required for get command.\n');
        console.error('  Usage: drill config get <key>\n');
        process.exit(1);
      }
      await getConfig(options.key);
      break;
    case 'set':
      if (!options.key || !options.value) {
        console.error('\n  Error: key and value required for set command.\n');
        console.error('  Usage: drill config set <key> <value>\n');
        process.exit(1);
      }
      await setConfig(options.key, options.value);
      break;
  }
}

async function listConfig(): Promise<void> {
  const auth = loadAuth();

  console.log(`\n  ${chalk.bold('Drill Configuration')}\n`);

  console.log(`  ${chalk.bold('Provider:')}`);
  if (auth?.provider) {
    console.log(`    provider:       ${chalk.green(auth.provider)}`);
    console.log(`    providerModel:  ${chalk.green(auth.providerModel)}`);
    if (auth.provider === 'custom' && auth.customUrl) {
      console.log(`    customUrl:      ${chalk.green(auth.customUrl)}`);
    }
  } else {
    console.log(`    ${chalk.dim('provider:       not configured (defaults to minimax)')}`);
    console.log(`    ${chalk.dim('providerModel:  MiniMax-M2.5')}`);
  }

  console.log(`\n  ${chalk.bold('Authentication:')}`);
  if (hasStoredAuth() && auth) {
    console.log(`    apiKey:  ${chalk.green(maskKey(auth.apiKey))} ${chalk.dim('(from ~/.drill/config)')}`);
    console.log(`    apiUrl:  ${chalk.green(auth.apiUrl)}`);
    console.log(`    plan:    ${chalk.green(auth.plan)}`);
    console.log(`    runs:    ${auth.runCount}/${auth.runLimit}`);
  } else {
    const envKey = process.env['DRILL_API_KEY'];
    if (envKey) {
      console.log(`    apiKey:  ${chalk.yellow(maskKey(envKey))} ${chalk.dim('(from DRILL_API_KEY env)')}`);
    } else {
      console.log(`    ${chalk.red('No API key configured.')} ${chalk.dim('Run "drill login" or set DRILL_API_KEY.')}`);
    }
  }

  console.log('\n');
}

async function getConfig(key: string): Promise<void> {
  const auth = loadAuth();

  switch (key) {
    case 'provider':
      console.log(auth?.provider ?? 'minimax');
      break;
    case 'providerModel':
      console.log(auth?.providerModel ?? 'MiniMax-M2.5');
      break;
    case 'customUrl':
      console.log(auth?.customUrl ?? '');
      break;
    case 'apiKey':
    case 'apikey':
      if (auth?.apiKey) {
        console.log(maskKey(auth.apiKey));
      } else if (process.env['DRILL_API_KEY']) {
        console.log(maskKey(process.env['DRILL_API_KEY'] ?? ''));
      } else {
        console.error(`\n  Error: ${key} is not set.\n`);
        process.exit(1);
      }
      break;
    case 'apiUrl':
    case 'apiurl':
      console.log(auth?.apiUrl ?? 'https://api.drill.dev');
      break;
    case 'plan':
      console.log(auth?.plan ?? 'unknown');
      break;
    case 'runs':
    case 'runCount':
      console.log(`${auth?.runCount ?? 0}/${auth?.runLimit ?? 20}`);
      break;
    case 'runLimit':
      console.log(String(auth?.runLimit ?? 20));
      break;
    default:
      console.error(`\n  Error: unknown config key "${key}".\n`);
      console.error('  Known keys: provider, providerModel, customUrl, apiKey, apiUrl, plan, runs, runLimit\n');
      process.exit(1);
  }
}

async function setConfig(key: string, value: string): Promise<void> {
  if (key === 'apiKey' || key === 'apikey') {
    console.error('\n  Error: cannot set apiKey directly.\n');
    console.error('  Use "drill login" to authenticate and save your API key.\n');
    process.exit(1);
  }

  if (key === 'plan' || key === 'runCount' || key === 'runLimit') {
    console.error(`\n  Error: ${key} is read-only.\n`);
    console.error('  These values are managed by the server after authentication.\n');
    process.exit(1);
  }

  if (key === 'provider') {
    if (!VALID_PROVIDERS.includes(value as ProviderName)) {
      console.error(`\n  Error: Unknown provider: ${value}.\n`);
      console.error(`  Valid providers: ${VALID_PROVIDERS.join(', ')}\n`);
      process.exit(1);
    }

    const auth = loadAuth();
    const newAuth = {
      ...(auth ?? {}),
      provider: value as ProviderName,
    };
    saveAuth(newAuth as Parameters<typeof saveAuth>[0]);
    console.log(`\n  ${chalk.green('✓')} Provider set to ${value}.\n`);
    return;
  }

  if (key === 'providerModel') {
    const auth = loadAuth();
    const newAuth = {
      ...(auth ?? {}),
      providerModel: value,
    };
    saveAuth(newAuth as Parameters<typeof saveAuth>[0]);
    console.log(`\n  ${chalk.green('✓')} Provider model set to ${value}.\n`);
    return;
  }

  if (key === 'customUrl') {
    const auth = loadAuth();
    const newAuth = {
      ...(auth ?? {}),
      customUrl: value,
    };
    saveAuth(newAuth as Parameters<typeof saveAuth>[0]);
    console.log(`\n  ${chalk.green('✓')} Custom URL set.\n`);
    return;
  }

  console.error(`\n  Error: "${key}" is not a writable config key.\n`);
  console.error('  Writable keys: provider, providerModel, customUrl\n');
  console.error('  Managed by "drill login": apiKey, apiUrl, plan, runs\n');
  process.exit(1);
}
