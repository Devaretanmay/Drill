/**
 * Setup Command Module
 *
 * Interactive wizard for first-time provider configuration.
 * Triggered automatically when no provider is configured.
 */

import * as readline from 'node:readline';
import { lookup } from 'node:dns/promises';
import chalk from 'chalk';
import { updateAuth } from '../lib/auth.js';
import type { ProviderName } from '../types.js';

const PROVIDER_INFO: Array<{
  id: ProviderName;
  name: string;
  model: string;
  description: string;
  needsKey: boolean;
}> = [
  {
    id: 'openai',
    name: 'OpenAI',
    model: 'gpt-4o',
    description: 'Best accuracy — OpenAI\'s flagship model',
    needsKey: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    model: 'claude-sonnet-4-20250514',
    description: 'Best reasoning — Anthropic\'s Claude 4 Sonnet',
    needsKey: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    model: 'llama-3.1-70b-versatile',
    description: 'Fastest — free tier available',
    needsKey: true,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    model: 'mistral-large-latest',
    description: 'European data residency',
    needsKey: true,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    model: 'llama3.2',
    description: 'Fully private — runs locally, no API key needed',
    needsKey: false,
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    model: 'MiniMax-M2.5',
    description: 'Original default — MiniMax M2.5 with thinking',
    needsKey: true,
  },
  {
    id: 'together',
    name: 'Together AI',
    model: 'MiniMaxAI/MiniMax-M2.5',
    description: 'Fallback provider — good for MiniMax access',
    needsKey: true,
  },
  {
    id: 'custom',
    name: 'Custom',
    model: 'your-model',
    description: 'Any OpenAI-compatible endpoint',
    needsKey: true,
  },
];

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function askNumber(rl: readline.Interface, question: string, min: number, max: number): Promise<number> {
  return new Promise(async (resolve) => {
    while (true) {
      const answer = await askQuestion(rl, question);
      const num = parseInt(answer, 10);
      if (!isNaN(num) && num >= min && num <= max) {
        resolve(num);
        return;
      }
      console.log(`  ${chalk.yellow(`Please enter a number between ${min} and ${max}.`)}`);
    }
  });
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Runs the interactive setup wizard.
 */
export async function setupCommand(): Promise<void> {
  const rl = createReadline();

  console.log(`\n  ${chalk.bold('Drill Setup')}`);
  console.log(chalk.dim('  ────────────────────────────────────────'));
  console.log(`  ${chalk.dim('Configure your LLM provider to get started.')}\n`);

  console.log(`  ${chalk.bold('Choose your provider:')}\n`);

  for (let i = 0; i < PROVIDER_INFO.length; i++) {
    const p = PROVIDER_INFO[i]!;
    console.log(`  ${chalk.cyan(String(i + 1).padStart(2) + '.')} ${chalk.bold(p.name.padEnd(12))} ${chalk.dim(`(${p.model})`)}`);
    console.log(`      ${chalk.dim(p.description)}\n`);
  }

  const choice = await askNumber(rl, `  ${chalk.bold('Enter number')} (1-${PROVIDER_INFO.length}): `, 1, PROVIDER_INFO.length);
  const selected = PROVIDER_INFO[choice - 1];

  if (!selected) {
    console.error(`\n  ${chalk.red('Invalid selection.')}\n`);
    rl.close();
    return;
  }

  let apiKey = '';
  let customUrl = '';

  if (selected.needsKey) {
    console.log(`\n  ${chalk.bold(selected.name)} selected. Model: ${chalk.cyan(selected.model)}`);

    if (selected.id === 'custom') {
      customUrl = await askQuestion(rl, `\n  ${chalk.bold('Enter your API base URL:')} `);
      if (!customUrl.startsWith('http://') && !customUrl.startsWith('https://')) {
        console.log(`\n  ${chalk.yellow('URL should start with http:// or https://')}`);
        console.log(`  ${chalk.dim('Using as-is.\n')}`);
      }
    }

    apiKey = await askQuestion(rl, `\n  ${chalk.bold('Enter your API key:')} `);
    if (!apiKey) {
      console.log(`\n  ${chalk.yellow('No API key entered. Provider will not be saved.')}\n`);
      rl.close();
      return;
    }

    if (selected.id === 'openai' && !apiKey.startsWith('sk-')) {
      console.log(`\n  ${chalk.dim('Note: OpenAI API keys typically start with "sk-".')}`);
    }
  } else {
    console.log(`\n  ${chalk.bold('Ollama')} selected. Model: ${chalk.cyan(selected.model)}`);
    console.log(`  ${chalk.dim('No API key needed for local models.')}`);

    const running = await isOllamaRunning();
    if (running) {
      console.log(`\n  ${chalk.green('✓')} Ollama is running.`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3_000);
      try {
        const response = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
        clearTimeout(timeout);
        if (response.ok) {
          const data = await response.json() as { models?: Array<{ name: string }> };
          const available = data.models ?? [];
          if (available.length > 0) {
            console.log(`  ${chalk.dim('Available models:')} ${available.map(m => m.name).join(', ')}`);
          }
        }
      } catch {
        clearTimeout(timeout);
      }
    } else {
      console.log(`\n  ${chalk.yellow('⚠ Ollama is not running.')}`);
      console.log(`  ${chalk.dim('Start it with:')} ${chalk.cyan('ollama serve')}`);
      console.log(`  ${chalk.dim('Then pull a model:')} ${chalk.cyan(`ollama pull ${selected.model}`)}`);
    }
  }

  rl.close();

  const authUpdate: { provider: ProviderName; providerModel: string; apiKey: string; customUrl?: string } = {
    provider: selected.id,
    providerModel: selected.model,
    apiKey,
  };
  if (customUrl) {
    authUpdate.customUrl = customUrl;
  }
  updateAuth(authUpdate);

  console.log(`\n  ${chalk.green('✓')} Provider saved!`);
  console.log(`  ${chalk.bold('Provider:')} ${selected.name}`);
  console.log(`  ${chalk.bold('Model:')} ${selected.model}`);
  if (apiKey) {
    console.log(`  ${chalk.bold('API Key:')} ${chalk.dim('(stored)')}`);
  }
  console.log(`\n  ${chalk.dim('Try it now:')} ${chalk.cyan("echo 'Error: ECONNREFUSED' | drill")}\n`);
}
