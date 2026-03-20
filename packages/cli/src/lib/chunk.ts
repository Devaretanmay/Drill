/**
 * Smart Log Chunking Module
 * 
 * Intelligently chunks large log input to fit within LLM context window.
 * Preserves the most diagnostically relevant content: error lines with
 * surrounding context, recent tail, and startup head lines.
 */

import type { ChunkOptions, ChunkResult } from '../types.js';

const DEFAULT_OPTIONS: ChunkOptions = {
  maxChars: 320000,
  lastNLines: 200,
  headLines: 20,
  contextRadius: 50,
};

const ERROR_KEYWORDS = /\b(ERROR|FATAL|Traceback|panic|CRITICAL|SEVERE|stderr|Killed|OOM|segfault|core dumped|assertion failed)\b/i;
const ERROR_SUBSTRINGS = ['Exception'];

/**
 * Estimates token count for a string (rough: chars / 4).
 * Used to decide whether chunking is needed.
 * @param input String to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(input: string): number {
  if (typeof input !== 'string') {
    return 0;
  }
  return Math.ceil(input.length / 4);
}

/**
 * Finds line indices containing error keywords.
 * Used by chunk() to extract error context windows.
 * @param lines Array of log lines
 * @returns Array of line indices that contain error keywords
 */
export function findErrorLines(lines: string[]): number[] {
  if (!Array.isArray(lines)) {
    return [];
  }
  
  const errorIndices: number[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (typeof line === 'string') {
      if (ERROR_KEYWORDS.test(line)) {
        errorIndices.push(i);
      } else {
        for (const substr of ERROR_SUBSTRINGS) {
          if (line.includes(substr)) {
            errorIndices.push(i);
            break;
          }
        }
      }
    }
  }
  
  return errorIndices;
}

/**
 * Intelligently chunks large log input to fit within LLM context window.
 * @param input Full log string, any size
 * @param options Chunking configuration
 * @returns ChunkResult with processed content and metadata
 */
export function chunk(input: string, options?: Partial<ChunkOptions>): ChunkResult {
  if (typeof input !== 'string') {
    return {
      content: '',
      wasChunked: false,
      originalLines: 0,
      resultLines: 0,
      strategy: 'passthrough',
    };
  }
  
  const config = { ...DEFAULT_OPTIONS, ...options };
  const lines = input.split('\n');
  const originalLines = lines.length;
  
  if (input.length <= config.maxChars) {
    return {
      content: input,
      wasChunked: false,
      originalLines,
      resultLines: originalLines,
      strategy: 'passthrough',
    };
  }
  
  const headLines = lines.slice(0, config.headLines);
  const tailLines = lines.slice(-config.lastNLines);
  const errorIndices = findErrorLines(lines);
  
  const contextIndices = new Set<number>();
  
  for (const errorIdx of errorIndices) {
    for (let i = Math.max(0, errorIdx - config.contextRadius); 
         i <= Math.min(lines.length - 1, errorIdx + config.contextRadius); 
         i++) {
      contextIndices.add(i);
    }
  }
  
  const contextLines: string[] = [];
  const sortedContextIndices = Array.from(contextIndices).sort((a, b) => a - b);
  for (const idx of sortedContextIndices) {
    contextLines.push(lines[idx] ?? '');
  }
  
  let combinedContent: string;
  let strategy: ChunkResult['strategy'];
  
  if (contextLines.length > 0) {
    const headContent = headLines.join('\n');
    const tailContent = tailLines.join('\n');
    const contextContent = contextLines.join('\n');
    
    combinedContent = `${headContent}\n\n... [truncated]\n\n${contextContent}\n\n... [truncated]\n\n${tailContent}`;
    strategy = contextIndices.size > 0 ? 'mixed' : 'error-context';
  } else {
    const headContent = headLines.join('\n');
    const tailContent = tailLines.join('\n');
    combinedContent = `${headContent}\n\n... [truncated]\n\n${tailContent}`;
    strategy = 'tail';
  }
  
  if (combinedContent.length > config.maxChars) {
    const headContent = headLines.join('\n');
    const tailContent = tailLines.join('\n');
    const truncationMarker = '\n\n... [truncated]\n\n';
    const tailMarker = truncationMarker + tailContent;
    
    if (headContent.length + truncationMarker.length + tailMarker.length <= config.maxChars) {
      combinedContent = headContent + truncationMarker + tailMarker;
    } else if (tailContent.length + truncationMarker.length <= config.maxChars) {
      combinedContent = truncationMarker + tailMarker;
    } else {
      const truncatedTail = tailContent.slice(0, config.maxChars - truncationMarker.length);
      combinedContent = truncationMarker + truncatedTail + '\n... [truncated]';
    }
  }
  
  const resultLines = combinedContent.split('\n').length;
  
  return {
    content: combinedContent,
    wasChunked: true,
    originalLines,
    resultLines,
    strategy,
  };
}
