/**
 * Preprocessing Pipeline Module
 *
 * Full preprocessing pipeline: redact → dedup → filter → chunk.
 * Single entry point used by both run.ts and watch.ts.
 */

import { redact, redactWithStats } from './redact.js';
import { dedup } from './dedup.js';
import { filter } from './filter.js';
import { chunk } from './chunk.js';
import type { ChunkResult, FilterResult, RedactStats } from '../types.js';

export interface PreprocessResult {
  content: string;
  chunkResult: ChunkResult;
  filterResult: FilterResult;
  wasRedacted: boolean;
}

export function preprocess(
  raw: string,
  doRedact: boolean,
): PreprocessResult {
  const redacted = doRedact ? redact(raw) : raw;
  const deduped = dedup(redacted);
  const filterResult = filter(deduped);
  const chunkResult = chunk(filterResult.content);

  return {
    content: chunkResult.content,
    chunkResult,
    filterResult,
    wasRedacted: doRedact,
  };
}

export function preprocessVerbose(
  raw: string,
  doRedact: boolean,
): PreprocessResult & { redactStats: RedactStats } {
  const { redacted, stats } = doRedact
    ? redactWithStats(raw)
    : { redacted: raw, stats: { totalReplacements: 0, charsRemoved: 0, patternsMatched: {} } };

  const deduped = dedup(redacted);
  const filterResult = filter(deduped);
  const chunkResult = chunk(filterResult.content);

  return {
    content: chunkResult.content,
    chunkResult,
    filterResult,
    redactStats: stats,
    wasRedacted: doRedact,
  };
}
