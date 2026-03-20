import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

async function main() {
  await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outfile: 'dist/index.js',
    banner: {
      js: '#!/usr/bin/env node\n// drill-cli ' + pkg.version,
    },
    define: {
      __VERSION__: JSON.stringify(pkg.version),
      __ANON_KEY__: JSON.stringify(process.env['DRILL_ANON_KEY'] ?? ''),
    },
    external: [
      'fsevents',
      'commander',
      'ora',
      'chalk',
      'boxen',
      'conf',
      'chokidar',
      'eventsource-parser',
      'zod',
      'open',
      'glob',
    ],
    minify: process.env['NODE_ENV'] === 'production',
    sourcemap: process.env['NODE_ENV'] !== 'production',
    logLevel: 'info',
  });
  console.log('Build complete: dist/index.js');
}

main();
