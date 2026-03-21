/**
 * Line Deduplication Module
 *
 * Collapses consecutive identical non-empty lines into "line  [×N]".
 * Preserves original line order. Single occurrences are passed through unchanged.
 * Empty lines are passed through unchanged (never collapsed).
 */

export function dedup(input: string): string {
  if (!input.trim()) return input;

  const lines = input.split('\n');
  const result: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (!line.trim()) {
      result.push(line);
      i++;
      continue;
    }

    let count = 1;
    while (i + count < lines.length && lines[i + count] === line) {
      count++;
    }

    if (count === 1) {
      result.push(line);
    } else {
      result.push(`${line}  [×${count}]`);
    }

    i += count;
  }

  return result.join('\n');
}
