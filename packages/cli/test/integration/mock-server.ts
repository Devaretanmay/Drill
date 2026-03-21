/**
 * Mock API Server for E2E Tests
 * 
 * A minimal HTTP server that returns valid SSE responses matching the
 * MiniMax M2.5 streaming format that drill expects.
 * 
 * This is used by e2e-cli.test.ts to test the binary without a real API call.
 * The server listens on port 9999 and self-terminates after responding.
 */

import http from 'node:http';

const MOCK_RESULT = JSON.stringify({
  cause: 'Database connection pool exhausted',
  confidence: 87,
  severity: 'high',
  evidence: ['Too many connections at 14:07:33', 'Pool size: 10, Active: 10'],
  fix: 'Increase DB_POOL_SIZE from 10 to 25 in your .env file',
  alternative: null,
  missing: null,
});

export function createMockServer(port = 9999): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/chat/completions') {
      req.on('data', () => undefined);
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        // Send the result as a proper SSE stream that stream.ts can parse
        // Format: data: {"choices":[{"delta":{"content":"..."}}]}\n\n
        const thinkChunk = `data: {"choices":[{"delta":{"content":"<think> Analyzing..."}}]}\n\n`;
        const resultChunk1 = `data: {"choices":[{"delta":{"content":"result: ${MOCK_RESULT.slice(0, 50)}"}}]}\n\n`;
        const resultChunk2 = `data: {"choices":[{"delta":{"content":"${MOCK_RESULT.slice(50)}"}}]}\n\n`;
        const doneChunk = 'data: [DONE]\n\n';

        res.write(thinkChunk);
        setTimeout(() => {
          res.write(resultChunk1);
          setTimeout(() => {
            res.write(resultChunk2);
            setTimeout(() => {
              res.write(doneChunk);
              res.end();
              server.close();
            }, 50);
          }, 50);
        }, 50);
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port);
  return server;
}

export function startMockServer(port = 9999): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = createMockServer(port);
    server.on('listening', () => resolve(server));
  });
}
