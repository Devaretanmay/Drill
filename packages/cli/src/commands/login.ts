/**
 * Login Command Module
 *
 * Authenticates user via Supabase magic link + OTP flow.
 * Flow: email → signInWithOtp → user enters 6-digit code → verifyOtp → session
 */

import readline from 'node:readline/promises';
import { createHash } from 'node:crypto';
import pkg from 'node-machine-id';
const { machineIdSync } = pkg;
import chalk from 'chalk';
import { supabase, authedClient } from '../lib/supabase.js';
import { loadAuth, saveAuth, getApiKey } from '../lib/auth.js';

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatWeekReset(isoDate: string): string {
  if (!isoDate) return 'Unknown';
  try {
    return new Date(isoDate).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Unknown';
  }
}

/**
 * Executes the login flow:
 * 1. Check if already logged in
 * 2. Prompt for email
 * 3. Send magic link via Supabase
 * 4. Prompt for 6-digit OTP code
 * 5. Verify OTP and get session
 * 6. Upsert user record in Supabase
 * 7. Save to ~/.drill/config
 */
export async function loginCommand(): Promise<void> {
  const rl = createReadline();

  // Step 1: Check if already logged in
  const existingAuth = loadAuth();
  if (existingAuth?.supabaseToken && existingAuth?.email) {
    const answer = await askQuestion(
      rl,
      chalk.yellow(`\n  Already logged in as ${existingAuth.email}. Re-authenticate? (y/n): `),
    );
    if (answer.toLowerCase() !== 'y') {
      console.log(chalk.dim('  Login cancelled.\n'));
      rl.close();
      return;
    }
  }

  // Step 2: Prompt for email
  console.log(`\n  ${chalk.bold('Drill Login')}\n`);

  let email = await askQuestion(rl, chalk.bold('  Enter your email: '));

  if (!isValidEmail(email)) {
    console.error(chalk.red('\n  Invalid email address.\n'));
    rl.close();
    process.exit(1);
  }

  // Step 3: Send magic link
  const { error: sendError } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (sendError) {
    console.error(chalk.red(`\n  Failed to send magic link: ${sendError.message}\n`));
    rl.close();
    process.exit(1);
  }

  console.log(chalk.green(`\n  ✓ Magic link sent to ${email}`));
  console.log(chalk.dim('  Check your email for a 6-digit code.'));
  console.log(chalk.dim('  The link in the email also works — just open it in any browser.\n'));

  // Step 5: Prompt for 6-digit OTP code
  const token = await askQuestion(rl, chalk.bold('  Enter the 6-digit code: '));

  if (token.length !== 6 || !/^\d+$/.test(token)) {
    console.error(chalk.red('\n  Invalid code. Run drill login to try again.\n'));
    rl.close();
    process.exit(1);
  }

  // Step 6: Verify OTP
  const { data, error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });

  if (verifyError) {
    console.error(chalk.red(`\n  Invalid code. Run drill login to try again.\n`));
    rl.close();
    process.exit(1);
  }

  if (!data.session) {
    console.error(chalk.red('\n  No session received. Try again.\n'));
    rl.close();
    process.exit(1);
  }

  // Step 7: Get session data
  const accessToken = data.session.access_token;
  const userId = data.session.user.id;

  // Step 8: Get machine ID
  const machineId = machineIdSync(true);

  // Step 9: Hash provider API key if exists
  const existingKey = getApiKey();
  const keyHash = existingKey
    ? createHash('sha256').update(existingKey).digest('hex').slice(0, 16)
    : null;

  // Step 10: Upsert user record
  const client = authedClient(accessToken);
  const { error: upsertError } = await client.from('users').upsert(
    {
      id: userId,
      email,
      machine_id: machineId,
      key_hash: keyHash,
    },
    { onConflict: 'id' },
  );

  if (upsertError) {
    console.warn(chalk.yellow(`  Note: Could not update user record (${upsertError.message})`));
  }

  // Step 11: Check for abuse (silent - just log, don't block)
  try {
    const { data: abuseData } = await client.rpc('check_abuse', {
      p_machine_id: machineId,
      p_key_hash: keyHash,
      p_user_id: userId,
    });
    if (abuseData?.machine_duplicate || abuseData?.key_duplicate) {
      console.warn(chalk.dim('  (flagged for review - duplicate account detected)'));
    }
  } catch {
    // Ignore abuse check failures
  }

  // Step 12: Fetch initial run count
  let runsWeek = 0;
  let plan = 'free';
  let weekReset = '';

  try {
    const { data: userData } = await client
      .from('users')
      .select('runs_week, week_reset, plan')
      .eq('id', userId)
      .single();

    if (userData) {
      runsWeek = userData.runs_week ?? 0;
      plan = userData.plan ?? 'free';
      weekReset = userData.week_reset ?? '';
    }
  } catch {
    // Use defaults if cannot fetch
  }

  // Step 13: Save to config
  const limit = plan === 'free' ? 100 : 999999;
  const authData = {
    apiKey: existingAuth?.apiKey ?? '',
    apiUrl: existingAuth?.apiUrl ?? 'https://api.drill.dev',
    plan,
    runCount: existingAuth?.runCount ?? 0,
    runLimit: limit,
    model: existingAuth?.model ?? 'cloud',
    localModel: existingAuth?.localModel,
    redact: existingAuth?.redact ?? true,
    provider: existingAuth?.provider ?? 'minimax',
    providerModel: existingAuth?.providerModel ?? '',
    customUrl: existingAuth?.customUrl,
    supabaseToken: accessToken,
    supabaseUserId: userId,
    email,
    runsWeek,
    weekLimit: limit,
    weekReset,
  };

  saveAuth(authData);

  // Step 14: Print success
  console.log(chalk.green('\n  ✓ Authenticated'));
  console.log(`  Email: ${email}`);
  console.log(`  Plan: ${chalk.bold(plan)} — ${limit} analyses per week`);
  console.log(`  Runs this week: ${runsWeek}/${limit}`);
  console.log(`  Resets: ${formatWeekReset(weekReset)}`);
  console.log(chalk.dim('\n  Run: echo "Error: ECONNREFUSED" | drill\n'));

  rl.close();
}