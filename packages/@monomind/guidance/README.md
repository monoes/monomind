# @monomind/guidance

[![npm version](https://img.shields.io/npm/v/@monomind/guidance.svg?style=flat-square&label=npm)](https://www.npmjs.com/package/@monomind/guidance)
[![license](https://img.shields.io/npm/l/@monomind/guidance.svg?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue?style=flat-square)](https://nodejs.org)

**Long-horizon governance for Claude Code agents.**

AI coding agents break down over long sessions — they forget rules, loop on failing approaches, corrupt memory, and need a human to step in. `@monomind/guidance` turns `CLAUDE.md` files into a structured control plane with enforcement gates, cryptographic proof chains, and rule evolution. The result: agents that operate for days instead of minutes.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem.

## Install

```bash
npm install @monomind/guidance
```

## What it does

Takes `CLAUDE.md` + `CLAUDE.local.md` and runs them through a 7-phase pipeline:

1. **Compile** — Parses rules into a typed policy bundle (constitution + task-scoped shards)
2. **Retrieve** — Classifies task intent and injects only the relevant rule shards
3. **Enforce** — 4 gates the model cannot bypass (destructive ops, tool allowlist, diff size, secrets)
4. **Trust** — Per-agent trust accumulation; reliable agents get faster throughput, unreliable ones get throttled
5. **Defend** — Prompt injection, memory poisoning, inter-agent collusion detection
6. **Prove** — Hash-chained cryptographic envelopes for every decision (replayable audit trail)
7. **Evolve** — Automatic rule promotion from local experiments via simulation and staged rollout

## Quick start

```typescript
import { GuidanceCompiler, ShardRetriever, EnforcementGates } from '@monomind/guidance';

// Compile CLAUDE.md into policy
const compiler = new GuidanceCompiler();
const policy = await compiler.compile('./CLAUDE.md', './CLAUDE.local.md');

// Retrieve relevant rules for a task
const retriever = new ShardRetriever(policy);
const rules = retriever.retrieve('implement OAuth2 authentication');

// Enforce gates on agent actions
const gates = new EnforcementGates(policy);
const decision = await gates.check(agentAction); // allow | deny | warn
```

## Key modules

| Layer | Module | Purpose |
|-------|--------|---------|
| Compile | `GuidanceCompiler` | CLAUDE.md to constitution + shards |
| Retrieve | `ShardRetriever` | Intent-based rule retrieval |
| Enforce | `EnforcementGates` | 4 core gates (destructive, allowlist, diff, secrets) |
| | `ContinueGate` | Loop control (budget slope, rework ratio) |
| | `MemoryWriteGate` | Authority, rate limiting, contradiction tracking |
| | `EconomicGovernor` | Token/tool/cost budget enforcement |
| Trust | `TrustSystem` | Per-agent trust with decay and tiers |
| Adversarial | `ThreatDetector` | Injection, poisoning, exfiltration |
| Prove | `ProofChain` | Hash-chained cryptographic envelopes |
| Evolve | `EvolutionPipeline` | Propose, simulate, stage, promote rules |
| WASM | `WasmKernel` | Rust-compiled SHA-256, HMAC, secret scanning |
| Analyze | `analyze` | 6-dimension CLAUDE.md quality scoring |

## WASM kernel

Security-critical hot paths run in a sandboxed Rust WASM kernel (no filesystem, no network). Falls back to JS automatically.

```typescript
import { getKernel } from '@monomind/guidance/wasm-kernel';

const kernel = getKernel();
const hash = kernel.sha256('event data');
const secrets = kernel.scanSecrets(fileContent);
```

## Links

- [GitHub](https://github.com/monoes/monomind)
- [npm](https://www.npmjs.com/package/@monomind/guidance)
- [Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT
