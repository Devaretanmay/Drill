/**
 * Logout Command Module
 * 
 * Clears stored authentication from ~/.drill/config.
 */

import chalk from 'chalk';
import { clearAuth, hasStoredAuth } from '../lib/auth.js';

/**
 * Executes the logout flow: clears auth config and confirms.
 */
export async function logoutCommand(): Promise<void> {
  const wasLoggedIn = hasStoredAuth();
  
  clearAuth();

  if (wasLoggedIn) {
    console.log(`\n  ${chalk.green('✓')} ${chalk.bold('Logged out successfully.')}`);
    console.log(`  Your authentication token has been removed from this machine.\n`);
    console.log(`  ${chalk.dim('To use Drill again, run "drill login" or set DRILL_API_KEY.\n')}`);
  } else {
    console.log(`\n  ${chalk.dim('No stored authentication found.')}\n`);
    console.log(`  ${chalk.dim('To use Drill, run "drill login" or set DRILL_API_KEY.\n')}`);
  }
}
