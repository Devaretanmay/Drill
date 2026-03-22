/**
 * Authentication & Config Module
 *
 * Manages API key storage and retrieval.
 * Precedence: 1) ~/.drill/config (from drill setup) → 2) DRILL_API_KEY env var → 3) empty
 */

import Conf from 'conf';
import os from 'node:os';
import type { ProviderName } from '../types.js';

export interface DrillAuthData {
  apiKey: string;
  apiUrl: string;
  provider: ProviderName;
  providerModel: string | undefined;
  localModel: string | undefined;
  customUrl: string | undefined;
  redact: boolean;
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
    auth.redact = true;
  } else if (auth.redact === undefined) {
    auth.redact = true;
  }

  return auth;
}

export function saveAuth(data: Partial<DrillAuthData> & { apiUrl: string }): void {
  const store = getConfigStore();
  const existing = loadAuth();
  const merged = {
    apiKey:        data.apiKey        ?? existing?.apiKey        ?? '',
    apiUrl:        data.apiUrl        ?? existing?.apiUrl        ?? 'https://api.minimax.io/v1',
    provider:      data.provider      ?? existing?.provider      ?? 'minimax',
    providerModel: data.providerModel ?? existing?.providerModel ?? 'MiniMax-M2.5',
    localModel:    data.localModel    ?? existing?.localModel,
    redact:        data.redact        ?? existing?.redact        ?? true,
    customUrl:     data.customUrl     ?? existing?.customUrl,
  } as DrillAuthData;
  store.set('auth', merged);
}

export function updateAuth(partial: {
  provider?: ProviderName;
  providerModel?: string;
  apiKey?: string;
  customUrl?: string;
  localModel?: string;
  apiUrl?: string;
}): void {
  const store = getConfigStore();
  const existing = loadAuth() ?? {} as DrillAuthData;
  const merged = {
    apiKey:        partial.apiKey ?? existing.apiKey ?? '',
    apiUrl:        partial.apiUrl ?? existing.apiUrl ?? 'https://api.minimax.io/v1',
    provider:      partial.provider ?? existing.provider ?? 'minimax',
    providerModel: partial.providerModel ?? existing.providerModel ?? 'MiniMax-M2.5',
    localModel:    partial.localModel ?? existing.localModel,
    redact:        existing.redact ?? true,
    customUrl:     partial.customUrl !== undefined ? (partial.customUrl || undefined) : existing.customUrl,
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
  return process.env['DRILL_API_URL'] ?? 'https://api.minimax.io/v1';
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
