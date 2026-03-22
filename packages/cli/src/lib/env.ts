/**
 * Environment Configuration Module
 *
 * Validates optional environment variables.
 * API key is handled by auth.ts (config file > DRILL_API_KEY > user prompt).
 */

import { z } from 'zod';

const DrillEnvSchema = z.object({
  DRILL_API_URL: z.string().url().optional().default('https://api.minimax.io/v1'),
});

export type DrillEnv = z.infer<typeof DrillEnvSchema>;

export function validateEnv(): DrillEnv {
  const result = DrillEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`\nDrill configuration error:\n${issues}\n`);
    process.exit(1);
  }
  return result.data;
}
