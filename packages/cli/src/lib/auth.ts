/**
 * Authentication & Config Module
 *
 * Manages API key storage and retrieval.
 * Precedence: 1) ~/.drill/config (from drill login) → 2) DRILL_API_KEY env var → 3) error
 */

import Conf from 'conf';
import os from 'node:os';
import type { ProviderName } from '../types.js';

export interface DrillAuthData {
  apiKey: string;
  apiUrl: string;
  plan: string;
  runCount: number;
  runLimit: number;
  provider: ProviderName;
  providerModel: string;
  model: 'cloud' | 'local';
  localModel: string | undefined;
  redact: boolean;
  customUrl: string | undefined;
}

interface DrillConfSchema {
  auth?: DrillAuthData;
}

function getConfigStore(): Conf<DrillConfSchema> {
  const configDir = process.env['DRILL_CONFIG_DIR'] ?? `${os.homedir()}/.drill`;
  return new Conf<DrillConfSchema>({
    cwd: configDir,
    configName: 'config',
    projectName: 'drill',
    projectVersion: '1.0.0',
  });
}

/**
 * Loads auth data from ~/.drill/config.
 * Returns null if not authenticated.
 * Sets default provider to 'minimax' if none configured (backward compat).
 */
export function loadAuth(): DrillAuthData | null {
  const store = getConfigStore();
  const raw = store.get('auth');
  if (!raw) return null;

  const auth = raw as DrillAuthData;

  if (!auth.provider) {
    auth.provider = 'minimax';
    auth.providerModel = 'MiniMax-M2.5';
    auth.model = 'cloud';
    auth.redact = true;
  }

  return auth;
}

/**
 * Saves auth data to ~/.drill/config.
 * @param data Full auth data to save
 */
export function saveAuth(data: DrillAuthData): void {
  const store = getConfigStore();
  store.set('auth', data);
}

/**
 * Updates a subset of auth fields, merging with existing data.
 * @param partial Partial auth data to merge
 */
export function updateAuth(partial: {
  provider?: ProviderName;
  providerModel?: string;
  apiKey?: string;
  customUrl?: string;
}): void {
  const existing = loadAuth();
  const merged: DrillAuthData = {
    apiKey: partial.apiKey ?? existing?.apiKey ?? '',
    apiUrl: existing?.apiUrl ?? 'https://api.drill.dev',
    plan: existing?.plan ?? 'free',
    runCount: existing?.runCount ?? 0,
    runLimit: existing?.runLimit ?? 20,
    provider: partial.provider ?? existing?.provider ?? 'minimax',
    providerModel: partial.providerModel ?? existing?.providerModel ?? 'MiniMax-M2.5',
    model: existing?.model ?? 'cloud',
    localModel: existing?.localModel,
    redact: existing?.redact ?? true,
    customUrl: existing?.customUrl,
  };
  if (partial.customUrl !== undefined) {
    merged.customUrl = partial.customUrl || undefined;
  }
  saveAuth(merged);
}

/**
 * Clears auth data from ~/.drill/config.
 */
export function clearAuth(): void {
  const store = getConfigStore();
  store.delete('auth');
}

/**
 * Gets the API key to use for requests.
 * Precedence: 1) ~/.drill/config → 2) DRILL_API_KEY env var → empty string
 */
export function getApiKey(): string {
  const auth = loadAuth();
  if (auth?.apiKey) return auth.apiKey;

  const envKey = process.env['DRILL_API_KEY'];
  if (envKey) return envKey;

  return '';
}

/**
 * Checks if the user has a stored API key (from drill login).
 */
export function hasStoredAuth(): boolean {
  const auth = loadAuth();
  return auth?.apiKey !== undefined && auth.apiKey.length > 0;
}

/**
 * Gets the API URL to use for requests.
 * Returns config file URL if available, otherwise defaults to DRILL_API_URL env var.
 */
export function getApiUrl(): string {
  const auth = loadAuth();
  if (auth?.apiUrl) return auth.apiUrl;
  return process.env['DRILL_API_URL'] ?? 'https://api.drill.dev';
}

/**
 * Returns the plan info from auth config.
 */
export function getPlanInfo(): { plan: string; runCount: number; runLimit: number } {
  const auth = loadAuth();
  return {
    plan: auth?.plan ?? 'unknown',
    runCount: auth?.runCount ?? 0,
    runLimit: auth?.runLimit ?? 20,
  };
}

/**
 * Increments the run count by 1.
 */
export function incrementRunCount(): void {
  const auth = loadAuth();
  if (auth) {
    auth.runCount += 1;
    saveAuth(auth);
  }
}

/**
 * Masks an API key for safe display.
 * Shows first 4 and last 4 characters.
 */
export function maskKey(key: string): string {
  if (key.length <= 8) return '***';
  return key.slice(0, 4) + '***' + key.slice(-4);
}

/**
 * Gets the configured provider name, defaulting to 'minimax'.
 */
export function getProvider(): ProviderName {
  const auth = loadAuth();
  return auth?.provider ?? 'minimax';
}

/**
 * Gets the configured provider model.
 */
export function getProviderModel(): string {
  const auth = loadAuth();
  return auth?.providerModel ?? 'MiniMax-M2.5';
}
