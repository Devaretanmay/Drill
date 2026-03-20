/**
 * Environment Configuration Module
 * 
 * Validates optional environment variables for non-key configuration.
 * API key is handled by auth.ts (config file > DRILL_API_KEY > error).
 */

import { z } from 'zod';

const Phase4EnvSchema = z.object({
  DRILL_API_URL: z.string().url().optional().default('https://api.drill.dev'),
  DRILL_FALLBACK_URL: z.string().url().optional().default('https://api.together.xyz/v1'),
  DRILL_FALLBACK_KEY: z.string().optional().default(''),
  DRILL_MODEL: z.string().optional().default('MiniMax-M2.5'),
  DRILL_FALLBACK_MODEL: z.string().optional().default('MiniMaxAI/MiniMax-M2.5'),
});

export type DrillEnv = z.infer<typeof Phase4EnvSchema>;

/**
 * Validates and returns environment variables.
 * Does not require any variables — all are optional with defaults.
 * API key is handled separately by auth.ts.
 */
export function validateEnv(): DrillEnv {
  const result = Phase4EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`\nDrill configuration error:\n${issues}\n`);
    process.exit(1);
  }
  return result.data;
}
