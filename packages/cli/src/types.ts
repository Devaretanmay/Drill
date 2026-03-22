/**
 * Drill CLI - Complete Type Definitions
 * All shared TypeScript interfaces and types for the CLI package.
 */

export interface DrillResult {
  cause: string;
  confidence: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  evidence: string[];
  fix: string;
  alternative: string | null;
  missing: string | null;
}

export interface DrillError {
  code: DrillErrorCode;
  message: string;
  upgrade_url?: string;
}

export type DrillErrorCode =
  | 'LIMIT_REACHED'
  | 'INVALID_KEY'
  | 'PARSE_FAILED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'REDACTED_EMPTY'
  | 'EMPTY_INPUT'
  | 'CHUNK_FAILED'
  | 'API_ERROR'
  | 'SERVER_ERROR'
  | 'NO_KEY'
  | 'PROVIDER_ERROR';

export type AnalyzeResponse =
  | { success: true; result: DrillResult }
  | { success: false; error: DrillError };

export type ProviderName =
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'mistral'
  | 'ollama'
  | 'minimax'
  | 'together'
  | 'custom';

export interface DrillConfig {
  apiKey: string;
  apiUrl: string;
  plan: string;
  runCount: number;
  runLimit: number;
  model: 'cloud' | 'local';
  localModel: string | undefined;
  redact: boolean;
  provider: ProviderName;
  providerModel: string;
  customUrl: string | undefined;
}

export interface StreamEvent {
  type: 'thinking' | 'result_chunk' | 'done' | 'error';
  content: string;
}

export interface FilterOptions {
  contextBefore: number;
  contextAfter: number;
}

export interface FilterResult {
  content: string;
  matchedLineCount: number;
  keptLineCount: number;
  removedHealthcheckLineCount: number;
  usedFallback: boolean;
}

export interface ChunkOptions {
  maxChars: number;
  lastNLines: number;
  headLines: number;
}

export interface ChunkResult {
  content: string;
  wasChunked: boolean;
  originalLines: number;
  resultLines: number;
  strategy: 'passthrough' | 'tail';
}

export interface RedactStats {
  patternsMatched: Record<string, number>;
  totalReplacements: number;
  charsRemoved: number;
}

export interface ContextFile {
  path: string;
  content: string;
  relevanceScore: number;
}

export interface LogFixture {
  name: string;
  input: string;
  expectedPatterns: string[];
  shouldNotContain: string[];
}

export interface RedactionPattern {
  name: string;
  re: RegExp;
  sub: string;
}

export interface RedactResult {
  redacted: string;
  stats: RedactStats;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onThinking: (text: string) => void;
  onResultChunk: (text: string) => void;
}
