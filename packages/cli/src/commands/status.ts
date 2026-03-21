/**
 * Status Command Module
 *
 * Shows current authentication status, plan info, and provider config.
 * Fetches live data from Supabase when authenticated.
 */

import chalk from 'chalk';
import { loadAuth, getProvider, getProviderModel } from '../lib/auth.js';
import { authedClient } from '../lib/supabase.js';

export async function statusCommand(): Promise<void> {
  const config = loadAuth();

  if (!config?.supabaseToken || !config?.supabaseUserId) {
    console.log(chalk.yellow('\n  Not logged in. Run: drill login\n'));
    return;
  }

  let runsWeek = config.runsWeek ?? 0;
  let plan = config.plan ?? 'free';
  let weekReset = config.weekReset ?? '';

  try {
    const { data } = await authedClient(config.supabaseToken)
      .from('users')
      .select('runs_week, week_reset, plan')
      .eq('id', config.supabaseUserId)
      .single();

    if (data) {
      runsWeek  = data.runs_week;
      plan      = data.plan;
      weekReset = data.week_reset;
    }
  } catch {
    // Use cached values if offline
  }

  const limit  = plan === 'free' ? 100 : 999999;
  const pct    = Math.min(100, Math.round((runsWeek / limit) * 100));
  const bar    = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
  const reset  = weekReset
    ? new Date(weekReset).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : 'Unknown';

  const provider = getProvider();
  const providerModel = getProviderModel();

  console.log('\n' + chalk.bold('  Drill status'));
  console.log(chalk.dim('  ─────────────────────────────'));
  console.log(`  Email:     ${config.email ?? 'unknown'}`);
  console.log(`  Plan:      ${chalk.bold(plan)}`);
  console.log(`  Usage:     ${bar} ${runsWeek}/${limit === 999999 ? '∞' : limit} this week`);
  console.log(`  Resets:    ${reset}`);
  console.log(`  Provider:  ${provider ? chalk.cyan(provider) : chalk.dim('not configured — run drill setup')}`);
  if (providerModel) {
    console.log(`  Model:     ${providerModel}`);
  }
  console.log(chalk.dim('  ─────────────────────────────\n'));
}
