/**
 * Upgrade Helper Module
 * 
 * Shows upgrade prompts when run limits are reached.
 */

import chalk from 'chalk';
import open from 'open';

const DEFAULT_UPGRADE_URL = 'https://drill.dev/upgrade';

/**
 * Shows an upgrade prompt with the given URL.
 */
export function showUpgradePrompt(upgradeUrl?: string): void {
  const url = upgradeUrl ?? DEFAULT_UPGRADE_URL;
  console.log(`\n  ${chalk.yellow('✕')} ${chalk.bold('Monthly run limit reached')}`);
  console.log(`  Upgrade at: ${chalk.underline(chalk.cyan(url))}\n`);
}

/**
 * Opens the upgrade page in the browser.
 */
export async function openUpgradePage(upgradeUrl?: string): Promise<void> {
  const url = upgradeUrl ?? DEFAULT_UPGRADE_URL;
  try {
    await open(url, { wait: false });
  } catch {
    console.log(`  Visit: ${chalk.underline(url)}\n`);
  }
}
