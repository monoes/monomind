# Monomind v1.11 — MonoFence AI, Semantic Routing, and Scheduled Orgs

A major release arc: a new AI manipulation-defence package under its own npm name, real
local-embedding semantic routing, an autonomous scheduled-org lifecycle, a full monograph
engine upgrade, extensive dependency cleanup, and a rebuilt documentation site.

---

## TL;DR

| Area | Before | After |
|---|---|---|
| AI security | `@monomind/aidefence` — basic threat scanner | `monofence-ai` — evasion detect, context tracking, output scanning, allowlist, SecurityHook, consensus |
| Routing | Keyword-only fallback | Real local-embedding semantic routing via isolated worker |
| Orgs | Manual one-shot org spawn | `--schedule` flag, `runorg` loop, `stoporg`, `orgs`, `orgstatus` |
| Monograph | CLI-internal only | Published `@monoes/monograph@1.2.0`, graph-first protocol baked into engine |
| Memory | Naive in-process embedding | Optimised across 19 files; embedding routed through dedicated provider |
| Dep footprint | Bloated (`eslint`, `bcrypt`, `better-sqlite3`, 8 unused) | Audited and trimmed |
| Docs site | Stale `/monomind:*` commands, missing 30+ skills | Full `/mastermind:*` slash-command grid (80+), MonoFence AI section |

---

## Release Timeline

### v1.11.0 — Monograph engine upgrade
`feat(monograph)` — Bake graph-first protocol into the engine. Publish `@monoes/monograph@1.2.0` and wire the CLI to the real package (replacing the internal copy). Surface new monograph capabilities in the dashboard UI. Fix non-atomic registry overwrite in contract-registry; 8 + 4 + 6 + 4 + 2 bugs resolved across four review rounds.

### v1.11.1 — Monograph compat fixes
`fix(monograph-compat)` — Replace `require('fs')` with ESM import (silent data loss fix). Eliminate double `getNodesForFile` call in `detectMonographChanges`. Three correctness bugs from review.

### v1.11.2 — Routing foundation
`feat(routing)` — Delegate LLM fallback to headless Claude Code; drop the Anthropic SDK direct dependency. Fix `route` command always returning `coder` (missing `await`). Add per-route outcome record linking recommendation → actual → success. Auto-correlate route→outcome without manual `routeId`; surface accuracy metric in `doctor`.

### v1.11.3 — MonoVector / native layer
`feat(monovector)` — Import raw WASM crate sources, rename crates `ruvector→monovector`, add `wasm-pack` build scripts across 6 packages, wire `pnpm workspace:*`. Phase 2 napi-rs crates + CI matrix build workflow. Wire `@monoes/attention` into `flashAttentionSearch` production path with JS fallback.

`feat(monoes)` — Add typed interfaces for sona/attention/learning-wasm/router. Unified `getCapabilities()` surface. `pkg-loader` utility with module-level cache. `createInitState` counter-with-max pattern. Wire `WasmMicroLoRA` into LoRA path. Multiple critical/high fixes: inverted-polarity HNSW mock, infinite-retry in SonaBridge, SONA learning loop closed.

### v1.11.4 — Neural/SONA cleanup + teardown
`refactor(monoes)` — After extensive SONA integration work, tear down the full neural layer: remove SONA, native/WASM modules, `@monoes/rvagent-wasm` cluster, `@monoes/{rvf,gnn,gnn-wasm,attention-wasm,exotic-wasm,ruvllm-wasm}`, and all references. Keep lean keyword routing + honest outcome measurement. Full version preserved on `monoes-full-loop` branch.

`heal(monoes)` — Rewrite docs/CLAUDE/READMEs/help text to lean reality (keyword routing + outcome measurement); stop advertising removed SONA/Flash/MoE/HNSW-multiplier features. Fix crashing `neural` command; delete broken tests; remove uninstallable neural plugin from registry.

### v1.11.5 — Dependency cleanup
`chore(deps)` — Remove `@monomind/embeddings` package and all consumer references. Audit and remove 8 genuinely-unused dependencies. Remove vestigial ESLint toolchain + dead `@types/bcrypt`. Remove redundant `better-sqlite3` from `@monomind/hooks`. Resolve pnpm peer-dependency warnings.

`fix(routing)` — Apply LoRA in index embedding space so learned weights survive. Fix routing gate to read `embeddingDim`. Discard stale-dim persisted weights.

### v1.11.6 — Semantic routing (real embeddings)
`feat(routing)` — Real local-embedding semantic routing via **isolated worker** process. Embeddings generated through `@monomind/embeddings` provider. Route→outcome correlation without manual IDs. Harden review findings: worker stdout, cache, degradation visibility.

`fix(learning)` — Derive measured task success from real command exit codes. Use final-state heuristic (iterate-until-green = success). Fix multi-command bleeding.

### v1.11.7 — Scheduled Org Lifecycle
`feat(mastermind)` — **Scheduled org lifecycle**: `createorg --schedule <interval>`, `runorg` (persistent loop), `stoporg`, `orgs` (list all), `orgstatus` (detailed status). Auto-generate complete agent specs for every role. Cold first-shot newsroom org test (all 4 roles fully specified).

`feat(orgs)` — Agent avatars + per-role detail drawer in dashboard. Wire Costs/Heartbeats/Tasks/Members/Settings/Skills tabs to real data. Org dashboard scoped to current project. Fix agent detail drawer honoring current project dir. Remove 5 + 6 redundant org sub-tabs.

`fix(org)` — Add jq null guards; complete sidecar suffix sets across mastermind skills.

### v1.11.8 — MonoFence AI (AI manipulation defence)
**New package: `monofence-ai`** (renamed from `@monomind/aidefence` → `@monomind/monodefence` → `monofence-ai`)

Six new capabilities shipped incrementally:

| Feature | What it does |
|---|---|
| **EvasionDetector** | Homoglyph substitution, leetspeak normalisation, spacing tricks, base64 encoding |
| **ContextTracker** | Sliding-window escalation state machine across multi-turn conversations |
| **OutputScanner** | PII leakage, echo attacks, policy violations, contradictions in model outputs |
| **Allowlist** | 5 built-in rules + user-defined rules; TTL decay; anchored patterns |
| **SecurityHook** | Pre-task and pre-command threat blocking wired into monomind hooks |
| **SecurityConsensus** | Multi-agent security consensus (`calculateSecurityConsensus`) |

New type exports: `EvasionResult`, `ContextState`, `OutputScanResult`, `AllowlistRule`.

Facade: `createMonoDefence()`, `getMonoDefence()`. Deprecated aliases for `createAIDefence`/`getAIDefence` kept until v2.

CLI review flags renamed:
- `--security-check` → `--monofence-ai-check`
- `--security-deep` → `--monofence-ai-security-deep`

Critical bug fixes:
- g-flag regex reset causing stateful `lastIndex` bugs
- `isSafe`/`checkThreats` using per-call instances instead of singleton
- PII threat stripping not recalculating `safe`/`overallRisk`
- Leet-after-collapse ordering; pipe in char class; divide-by-zero in score decay
- Learned patterns deduplicated by hash key

### v1.11.9 — Memory optimisation + path portability + docs
`perf(memory)` — Optimise memory management across **19 files** in `@monomind/memory`: reduce allocations, tighten lifecycle, improve search throughput.

`fix` — Store relative paths in `.monomind/` directory; removes machine-specific absolute paths that broke cross-machine syncs.

`docs(website)` — Complete rebuild of the slash commands reference page:
- Fix all `~12` commands with wrong `/monomind:*` prefix → `/mastermind:*`
- Add 30+ previously missing commands (debug, tdd, plan, execute, taskdev, verify, finish, worktree, receive-review, ideate, design, createorg, runorg, stoporg, orgs, orgstatus, approve, memory, budget, graph-status, loops, repeat, understand, swarm, help, skill-builder, specialagents, content, sales, code-review, adr)
- New MonoFence AI page: install guide, API reference, feature cards, migration table
- Mastermind reference table grouped into 5 sections (Dev / Research / Task & Org / Utilities / Business)

---

## Breaking Changes

| Change | Migration |
|---|---|
| `@monomind/aidefence` / `@monomind/monodefence` → `monofence-ai` | `npm install monofence-ai`; old import path available as deprecated alias until v2 |
| `createAIDefence()` → `createMonoDefence()` | Deprecated alias still exported; migrate before v2 |
| `--security-check` flag → `--monofence-ai-check` | Update any shell scripts or hook configs |
| `--security-deep` flag → `--monofence-ai-security-deep` | Update any shell scripts or hook configs |
| `@monomind/embeddings` removed | Embedding generation now internal to memory package |
| SONA / native WASM layer removed | Pure JS keyword routing; no native binaries required |

---

## Package Versions

| Package | Version |
|---|---|
| `monomind` (umbrella) | 1.11.9 |
| `@monomind/cli` | 1.11.8 |
| `monofence-ai` | 1.0.0 |
| `@monoes/monograph` | 1.2.0 |
| `@monomind/hooks` | 1.0.0 |
| `@monomind/memory` | 1.0.0 |
| `@monomind/guidance` | 1.0.0 |

---

## Stats

- **149 commits** since v1.10.55
- **6 new features** in monofence-ai
- **30+ slash commands** added to docs site
- **8 dependencies** removed
- **19 files** optimised in @monomind/memory
