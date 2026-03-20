/**
 * PII Redaction Module
 * 
 * Redacts all PII and secrets from log input before sending to LLM.
 * Applied by default on all input. Can be disabled with --no-redact flag.
 */

import type { RedactStats, RedactResult, RedactionPattern } from '../types.js';

const PATTERNS: RedactionPattern[] = [
  { name: 'ssh_key', re: /-----BEGIN [A-Z ]+KEY-----[\s\S]+?-----END [A-Z ]+KEY-----/g, sub: '[SSH_KEY]' },
  { name: 'dsn', re: /\b(?:postgres|mysql|redis|mongodb|amqp|mssql|oracle|sqlite|mariadb):\/\/[^\s]+/gi, sub: '[DSN]' },
  { name: 'email', re: /[\w.+-]+@[\w-]+\.[\w.]+/g, sub: '[EMAIL]' },
  { name: 'ipv4', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, sub: '[IP]' },
  { name: 'ipv6', re: /([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/g, sub: '[IP]' },
  { name: 'uuid', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, sub: '[UUID]' },
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, sub: '[TOKEN]' },
  { name: 'aws_key', re: /\b(?:AKIA|ASIA|AROA|ANPA|ANVA|APKA)[A-Z0-9]{16}\b/g, sub: '[AWS_KEY]' },
  { name: 'aws_secret', re: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g, sub: '[AWS_SECRET]' },
  { name: 'bearer', re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, sub: 'Bearer [TOKEN]' },
  { name: 'basic_auth', re: /Basic\s+[A-Za-z0-9+/]+=*/gi, sub: 'Basic [REDACTED]' },
  { name: 'kv_secret', re: /(password|passwd|secret|token|api[_-]?key|auth[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*\S+/gi, sub: '$1=[REDACTED]' },
  { name: 'phone', re: /\b(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, sub: '[PHONE]' },
  { name: 'credit_card', re: /\b(?:\d[ -]?){13,16}\b/g, sub: '[CARD]' },
];

/**
 * Redacts all PII and secrets from log input before sending to LLM.
 * @param input Raw log string
 * @returns Redacted log string with all PII replaced by placeholder tokens
 */
export function redact(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  let result = input;
  
  for (const pattern of PATTERNS) {
    result = result.replace(pattern.re, pattern.sub);
  }
  
  if (result.trim().length === 0 && input.trim().length > 0) {
    return '__DRILL_FULLY_REDACTED__';
  }
  
  return result;
}

/**
 * Same as redact() but also returns statistics about what was redacted.
 * Used by --verbose flag to show redaction summary.
 * @param input Raw log string
 * @returns Object with redacted string and stats about replacements made
 */
export function redactWithStats(input: string): RedactResult {
  if (typeof input !== 'string') {
    return {
      redacted: '',
      stats: {
        patternsMatched: {},
        totalReplacements: 0,
        charsRemoved: 0,
      },
    };
  }
  
  const originalLength = input.length;
  const patternsMatched: Record<string, number> = {};
  let totalReplacements = 0;
  let result = input;
  
  for (const pattern of PATTERNS) {
    const matches = result.match(pattern.re);
    if (matches && matches.length > 0) {
      patternsMatched[pattern.name] = matches.length;
      totalReplacements += matches.length;
      result = result.replace(pattern.re, pattern.sub);
    }
  }
  
  if (result.trim().length === 0 && input.trim().length > 0) {
    result = '__DRILL_FULLY_REDACTED__';
  }
  
  const charsRemoved = originalLength - result.length;
  
  return {
    redacted: result,
    stats: {
      patternsMatched,
      totalReplacements,
      charsRemoved,
    },
  };
}

export const SENTINEL_VALUE = '__DRILL_FULLY_REDACTED__';
