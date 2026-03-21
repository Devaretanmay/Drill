/**
 * Authentication & Config Module
 *
 * Manages API key storage and retrieval.
 * Precedence: 1) ~/.drill/config (from drill register) → 2) DRILL_API_KEY env var → 3) empty
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
  // Registration fields
  email?: string;
  registered?: boolean;
  weekLimit?: number;
  runsWeek?: number;
  weekReset?: string;
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

export function saveAuth(data: Partial<DrillAuthData> & { email: string; registered: boolean; plan: string; weekLimit: number }): void {
  const store = getConfigStore();
  const existing = loadAuth();
  const merged = {
    apiKey:        existing?.apiKey        ?? data.apiKey        ?? '',
    apiUrl:        existing?.apiUrl        ?? data.apiUrl        ?? 'https://api.drill.dev',
    plan:          data.plan          ?? existing?.plan          ?? 'free',
    runCount:      existing?.runCount      ?? data.runCount      ?? 0,
    runLimit:      existing?.runLimit      ?? data.runLimit      ?? 20,
    model:         existing?.model         ?? data.model         ?? 'cloud',
    localModel:    existing?.localModel    ?? data.localModel,
    redact:        existing?.redact        ?? data.redact        ?? true,
    provider:      existing?.provider      ?? data.provider      ?? 'minimax',
    providerModel: existing?.providerModel ?? data.providerModel ?? 'MiniMax-M2.5',
    customUrl:     existing?.customUrl     ?? data.customUrl,
    email:         data.email,
    registered:    data.registered,
    weekLimit:     data.weekLimit,
    runsWeek:      data.runsWeek ?? 0,
    weekReset:     data.weekReset,
  } as DrillAuthData;
  store.set('auth', merged);
}

export function updateAuth(partial: {
  provider?: ProviderName;
  providerModel?: string;
  apiKey?: string;
  customUrl?: string;
  localModel?: string;
}): void {
  const store = getConfigStore();
  const existing = loadAuth() ?? {} as DrillAuthData;
  const merged = {
    apiKey:        partial.apiKey ?? existing.apiKey ?? '',
    apiUrl:        existing.apiUrl ?? 'https://api.drill.dev',
    plan:          existing.plan ?? 'free',
    runCount:      existing.runCount ?? 0,
    runLimit:      existing.runLimit ?? 20,
    model:         existing.model ?? 'cloud',
    localModel:    partial.localModel ?? existing.localModel,
    redact:        existing.redact ?? true,
    provider:      partial.provider ?? existing.provider ?? 'minimax',
    providerModel: partial.providerModel ?? existing.providerModel ?? 'MiniMax-M2.5',
    customUrl:     partial.customUrl !== undefined ? (partial.customUrl || undefined) : existing.customUrl,
    email:         existing.email,
    registered:    existing.registered,
    weekLimit:     existing.weekLimit,
    runsWeek:      existing.runsWeek,
    weekReset:     existing.weekReset,
  } as DrillAuthData;
  store.set('auth', merged);
}

export function clearAuth(): void {
  const store = getConfigStore();
  store.delete('auth');
}

export function getApiKey(): string {
  const auth = loadAuth();
  if (auth?.apiKey) return auth.apiKey;

  const envKey = process.env['DRILL_API_KEY'];
  if (envKey) return envKey;

  return '';
}

export function hasStoredAuth(): boolean {
  const auth = loadAuth();
  return auth?.apiKey !== undefined && auth.apiKey.length > 0;
}

export function getApiUrl(): string {
  const auth = loadAuth();
  if (auth?.apiUrl) return auth.apiUrl;
  return process.env['DRILL_API_URL'] ?? 'https://api.drill.dev';
}

export function getProvider(): ProviderName {
  const auth = loadAuth();
  return auth?.provider ?? 'minimax';
}

export function getProviderModel(): string {
  const auth = loadAuth();
  return auth?.providerModel ?? 'MiniMax-M2.5';
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '***';
  return key.slice(0, 4) + '***' + key.slice(-4);
}
