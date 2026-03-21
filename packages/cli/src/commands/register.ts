import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import { register, isValidEmail } from '../lib/identity.js';
import { loadAuth, saveAuth } from '../lib/auth.js';

export async function registerCommand(): Promise<void> {
  const config = loadAuth();

  if (config?.registered ?? false) {
    console.log(chalk.dim(`\n  Already registered as ${config?.email ?? 'unknown'}\n`));
    console.log(chalk.dim('  Run: drill status to see your usage.\n'));
    return;
  }

  const rl = readline.createInterface({ input, output });

  try {
    console.log('\n  ' + chalk.bold('Create your Drill account') + '\n');
    console.log(chalk.dim('  Free tier: 100 analyses per week.\n'));

    let email = '';
    while (!isValidEmail(email)) {
      email = await rl.question('  Email: ');
      if (!isValidEmail(email)) {
        console.log(chalk.hex('#EF5350')('  Invalid email address. Try again.\n'));
      }
    }

    let apiKey = config?.apiKey ?? '';

    if (!apiKey) {
      console.log(chalk.dim('\n  Enter your LLM provider API key.'));
      console.log(chalk.dim('  This is hashed before storage — we never see the actual key.\n'));
      apiKey = await rl.question('  API key: ');
      apiKey = apiKey.trim();
    } else {
      console.log(chalk.dim(`\n  Using your configured ${config?.provider ?? 'provider'} key.\n`));
    }

    if (!apiKey) {
      console.log(chalk.hex('#EF5350')('\n  API key cannot be empty. Run: drill setup first.\n'));
      process.exit(1);
    }

    const result = await register(email, apiKey);

    if (!result.success) {
      const messages: Record<string, string> = {
        EMAIL_TAKEN:   'This email is already registered. Run: drill status',
        KEY_TAKEN:     'This API key is already registered to another account.',
        INVALID_EMAIL: 'Invalid email address.',
        NETWORK:       'Could not connect. Check your internet and try again.',
      };
      console.log('\n  ' + chalk.hex('#EF5350')('✕ ') + chalk.hex('#E6EDF3')(messages[result.code] ?? result.message) + '\n');
      process.exit(1);
    }

    saveAuth({
      ...config ?? {},
      email,
      registered: true,
      plan:        result.plan,
      weekLimit:   result.weekLimit,
      runsWeek:    0,
    });

    console.log('\n  ' + chalk.hex('#3FB950')('✓ ') + chalk.hex('#E6EDF3').bold('Registered'));
    console.log(chalk.dim(`\n  Email:  ${email}`));
    console.log(chalk.dim(`  Plan:   Free — ${result.weekLimit} analyses per week`));
    console.log(chalk.dim(`  Resets: every Monday\n`));
    console.log(chalk.dim('  Run: echo "Error: ECONNREFUSED" | drill\n'));

  } finally {
    rl.close();
  }
}
