/**
 * Setup Command Module
 *
 * Interactive wizard for first-time provider configuration.
 * Triggered automatically when no provider is configured.
 */

import * as readline from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import { loadAuth, updateAuth } from '../lib/auth.js';
import type { ProviderName } from '../types.js';
import { fetchModels, ModelFetchError } from '../lib/models.js';
import type { ProviderId } from '../lib/models.js';

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
  const existingAuth = loadAuth();
  const rl = createReadline();

  console.log(`\n  ${chalk.bold('Drill Setup')}`);
  console.log(chalk.dim('  ────────────────────────────────────────'));
  console.log(`  ${chalk.dim('Configure your LLM provider to get started.')}\n`);

  console.log(`  ${chalk.bold('Choose your provider:')}\n`);

  for (let i = 0; i < PROVIDER_INFO.length; i++) {
    const p = PROVIDER_INFO[i]!;
    console.log(`  ${chalk.cyan(String(i + 1).padStart(2) + '.')} ${chalk.bold(p.name)}`);
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
  let selectedModel = selected.model;

  if (selected.needsKey) {
    console.log(`\n  ${chalk.bold(selected.name)} selected.`);

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

    // Model discovery
    const spinner = ora('Fetching available models...').start();
    let models: string[] = [];

    try {
      models = await fetchModels(selected.id as ProviderId, apiKey);
      spinner.succeed(
        models.length > 0
          ? `Found ${models.length} models`
          : 'Provider ready'
      );
    } catch (e: unknown) {
      if (e instanceof ModelFetchError && e.code === 'INVALID_KEY') {
        spinner.fail('Invalid API key');
        console.error(chalk.red('\n  API key rejected by provider. Check and try again.\n'));
        rl.close();
        process.exit(1);
      }
      spinner.fail('Could not fetch models');
      if (e instanceof ModelFetchError) {
        console.log(chalk.dim(`  ${e.message}`));
      }
    }

    const DOCS: Partial<Record<string, string>> = {
      openai:    'https://platform.openai.com/docs/models',
      anthropic: 'https://docs.anthropic.com/en/docs/models-overview',
      groq:      'https://console.groq.com/docs/models',
      mistral:   'https://docs.mistral.ai/getting-started/models/',
      together:  'https://docs.together.ai/docs/inference-models',
    };

    if (models.length > 0) {
      console.log(chalk.bold('\n  Available models:\n'));
      models.forEach((m, i) => {
        console.log(`  ${chalk.dim(String(i + 1).padStart(3))}  ${m}`);
      });
      console.log();

      const raw = await askQuestion(rl, '  Select a model (enter number): ');
      const idx = parseInt(raw.trim(), 10) - 1;

      if (isNaN(idx) || idx < 0 || idx >= models.length || !models[idx]) {
        console.error(chalk.red('\n  Invalid selection.\n'));
        rl.close();
        process.exit(1);
      }
      selectedModel = models[idx]!;
    } else {
      const docsUrl = DOCS[selected.id];
      if (docsUrl) {
        console.log(chalk.dim(`\n  See available models at: ${docsUrl}`));
      }
      console.log();
      selectedModel = (await askQuestion(rl, '  Enter model name: ')).trim();
      if (!selectedModel) {
        console.error(chalk.red('\n  Model name cannot be empty.\n'));
        rl.close();
        process.exit(1);
      }
    }
  } else {
    console.log(`\n  ${chalk.bold('Ollama')} selected.`);
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
            console.log();
            const raw = await askQuestion(rl, `  Select model (or press Enter for default): `);
            if (raw.trim()) {
              selectedModel = raw.trim();
            }
          }
        }
      } catch {
        clearTimeout(timeout);
      }
    } else {
      console.log(`\n  ${chalk.yellow('⚠ Ollama is not running.')}`);
      console.log(`  ${chalk.dim('Start it with:')} ${chalk.cyan('ollama serve')}`);
      console.log(`  ${chalk.dim('Then pull a model:')} ${chalk.cyan(`ollama pull ${selectedModel}`)}`);
    }
  }

  rl.close();

  const authUpdate: { provider: ProviderName; providerModel: string; apiKey: string; customUrl?: string } = {
    provider: selected.id,
    providerModel: selectedModel,
    apiKey,
  };
  if (customUrl) {
    authUpdate.customUrl = customUrl;
  }
  updateAuth(authUpdate);

  console.log(`\n  ${chalk.green('✓')} Provider saved!`);
  console.log(`  ${chalk.bold('Provider:')} ${selected.name}`);
  console.log(`  ${chalk.bold('Model:')} ${selectedModel}`);
  if (apiKey) {
    console.log(`  ${chalk.bold('API Key:')} ${chalk.dim('(stored)')}`);
  }
  if (existingAuth?.registered) {
    console.log(`\n  ${chalk.dim('Try it now:')} ${chalk.cyan("echo 'Error: ECONNREFUSED' | drill")}\n`);
  } else {
    console.log(`\n  ${chalk.dim('Next:')} ${chalk.cyan('drill register')} ${chalk.dim('to activate your account, then run Drill.')}\n`);
  }
}
