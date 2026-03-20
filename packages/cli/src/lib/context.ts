/**
 * Context Builder Module
 * 
 * Builds a codebase context block from a source directory.
 * Used by the --context flag to give the LLM more information about the codebase.
 * 
 * Flow:
 * 1. Walk directory (max depth 4), ignoring node_modules, .git, dist, build, *.lock
 * 2. Extract keywords from stack traces in the log input
 * 3. Score source files by keyword matches
 * 4. Include top 5 files (max 100 lines each)
 * 5. Truncate to 50k chars total (lowest-scored first)
 */

import { readFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ContextFile } from '../types.js';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.cache', '.next', 
  '__pycache__', '.venv', 'venv', 'vendor', 'target',
]);

const IGNORED_EXTENSIONS = new Set([
  '.lock', '.log', '.md', '.txt', '.json', '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.conf', '.env', '.gitignore',
  '.DS_Store', '.svg', '.png', '.jpg', '.jpeg', '.gif',
  '.ico', '.woff', '.woff2', '.ttf', '.eot', '.map',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.rb', '.java', '.go', '.rs', '.cs', '.cpp', '.c',
  '.h', '.hpp', '.swift', '.kt', '.scala', '.php',
]);

const MAX_DEPTH = 4;
const MAX_FILES = 5;
const MAX_LINES_PER_FILE = 100;
const MAX_CONTEXT_CHARS = 50_000;
const CONTEXT_HEADER = '\n\n--- CODEBASE CONTEXT ---\n';
const CONTEXT_FOOTER = '\n--- END CONTEXT ---\n';

/**
 * Builds a context string from a source directory.
 * Should be called before redaction so we get raw file contents.
 * 
 * @param dir Source directory to scan
 * @param logInput The raw log input (used to extract keywords from stack traces)
 * @returns Context block string, or empty string if no files found
 */
export async function buildContext(dir: string, logInput: string): Promise<string> {
  const files = await walkDirectory(dir);
  if (files.length === 0) return '';

  const keywords = extractKeywords(logInput);
  const scored = scoreFiles(files, keywords);
  const selected = scored.slice(0, MAX_FILES);

  const contextParts: string[] = [];
  let totalChars = CONTEXT_HEADER.length + CONTEXT_FOOTER.length;

  for (const file of selected) {
    const content = readFileContent(file.path);
    const truncated = truncateToLines(content, MAX_LINES_PER_FILE);
    const fileEntry = `\nFile: ${file.path}\n\`\`\`\n${truncated}\n\`\`\`\n`;
    
    if (totalChars + fileEntry.length > MAX_CONTEXT_CHARS) {
      break;
    }
    
    contextParts.push(fileEntry);
    totalChars += fileEntry.length;
  }

  if (contextParts.length === 0) return '';

  return CONTEXT_HEADER + contextParts.join('') + CONTEXT_FOOTER;
}

async function walkDirectory(dir: string): Promise<string[]> {
  const results: string[] = [];
  
  function crawl(currentDir: string, depth: number): void {
    if (depth > MAX_DEPTH) return;
    
    let entries: string[] = [];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      
      const fullPath = path.join(currentDir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (IGNORED_DIRS.has(entry)) continue;
        crawl(fullPath, depth + 1);
      } else if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase();
        if (IGNORED_EXTENSIONS.has(ext)) continue;
        if (!SOURCE_EXTENSIONS.has(ext)) continue;
        if (entry.includes('.min.')) continue; // skip minified files
        results.push(fullPath);
      }
    }
  }

  crawl(dir, 0);
  return results;
}

function extractKeywords(input: string): string[] {
  const keywords = new Set<string>();

  // Stack trace patterns for various languages
  const patterns = [
    // Java stack trace: at com.example.Class.method(File.java:123)
    /(?:at\s+)?([A-Z][a-zA-Z0-9_$]*(?:\.[a-z][a-zA-Z0-9_$]*)*\.[a-zA-Z0-9_$]+)\s*\(/gm,
    // Python traceback: File "path/to/file.py", line 123, in function_name
    /def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
    /File\s+"([^"]+)",\s*line\s+\d+/g,
    // JS/TS: at functionName (file.ts:123:45) or at path/file.ts:123
    /at\s+(?:(?:new\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)|(?:[^(\s]+))\s*\(/g,
    /\bat\s+([^\s(]+)\s*\(/g,
    // Go: functionName() /path/to/file.go:123
    /func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
    // Ruby: method_name at file.rb:123
    /`([a-z_][a-zA-Z0-9_!?]*)'/g,
    // Rust: the_function at src/main.rs:123
    /fn\s+([a-z_][a-zA-Z0-9_]*)\s*\(/g,
    // General file:line patterns
    /([a-zA-Z_][a-zA-Z0-9_]*\.(?:ts|tsx|js|jsx|py|go|rs|java|cs|cpp|c|rb|php))\s*[:(]/g,
    // Exception/class names (CamelCase)
    /\b([A-Z][a-zA-Z0-9_]+(?:Exception|Error|ErrorType)?)\b/g,
  ];

  for (const pattern of patterns) {
    const matches = input.matchAll(pattern);
    for (const match of matches) {
      const value = match[1]?.trim();
      if (value && value.length > 1 && value.length < 100) {
        keywords.add(value);
      }
    }
  }

  // Also extract identifiers from import/require statements
  const importPatterns = [
    /(?:import|require)\s*\(?['"]([^'"]+)['"]/g,
    /from\s+['"]([^'"]+)['"]/g,
  ];
  
  for (const pattern of importPatterns) {
    const matches = input.matchAll(pattern);
    for (const match of matches) {
      const value = match[1]?.trim();
      if (value) {
        const parts = value.split('/');
        const last = parts[parts.length - 1];
        if (last) keywords.add(last);
      }
    }
  }

  return Array.from(keywords).slice(0, 100);
}

function scoreFiles(files: string[], keywords: string[]): ContextFile[] {
  if (keywords.length === 0) {
    return files.slice(0, 20).map(f => ({ path: f, content: '', relevanceScore: 0 }));
  }

  const keywordSet = new Set(keywords.map(k => k.toLowerCase()));

  const scored: ContextFile[] = [];

  for (const file of files) {
    let score = 0;
    const basename = path.basename(file).toLowerCase();
    const filename = path.basename(file, path.extname(file)).toLowerCase();
    
    // Score filename match
    for (const kw of keywords) {
      const kwl = kw.toLowerCase();
      if (basename.includes(kwl) || filename.includes(kwl)) {
        score += 5;
      }
    }

    // Try to read file content for scoring
    try {
      const content = readFileSync(file, 'utf8').slice(0, 10000);
      const contentLower = content.toLowerCase();
      
      for (const kw of keywords) {
        const kwl = kw.toLowerCase();
        const regex = new RegExp(`\\b${escapeRegex(kwl)}\\b`, 'gi');
        const matches = content.matchAll(regex);
        let count = 0;
        for (const _ of matches) {
          count++;
          if (count > 5) break;
        }
        score += count;
      }

      // Bonus for matching function/class definitions
      for (const kw of keywords) {
        const kwl = kw.toLowerCase();
        if (content.includes(`function ${kwl}`) || 
            content.includes(`const ${kwl}`) || 
            content.includes(`class ${kwl}`) ||
            content.includes(`def ${kwl}`) ||
            content.includes(`func ${kwl}`) ||
            content.includes(`fn ${kwl}`) ||
            content.includes(`async ${kwl}`)) {
          score += 3;
        }
      }
    } catch {
      // Can't read file, score based on filename only
    }

    scored.push({ path: file, content: '', relevanceScore: score });
  }

  return scored
    .filter(f => f.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

function readFileContent(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function truncateToLines(content: string, maxLines: number): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + '\n... (truncated)';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
