/**
 * Login Command Module
 * 
 * Authenticates the user via browser-based OAuth flow.
 * Flow: generate UUID state → open browser → poll every 2s → save token
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import open from 'open';
import chalk from 'chalk';
import ora from 'ora';
import { saveAuth } from '../lib/auth.js';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes
const AUTH_BASE_URL = 'https://drill.dev';

interface PollResponse {
  status: 'pending' | 'complete' | 'expired' | 'error';
  apiKey?: string;
  plan?: string;
  email?: string;
  runLimit?: number;
  error?: string;
}

async function pollForAuth(stateToken: string, deviceName: string): Promise<PollResponse> {
  const startTime = Date.now();
  const spinner = ora({ text: 'Waiting for authentication...', color: 'cyan' }).start();

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    try {
      const response = await fetch(
        `${AUTH_BASE_URL}/api/cli-auth/poll?state=${stateToken}&device=${encodeURIComponent(deviceName)}`,
        { signal: AbortSignal.timeout(10_000) }
      );

      if (response.status === 200) {
        const data = await response.json() as PollResponse;
        
        if (data.status === 'complete') {
          spinner.succeed('Authentication successful!');
          return data;
        }
        
        if (data.status === 'expired' || data.status === 'error') {
          spinner.fail(data.error ?? 'Authentication failed or expired.');
          return data;
        }
        
        // status is 'pending' — keep polling
        spinner.text = `Waiting for authentication... (${Math.floor((Date.now() - startTime) / 1000)}s)`;
      }
    } catch {
      // Network error during poll — keep trying
    }

    await sleep(POLL_INTERVAL_MS);
  }

  spinner.fail('Authentication timed out. Please try again.');
  return { status: 'expired', error: 'Timed out after 5 minutes.' };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executes the login flow:
 * 1. Generate a random state token
 * 2. Open browser to drill.dev/cli-auth
 * 3. Poll for auth completion
 * 4. Save token to config
 */
export async function loginCommand(): Promise<void> {
  const deviceName = process.env['DRILL_HOSTNAME'] ?? hostname();
  const stateToken = randomUUID();
  const authUrl = `${AUTH_BASE_URL}/cli-auth?state=${stateToken}&device=${encodeURIComponent(deviceName)}`;

  console.log(`\n  ${chalk.bold('Drill Login')}\n`);
  console.log(`  Opening browser to authenticate...\n`);
  console.log(`  ${chalk.dim(authUrl)}\n`);
  
  try {
    await open(authUrl, { wait: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ${chalk.yellow('Could not open browser automatically.')}`);
    console.log(`  Visit: ${chalk.underline(authUrl)}\n`);
  }

  const result = await pollForAuth(stateToken, deviceName);

  if (result.status === 'complete' && result.apiKey) {
    saveAuth({
      apiKey: result.apiKey,
      apiUrl: AUTH_BASE_URL,
      plan: result.plan ?? 'free',
      runCount: 0,
      runLimit: result.runLimit ?? 20,
      provider: 'minimax',
      providerModel: 'MiniMax-M2.5',
      model: 'cloud',
      localModel: undefined,
      redact: true,
      customUrl: undefined,
    });

    console.log(`\n  ${chalk.green('✓')} ${chalk.bold('Authenticated')}`);
    if (result.email) {
      console.log(`    Account: ${chalk.dim(result.email)}`);
    }
    console.log(`    Plan: ${chalk.bold(result.plan ?? 'free')} (${result.runLimit ?? 20} runs/month)\n`);
    console.log(`  ${chalk.dim('Run "drill status" to see your current usage.\n')}`);
  } else {
    console.log(`\n  ${chalk.red('✗')} ${chalk.bold('Login failed:')} ${result.error ?? 'Unknown error'}\n`);
    process.exit(1);
  }
}
