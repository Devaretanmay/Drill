import chalk from 'chalk';
import { loadAuth } from '../lib/auth.js';
import type { ProviderName } from '../types.js';
import { VALID_PROVIDERS } from '../lib/providers.js';

type ConfigAction = 'list' | 'get' | 'set';

export interface ConfigOptions {
  action: ConfigAction;
  key?: string;
  value?: string;
}

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
    if (auth.localModel) {
      console.log(`    localModel:     ${chalk.green(auth.localModel)}`);
    }
  } else {
    console.log(`    ${chalk.dim('provider:       not configured (defaults to minimax)')}`);
    console.log(`    ${chalk.dim('providerModel:  MiniMax-M2.5')}`);
  }

  console.log(`\n  ${chalk.bold('Authentication:')}`);
  if (auth?.apiKey) {
    const masked = auth.apiKey.length <= 8
      ? '***'
      : auth.apiKey.slice(0, 4) + '***' + auth.apiKey.slice(-4);
    console.log(`    apiKey:  ${chalk.green(masked)} ${chalk.dim('(from ~/.drill/config)')}`);
    console.log(`    apiUrl:  ${chalk.green(auth.apiUrl)}`);
  } else if (process.env['DRILL_API_KEY']) {
    const envKey = process.env['DRILL_API_KEY'] ?? '';
    const masked = envKey.length <= 8 ? '***' : envKey.slice(0, 4) + '***' + envKey.slice(-4);
    console.log(`    apiKey:  ${chalk.yellow(masked)} ${chalk.dim('(from DRILL_API_KEY env)')}`);
  } else {
    console.log(`    ${chalk.red('No API key configured.')} ${chalk.dim('Run "drill setup" to get started.')}`);
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
    case 'localModel':
      console.log(auth?.localModel ?? '');
      break;
    case 'apiKey':
    case 'apikey':
      if (auth?.apiKey) {
        const masked = auth.apiKey.length <= 8
          ? '***'
          : auth.apiKey.slice(0, 4) + '***' + auth.apiKey.slice(-4);
        console.log(masked);
      } else if (process.env['DRILL_API_KEY']) {
        const envKey = process.env['DRILL_API_KEY'] ?? '';
        const masked = envKey.length <= 8 ? '***' : envKey.slice(0, 4) + '***' + envKey.slice(-4);
        console.log(masked);
      } else {
        console.error(`\n  Error: ${key} is not set.\n`);
        process.exit(1);
      }
      break;
    case 'apiUrl':
    case 'apiurl':
      console.log(auth?.apiUrl ?? 'https://api.minimax.io/v1');
      break;
    default:
      console.error(`\n  Error: unknown config key "${key}".\n`);
      console.error('  Known keys: provider, providerModel, customUrl, localModel, apiKey, apiUrl\n');
      process.exit(1);
  }
}

async function setConfig(key: string, value: string): Promise<void> {
  if (key === 'apiKey' || key === 'apikey') {
    console.error('\n  Error: cannot set apiKey directly.\n');
    console.error('  Use "drill setup" to configure your provider and API key.\n');
    process.exit(1);
  }

  if (key === 'apiUrl' || key === 'apiurl') {
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      console.error('\n  Error: apiUrl must start with http:// or https://\n');
      process.exit(1);
    }
    const auth = loadAuth();
    const { saveAuth } = await import('../lib/auth.js');
    saveAuth({ ...(auth ?? {}), apiUrl: value } as Parameters<typeof saveAuth>[0]);
    console.log(`\n  ${chalk.green('✓')} apiUrl set.\n`);
    return;
  }

  if (key === 'provider') {
    if (!VALID_PROVIDERS.includes(value as ProviderName)) {
      console.error(`\n  Error: Unknown provider: ${value}.\n`);
      console.error(`  Valid providers: ${VALID_PROVIDERS.join(', ')}\n`);
      process.exit(1);
    }

    const auth = loadAuth();
    const { saveAuth } = await import('../lib/auth.js');
    saveAuth({ ...(auth ?? {}), provider: value as ProviderName } as Parameters<typeof saveAuth>[0]);
    console.log(`\n  ${chalk.green('✓')} Provider set to ${value}.\n`);
    return;
  }

  if (key === 'providerModel') {
    const auth = loadAuth();
    const { saveAuth } = await import('../lib/auth.js');
    saveAuth({ ...(auth ?? {}), providerModel: value } as Parameters<typeof saveAuth>[0]);
    console.log(`\n  ${chalk.green('✓')} Provider model set to ${value}.\n`);
    return;
  }

  if (key === 'localModel') {
    const auth = loadAuth();
    const { saveAuth } = await import('../lib/auth.js');
    saveAuth({ ...(auth ?? {}), localModel: value } as Parameters<typeof saveAuth>[0]);
    console.log(`\n  ${chalk.green('✓')} Local model set to ${value}.\n`);
    return;
  }

  if (key === 'customUrl') {
    const auth = loadAuth();
    const { saveAuth } = await import('../lib/auth.js');
    saveAuth({ ...(auth ?? {}), customUrl: value } as Parameters<typeof saveAuth>[0]);
    console.log(`\n  ${chalk.green('✓')} Custom URL set.\n`);
    return;
  }

  console.error(`\n  Error: "${key}" is not a writable config key.\n`);
  console.error('  Writable keys: provider, providerModel, customUrl, localModel, apiUrl\n');
  process.exit(1);
}
