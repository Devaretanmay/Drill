/**
 * Logout Command Module
 *
 * Clears stored authentication from ~/.drill/config.
 * Signs out from Supabase if token exists.
 */

import chalk from 'chalk';
import { clearSessionAuth, loadAuth } from '../lib/auth.js';
import { authedClient } from '../lib/supabase.js';

export async function logoutCommand(): Promise<void> {
  const config = loadAuth();

  if (!config?.supabaseToken || !config?.supabaseUserId) {
    console.log(chalk.dim('\n  Logged out.\n'));
    return;
  }

  try {
    await authedClient(config.supabaseToken).auth.signOut();
  } catch {
    // Ignore — clear local session regardless
  }

  clearSessionAuth();
  console.log(chalk.dim('\n  Logged out.\n'));
}
