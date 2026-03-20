/**
 * Manual Smoke Test for Phase 2
 * 
 * This file is for LOCAL TESTING ONLY - do not commit with real API keys.
 * Run with: DRILL_API_KEY=your_key tsx packages/cli/test/manual-smoke.ts
 */

import { analyze } from '../src/lib/api.js';

const testLog = `
2024-01-15 14:07:33 ERROR: remaining connection slots are reserved for non-replication superuser connections
2024-01-15 14:07:33 ERROR: connection to server at "db.prod.internal" (10.0.0.5), port 5432 failed: FATAL: remaining connection slots are reserved
2024-01-15 14:07:33 ERROR: [UserService] Failed to fetch user profile: Connection refused
2024-01-15 14:07:33 ERROR: [OrderService] Failed to create order: Connection refused
2024-01-15 14:07:33 ERROR: [AuthService] Failed to validate session: Connection refused
2024-01-15 14:07:33 ERROR: Connection pool exhausted, 20/20 connections in use
2024-01-15 14:07:34 ERROR: [PaymentService] Failed to process payment: Connection refused
2024-01-15 14:07:34 ERROR: [NotificationService] Failed to send email: Connection refused
`;

console.log('Calling M2.5 directly...\n');
console.log('Test log loaded:', testLog.trim().split('\n').length, 'lines\n');

const result = await analyze({
  input: testLog,
  onThinking: (text) => process.stdout.write(`\x1b[2m${text}\x1b[0m`),
  onResultChunk: () => undefined,
});

if ('code' in result) {
  console.error('\n\nError:', result.code, '-', result.message);
  process.exit(1);
}

console.log('\n\n=== RESULT ===');
console.log(JSON.stringify(result, null, 2));
console.log('\nCause:', result.cause);
console.log('Confidence:', result.confidence + '%');
console.log('Severity:', result.severity);
console.log('Fix:', result.fix);
