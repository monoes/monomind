# monofence-ai

[![npm version](https://img.shields.io/npm/v/monofence-ai?style=flat-square)](https://www.npmjs.com/package/monofence-ai)
[![license](https://img.shields.io/npm/l/monofence-ai?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-blue?style=flat-square)](https://nodejs.org)

**AI manipulation defense** — prompt injection, jailbreak, homoglyph evasion, base64 encoding, multi-turn escalation, and PII detection. Sub-millisecond, 50+ patterns, self-learning.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem.

## Install

```bash
npm install monofence-ai
```

## Quick start

```typescript
import { isSafe, createMonoDefence } from 'monofence-ai';

// Fast boolean check (~0.04ms)
isSafe('Hello, help me write code');          // true
isSafe('Ignore all previous instructions');   // false

// Full detection with threat details
const fence = createMonoDefence();
const result = await fence.detect(userInput);

if (!result.safe) {
  console.log(result.threats);     // detected threat objects
  console.log(result.overallRisk); // 0.0–1.0
}
```

## API

### `createMonoDefence(config?)`

```typescript
const fence = createMonoDefence({
  enableLearning: true,        // persist learned patterns (default: false)
  enableContextTracking: true, // track multi-turn escalation (default: false)
  enablePIIDetection: true,    // detect PII (default: true)
  maxContextTurns: 20,         // rolling window (default: 20)
  confidenceThreshold: 0.5,    // minimum detection confidence (default: 0.5)
});
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `fence.detect(input)` | `Promise<DetectionResult>` | Full async scan with threats, risk score, timing |
| `fence.quickScan(input)` | `{ threat, confidence }` | Synchronous sub-millisecond check |
| `fence.hasPII(input)` | `boolean` | Check for emails, SSNs, API keys, passwords |
| `fence.scanOutput(output, prompt?)` | `Promise<OutputScanResult>` | Scan LLM output for leakage/echo/policy violations |
| `fence.isAllowed(input)` / `fence.addAllowlistRule(rule)` | — | Allowlist bypass for known-safe inputs |
| `fence.getStats()` | `Promise<Stats>` | Detection + learning statistics |

Module-level helpers: `isSafe(input)` (fastest boolean check against a shared
singleton), `checkThreats(input)`, `getMonoDefence()`, `resetMonoDefence()`.

### Detection result

```typescript
{
  safe: boolean;
  threats: Threat[];       // type, severity, confidence per threat
  piiFound: boolean;
  overallRisk: number;     // 0.0–1.0
  detectionTimeMs: number;
}
```

### Learning (opt-in)

```typescript
const fence = createMonoDefence({ enableLearning: true });

await fence.learnFromDetection(input, result, { wasAccurate: true });
const similar = await fence.searchSimilarThreats(suspiciousInput);
const strategy = await fence.getBestMitigation('prompt_injection');
```

## What it detects

- Prompt injection (direct and indirect)
- Jailbreak attempts
- Homoglyph substitution (Cyrillic, Unicode lookalikes)
- Base64 encoded payloads
- Multi-turn escalation patterns
- PII (emails, SSNs, API keys, passwords)
- Role-play manipulation
- Context window abuse

## Links

- [GitHub](https://github.com/monoes/monomind)
- [npm](https://www.npmjs.com/package/monofence-ai)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT
