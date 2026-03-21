import chalk from 'chalk';
import { registerCommand } from './register.js';

export async function loginCommand(): Promise<void> {
  console.log(chalk.dim('\n  Use: drill register to create an account.\n'));
  await registerCommand();
}
