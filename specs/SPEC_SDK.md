# SPEC_SDK — packages/sdk

## Overview

The SDK is a thin wrapper around the drill.dev API that lets developers embed Drill analysis directly into their applications. It does NOT run a local model — it calls the same managed API the CLI uses.

---

## Node.js SDK

### Package identity
```json
{
  "name": "drill-sdk",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.mjs", "require": "./dist/index.js" }
  }
}
```

### Complete API surface

```typescript
// packages/sdk/src/index.ts

export class DrillClient {
  constructor(options: DrillClientOptions);

  // Core method — analyze any text input
  analyze(input: string, options?: AnalyzeOptions): Promise<DrillResult>;

  // Wrap a logger instance — hooks error events
  watch(logger: SupportedLogger, options?: WatchOptions): DrillWatcher;

  // One-shot: analyze a file path
  analyzeFile(filePath: string, options?: AnalyzeOptions): Promise<DrillResult>;

  // Analyze the last N lines of a file
  analyzeFileTail(filePath: string, lines: number, options?: AnalyzeOptions): Promise<DrillResult>;
}

export interface DrillClientOptions {
  apiKey?: string;       // Default: process.env.DRILL_API_KEY
  apiUrl?: string;       // Default: 'https://drill.dev'
  timeout?: number;      // Default: 90000 (90s)
  redact?: boolean;      // Default: true
  onThinking?: (text: string) => void;  // Stream thinking output
}

export interface AnalyzeOptions {
  context?: string;       // Additional context to include
  lines?: number;         // Limit input to last N lines
  noRedact?: boolean;     // Override instance redact setting
}

export interface WatchOptions {
  onResult: (result: DrillResult, logChunk: string) => void;
  onError?: (err: Error) => void;
  debounceMs?: number;    // Default: 500
  errorPatterns?: RegExp[]; // Default: standard error patterns
}

export type SupportedLogger = WinstonLike | PinoLike | BunyanLike | Console;

// DrillResult — same as CLI type
export interface DrillResult {
  cause: string;
  confidence: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  evidence: string[];
  fix: string;
  alternative: string | null;
  missing: string | null;
}
```

### Usage examples (must work exactly as shown)

```typescript
// Basic usage
import { DrillClient } from 'drill-sdk';
const drill = new DrillClient({ apiKey: process.env.DRILL_API_KEY });

const result = await drill.analyze(logString);
console.log(result.cause);  // "Database connection pool exhausted"

// Express.js error handler integration
app.use(async (err: Error, req: Request, res: Response, next: NextFunction) => {
  const result = await drill.analyze(err.stack ?? err.message);
  logger.error({ drillCause: result.cause, drillFix: result.fix }, 'Unhandled error');
  next(err);
});

// Winston logger integration
import winston from 'winston';
const logger = winston.createLogger({ ... });
const watcher = drill.watch(logger, {
  onResult: (result) => {
    logger.info({ drillAnalysis: result }, 'Drill analysis complete');
  }
});
// watcher.stop() to detach

// Pino integration
import pino from 'pino';
const logger = pino();
const watcher = drill.watch(logger, {
  onResult: (result) => console.log('Drill:', result.cause)
});
```

### SDK error handling

```typescript
// SDK NEVER throws — always returns a result or a DrillSDKError object
// This means it's safe to use in error handlers without creating error loops

import { DrillClient, DrillSDKError, isDrillError } from 'drill-sdk';

const result = await drill.analyze(logText);
if (isDrillError(result)) {
  // Handle gracefully — don't throw
  console.warn('Drill analysis failed:', result.message);
} else {
  console.log('Cause:', result.cause);
}
```

---

## Python SDK

### Package identity
```toml
# pyproject.toml
[project]
name = "drill-sdk"
version = "1.0.0"
requires-python = ">=3.9"
dependencies = ["httpx>=0.27", "pydantic>=2.0"]
```

### Complete API surface

```python
# drill_sdk/__init__.py

from drill_sdk.client import DrillClient
from drill_sdk.types import DrillResult, DrillError

__all__ = ['DrillClient', 'DrillResult', 'DrillError']
```

```python
# drill_sdk/client.py

from typing import Optional, Callable
from drill_sdk.types import DrillResult, DrillError
import httpx
import os

class DrillClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        api_url: str = "https://drill.dev",
        timeout: float = 90.0,
        redact: bool = True,
        on_thinking: Optional[Callable[[str], None]] = None,
    ):
        self.api_key = api_key or os.environ.get("DRILL_API_KEY", "")
        self.api_url = api_url
        self.timeout = timeout
        self.redact = redact
        self.on_thinking = on_thinking

    def analyze(
        self,
        input: str,
        context: Optional[str] = None,
        lines: Optional[int] = None,
        no_redact: bool = False,
    ) -> DrillResult | DrillError:
        """
        Analyze log input and return root cause.
        Never raises — returns DrillError on failure.
        """
        ...

    def analyze_file(self, path: str, **kwargs) -> DrillResult | DrillError:
        """Read file and analyze its contents."""
        ...

    def analyze_exception(
        self,
        exc: BaseException,
        context: Optional[str] = None,
    ) -> DrillResult | DrillError:
        """Analyze a Python exception with full traceback."""
        import traceback
        tb = ''.join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        return self.analyze(tb, context=context)
```

```python
# drill_sdk/types.py

from pydantic import BaseModel
from typing import Optional, Literal, List

class DrillResult(BaseModel):
    cause: str
    confidence: int  # 0-100
    severity: Literal['critical', 'high', 'medium', 'low']
    evidence: List[str]
    fix: str
    alternative: Optional[str]
    missing: Optional[str]

class DrillError(BaseModel):
    code: str
    message: str
    upgrade_url: Optional[str] = None

def is_drill_error(result: DrillResult | DrillError) -> bool:
    return isinstance(result, DrillError)
```

### Python usage examples

```python
# Basic usage
from drill_sdk import DrillClient

drill = DrillClient()  # reads DRILL_API_KEY from env

result = drill.analyze(log_text)
if not is_drill_error(result):
    print(f"Cause: {result.cause}")
    print(f"Fix: {result.fix}")

# Exception handler integration
import logging
from drill_sdk import DrillClient, is_drill_error

drill = DrillClient()

def handle_exception(exc: Exception):
    result = drill.analyze_exception(exc)
    if not is_drill_error(result):
        logging.error(f"Drill analysis: {result.cause} (confidence: {result.confidence}%)")

# Django middleware integration
class DrillMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self.drill = DrillClient()

    def __call__(self, request):
        response = self.get_response(request)
        return response

    def process_exception(self, request, exception):
        import traceback
        tb = traceback.format_exc()
        result = self.drill.analyze(tb)
        if not is_drill_error(result):
            logger.error("drill_cause=%s drill_fix=%s", result.cause, result.fix)
        return None  # don't suppress the exception
```

---

## SDK distribution

### npm
```bash
# Published as drill-sdk to npm
npm install drill-sdk
```

### PyPI
```bash
# Published as drill-sdk to PyPI
pip install drill-sdk
```

### SDK CI/CD (GitHub Actions)
- On tag push matching `sdk-v*`: publish both npm and PyPI packages automatically
- Secrets required: `NPM_TOKEN`, `PYPI_TOKEN`
