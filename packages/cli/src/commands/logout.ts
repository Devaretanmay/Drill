import chalk from 'chalk';
import { clearAuth } from '../lib/auth.js';

export async function logoutCommand(): Promise<void> {
  clearAuth();
  console.log(chalk.dim('\n  Logged out.\n'));
}
