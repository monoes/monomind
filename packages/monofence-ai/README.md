# monofence-ai

[![npm version](https://img.shields.io/npm/v/monofence-ai?color=blue&label=npm)](https://www.npmjs.com/package/monofence-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

**AI manipulation defense for LLM applications** — evasion detection, multi-turn context tracking, output scanning, and hook wiring. Sub-millisecond detection with self-learning.

```
Detection: ~0.04ms | 50+ patterns | evasion normalization | context-aware escalation
```

---

## Install

```bash
npm install monofence-ai
# or
pnpm add monofence-ai
```

Optional — HNSW-accelerated pattern search:

```bash
npm install agentdb
```

---

## Quick start

```typescript
import { isSafe, createMonoDefence } from 'monofence-ai';

// Fast boolean check
isSafe('Hello, help me write code');            // true
isSafe('Ignore all previous instructions');     // false

// Full detection with threat objects
const fence = createMonoDefence();
const result = await fence.detect(userInput);

if (!result.safe) {
  // result.threats — array of detected threats
  // result.overallRisk — 0.0–1.0
}
```

---

## API

### `createMonoDefence(config?)`

Creates a `MonoDefence` instance.

```typescript
const fence = createMonoDefence({
  enableLearning: true,        // persist learned threat patterns (default: false)
  enableContextTracking: true, // track escalation state across turns (default: false)
  enablePIIDetection: true,    // detect PII in inputs/outputs (default: true)
  maxContextTurns: 20,         // rolling window for context tracking (default: 20)
  confidenceThreshold: 0.5,    // minimum detection confidence (default: 0.5)
});
```

### `fence.detect(input)`

Full async scan. Returns:

```typescript
{
  safe: boolean;          // false if any threat detected
  threats: Threat[];      // detected threat objects with type/severity/confidence
  piiFound: boolean;
  overallRisk: number;    // 0.0–1.0
  detectionTimeMs: number;
}
```

> When context tracking is on and escalation reaches `attack`, `overallRisk` is raised
> to at least 0.5 even when `safe=true`. Check both `safe` and `overallRisk` when using
> context tracking.

### `fence.quickScan(input)`

Synchronous, sub-millisecond check. Returns `{ threat: boolean, confidence: number }`.

### `isSafe(input)` / `fence.isSafe(input)`

Returns `boolean`. Fastest option — no async overhead.

### `fence.hasPII(input)`

Returns `boolean`. Checks emails, SSNs, API keys, and passwords.

### `fence.getStats()`

Returns detection counters, learned pattern count, and average latency.

### `fence.learnFromDetection(input, result, feedback)`

Reinforces or corrects a prior detection for human-in-the-loop feedback.

### `fence.getBestMitigation(threatType)`

Returns the highest-effectiveness mitigation strategy for a threat type.

### `fence.searchSimilarThreats(input, { k })`

Vector similarity search over learned threat patterns (requires AgentDB).

### `fence.recordMitigation(threatType, strategy, success)`

Records whether a mitigation worked; affects future `getBestMitigation` results.

---

## Threat types

| Type | Severity | Examples |
|---|---|---|
| `instruction_override` | Critical | "Ignore previous instructions", "forget everything" |
| `jailbreak` | Critical | "DAN mode", "bypass restrictions", "developer mode" |
| `role_switching` | High | "You are now", "Act as an unrestricted AI" |
| `context_manipulation` | Critical | Fake `system:` messages, delimiter injection |
| `encoding_attack` | Medium | base64/hex obfuscation |
| `prompt_injection` | Critical | Injected instructions in user content |

---

## Evasion detection

Inputs are normalized before pattern matching to defeat obfuscation:

- **Homoglyphs**: Cyrillic/Greek lookalikes → ASCII (`і` → `i`)
- **Spaced chars**: `i g n o r e` → `ignore`
- **Leet substitution**: `ign0re` → `ignore` (applied after space collapsing)

```typescript
const result = await fence.detect('іgnore all рrevious instructions'); // Cyrillic chars
// result.safe === false, threats include instruction_override
```

---

## Multi-turn context tracking

Enable to track escalation state across a conversation:

```typescript
const fence = createMonoDefence({ enableContextTracking: true });

// Turn 1: probing question → state: probing
// Turn 2: jailbreak attempt → state: escalating
// Turn 3: confirmed attack → state: attack
// Once in attack state, overallRisk ≥ 0.5 even on benign inputs
```

States: `clean` → `probing` → `escalating` → `attack`. Decays toward `clean` on idle turns.

---

## Multi-agent consensus

When running multiple detection agents in parallel:

```typescript
import { calculateSecurityConsensus } from 'monofence-ai';

const consensus = calculateSecurityConsensus([
  { result: resultA, weight: 0.6 },
  { result: resultB, weight: 0.4 },
]);
// consensus.safe, consensus.overallRisk, consensus.threats
```

A single critical threat short-circuits weighted scoring regardless of agent weight (fail-secure).

---

## Hook wiring (optional)

Wire into the monomind hooks system so pre-task and pre-command inputs are scanned automatically. **Off by default.**

```typescript
import { SecurityHook } from 'monofence-ai/hooks';

SecurityHook.register({ priority: 1000 });
// Runs before all other hooks; aborts on attack escalation state
```

Or from the CLI:

```bash
npx monomind hooks pre-task --monofence-ai-check
```

---

## Review integration

When using `mastermind:review`, two flags activate monofence-ai analysis:

| Flag | Effect |
|---|---|
| `--monofence-ai-check` | Test suite + adversarial probes against the live detector |
| `--monofence-ai-security-deep` | Scan LLM input boundaries for unprotected paths |

Both are off by default:

```bash
/mastermind:review --monofence-ai-check --monofence-ai-security-deep
```

---

## MCP tools

Six MCP tools are available when monomind is installed:

| Tool | Description |
|---|---|
| `aidefence_scan` | Scan input for threats (`input`, `quick?`) |
| `aidefence_analyze` | Deep analysis with similar-pattern search |
| `aidefence_stats` | Detection and learning statistics |
| `aidefence_learn` | Record feedback for pattern learning |
| `aidefence_is_safe` | Quick boolean check |
| `aidefence_has_pii` | PII detection only |

---

## Performance

| Operation | Typical latency |
|---|---|
| Full `detect()` | ~0.04ms |
| `quickScan()` | ~0.02ms |
| PII check | ~0.01ms |
| HNSW search (AgentDB) | ~0.1ms |

Throughput: >12,000 req/s single-threaded. Memory: ~50KB per instance.

---

## Deprecated aliases

Still exported for backward compatibility; will be removed in v2:

| Deprecated | Replacement |
|---|---|
| `createAIDefence` | `createMonoDefence` |
| `getAIDefence` | `getMonoDefence` |
| `AIDefenceConfig` | `MonoDefenceConfig` |
| `AIDefence` | `MonoDefence` |

---

## Development

```bash
git clone https://github.com/monoes/monomind.git
cd monomind/packages/monofence-ai

npm install
npm test        # vitest run
npm run build   # tsc
```

---

## License

MIT — part of the [Monomind](https://github.com/monoes/monomind) ecosystem.
