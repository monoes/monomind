# Monomind Architecture — Packages, Components & Wiring

> **Version:** v1.14.7 · **Generated:** 2026-06-20 · **Reference commit:** `44470d5c`
>
> Exhaustive reference covering every package, component, wiring quality, and real value delivered. Read this if you want to understand what monomind actually does vs what it aspires to, and which parts are solid vs stubs.

---

## Table of Contents

1. [Repository Structure](#1-repository-structure)
2. [Package Inventory](#2-package-inventory)
   - [2.1 Core Packages](#21-core-packages)
   - [2.2 Intelligence Packages](#22-intelligence-packages)
   - [2.3 Infrastructure Packages](#23-infrastructure-packages)
   - [2.4 Auxiliary / Stub Packages](#24-auxiliary--stub-packages)
3. [CLI — Commands, MCP Tools & UI Server](#3-cli--commands-mcp-tools--ui-server)
   - [3.1 All 41 Commands](#31-all-41-commands)
   - [3.2 All MCP Tools (50+)](#32-all-mcp-tools-50)
   - [3.3 Dashboard UI & Control Server](#33-dashboard-ui--control-server)
4. [Agent & Skill System](#4-agent--skill-system)
   - [4.1 Agent Definitions](#41-agent-definitions)
   - [4.2 Mastermind Skills (93 files)](#42-mastermind-skills-93-files)
5. [Integration Wiring](#5-integration-wiring)
6. [Runtime State](#6-runtime-state)
7. [External Dependencies](#7-external-dependencies)
8. [Test Coverage](#8-test-coverage)
9. [Wiring Quality Assessment](#9-wiring-quality-assessment)
10. [Real Value Assessment Per Component](#10-real-value-assessment-per-component)
11. [Known Gaps & Honest Caveats](#11-known-gaps--honest-caveats)

---

## 1. Repository Structure

```
monomind/                           # workspace root — published as "monomind" on npm
├── packages/
│   ├── @monomind/                  # 13 scoped packages (CLI-side)
│   │   ├── cli/                    # ← main entry: 41 commands, dashboard, MCP tools
│   │   ├── guidance/               # governance control plane
│   │   ├── hooks/                  # 17 lifecycle hooks + 12 background workers
│   │   ├── memory/                 # HNSW + LanceDB hybrid memory backend
│   │   ├── mcp/                    # standalone MCP server (stdio / HTTP / WS)
│   │   ├── graph/                  # codebase knowledge graph (graphology + tree-sitter)
│   │   ├── monograph/              # native code-intelligence engine (SQLite-backed, 43 tools)
│   │   ├── security/               # Zod validators, path guards, safe executor
│   │   ├── shared/                 # shared config types + adapters
│   │   ├── routing/                # deterministic keyword router + outcome tracking
│   │   ├── swarm/                  # stub — swarm logic still lives in CLI command
│   │   └── performance/            # stub — perf logic still lives in CLI command
│   ├── monofence-ai/               # AI security package (formerly @monomind/aidefence)
│   │   │                           # threat detection, evasion normalization, MCP tools
│   ├── @monoes/                    # two packages republished under a second npm scope
│   │   ├── memory → @monomind/memory (dual-published)
│   │   └── monograph → @monomind/monograph (dual-published, v1.2.0)
├── .claude/
│   ├── agents/          (19 dirs · 104 .md files · 60+ agent types)
│   ├── skills/mastermind/ (93 skill files — instructional, not code)
│   ├── settings.json    (Claude Code hook registrations + permissions)
│   └── CLAUDE.md        (behavioral rules — overrides default system prompt)
├── .monomind/           (all runtime state — see §6)
├── bin/                 # cli.js entry point
├── data/                # mastermind-events.jsonl, session journals
├── docs/                # documentation (this file)
├── tests/               # 579 test files across packages
├── features/            # 36 feature specifications
└── scripts/             # build, CI, release utilities
```

**Publish targets (npm):**
- `monomind` — umbrella, installed from the repo root
- `@monoes/monomindcli` — CLI package, installed from `packages/@monomind/cli/`
- `@monoes/memory`, `@monomind/mcp`, `@monomind/hooks`, `@monomind/guidance`, `monofence-ai`, `@monomind/graph`, `@monoes/monograph@1.2.0` — all alpha
- Note: `@monomind/embeddings` has been deleted and its functionality consolidated into the monograph and routing layers.

---

## 2. Package Inventory

### 2.1 Core Packages

---

#### `@monomind/cli` · v1.14.7

**Path:** `packages/@monomind/cli/`

**What it is:** The front door and coordination hub of the entire system. Every user-facing capability passes through this package — the CLI, the web dashboard, and all MCP tool definitions live here.

**What it does in practice:**
- `npx monomind <command>` — 41 commands across 9 domains.
- Runs `dist/src/ui/server.mjs` on port 4242: a Node HTTP/SSE server serving the dashboard and ~35 REST endpoints.
- Registers 50+ MCP tools (via `src/mcp-tools/`) callable from Claude Code via `mcp__monomind__*`.
- Imports all other workspace packages and delegates logic to them.
- Manages the agent registry — scans `.claude/agents/` at startup, builds `.monomind/registry.json` with 243 entries.

**Key source files:**

| File / Directory | Size | Role |
|---|---|---|
| `src/commands/` | 41 .ts files | One file per command group |
| `src/commands/hooks.ts` | 188 KB | All hook logic + ReasoningBank + worker dispatch |
| `src/commands/browse.ts` | 87 KB | DAG workflow engine (Kahn sort, AbortSignal), CDP browser automation, session persistence, 6 built-in action handlers |
| `src/browser/dashboard/server.ts` | — | Self-contained WebSocket+SSE server for monobrowse real-time workflow step streaming |
| `src/commands/embeddings.ts` | 72 KB | Embedding service with 3 provider backends |
| `src/commands/analyze.ts` | 85 KB | Codebase analysis, diff risk classification |
| `src/commands/neural.ts` | 48 KB | Neural pattern training and prediction |
| `src/commands/memory.ts` | 61 KB | Memory search / store / list / retrieve |
| `src/commands/hive-mind.ts` | 51 KB | Byzantine fault-tolerant consensus |
| `src/mcp-tools/` | 20 .ts files | All MCP tool definitions |
| `dist/src/ui/server.mjs` | ~280 KB | Control server (REST + SSE) |
| `dist/src/ui/dashboard.html` | ~545 KB | Single-page dashboard SPA |
| `dist/src/ui/data/avatars/` | 120 .svg files | Agent avatar illustrations |

**Dependencies:** `monofence-ai`, `@monomind/guidance`, `@monomind/mcp`, `@monoes/memory`, ws, semver (3 runtime deps + 2 devDeps after audit — `@monomind/embeddings` and 10+ other unused packages removed).

**Wiring quality:** ✅ Strong — it is the hub; all packages are properly imported and used. No dead imports.

---

#### `@monomind/hooks` · v1.0.0

**Path:** `packages/@monomind/hooks/`

**What it is:** The nervous system. Instruments every Claude Code operation to record outcomes, learn patterns, and improve routing over time.

**What it does:**
- Provides 17 hooks that fire at key lifecycle points (pre/post edit, command, task, session).
- 12 background workers run via the daemon for continuous improvement.
- `ReasoningBank` stores pattern vectors in LanceDB for semantic retrieval.
- Task routing: matches a task description to the best agent type, records whether the recommendation was followed.
- Exposes hook commands over MCP (`hooks-tools.ts`).

**The 17 hooks:**

| Hook | When it fires | What it records / does |
|---|---|---|
| `pre-edit` | Before Claude modifies a file | Risk context, surrounding code |
| `post-edit` | After file modification | Edit outcome, training signal for ReasoningBank |
| `pre-command` | Before a shell command | Safety risk score |
| `post-command` | After shell command exits | Exit code, execution metrics |
| `pre-task` | Task description received | Description, agent type recommendation |
| `post-task` | Task completes | Success flag, pattern stored |
| `session-start` | Session opens | Session ID, project dir, restore prior context |
| `session-end` | Session closes | Summary, metric export, state persistence |
| `session-restore` | Prior session resumed | Reload state from `.monomind/sessions/` |
| `route` | Routing query | Returns agent type recommendation |
| `explain` | After routing | Why this agent was chosen |
| `pretrain` | Repo bootstrapping | Extract patterns from git history |
| `build-agents` | Agent config generation | Produces optimized agent configs |
| `metrics` | Dashboard display | Current learning metrics |
| `transfer` | Cross-project transfer | Export pattern library via IPFS registry |
| `intelligence` | MonoVector pipeline | `trajectory-*`, `pattern-*`, `stats`, `attention` |
| `worker` | Daemon worker control | `list`, `dispatch`, `status`, `detect` |

**The 12 background workers:**

| Worker | Priority | Job |
|---|---|---|
| `ultralearn` | normal | Deep knowledge acquisition from repo history |
| `optimize` | high | Continuous performance optimization |
| `consolidate` | low | Memory dedup and merge |
| `predict` | normal | Predictive resource preloading |
| `audit` | critical | Security analysis of recent changes |
| `map` | normal | Codebase structure mapping |
| `preload` | low | Cache warming |
| `deepdive` | normal | Deep code analysis on request |
| `document` | normal | Auto-documentation generation |
| `refactor` | normal | Refactoring suggestions |
| `benchmark` | normal | Performance benchmarking |
| `testgaps` | normal | Test coverage gap detection |

**Bin entries:** `hooks-daemon`, `statusline`, `monomind-hooks`, `guidance`

**Wiring quality:** ✅ Core path (hook fire → pattern write → LanceDB) is production-quality. The ReasoningBank vector path is functional. The full neural training loop (SONA/LoRA adapters) was moved to `monoes-full-loop` branch and is not active in V1.

---

#### `@monoes/memory` / `@monomind/memory` · v1.0.0

**Path:** `packages/@monomind/memory/`

**What it is:** The persistence and retrieval backbone. Everything that needs to survive across sessions — learned patterns, agent outcomes, decision history, vectors — goes through this package.

**What it does:**
- Manages a **hybrid LanceDB (primary) + SQLite (fallback)** store.
- Implements **HNSW** (Hierarchical Navigable Small World) pure-JavaScript vector search — 150x–12,500x faster than linear scan over embeddings.
- `ControllerRegistry`: multi-tenant namespace management (each memory namespace is isolated).
- `RvfLearningStore`: trajectory + pattern storage for the learning loop.
- `RvfMigrator`: schema migration between versions.

**Key exports:**

| Export | Role |
|---|---|
| `ControllerRegistry` | Multi-tenant namespace management |
| `HnswLite` | Pure-JS approximate nearest-neighbor index |
| `PersistentSonaCoordinator` | SONA-compatible interface (stub interface in V1) |
| `RvfBackend` | High-level CRUD over LanceDB |
| `RvfLearningStore` | Trajectory + pattern storage |
| `RvfMigrator` | Schema migration |

**Wiring quality:** ✅ Store/search/retrieve are well-wired end-to-end. `PersistentSonaCoordinator` is a stub — the SONA training path it supports is inactive in V1.

---

### 2.2 Intelligence Packages

---

#### `@monomind/embeddings` — **DELETED**

This package was removed in v1.14 as part of a dependency surface reduction. Embedding infrastructure has been consolidated into the monograph and routing layers. The `batchUpsertEmbeddings()` function in monograph now performs single-transaction bulk writes (replacing the per-row hot-loop that previously triggered `ALTER TABLE` migration on each call). Consumers were migrated in a 5-commit coordinated removal; no import traces remain.

---

#### `@monomind/routing` · (workspace)

**Path:** `packages/@monomind/routing/`

**What it is:** Decides which agent type handles a given task. The routing intelligence layer.

**What it does:**
- **Keyword Router:** Deterministic rule-based dispatch. Matches task text against a keyword lookup table. Zero latency, zero cost, no API call.
- **LLM Fallback:** When keyword confidence is low, falls back to Anthropic Claude Haiku. Requires `ANTHROPIC_API_KEY`.
- **Route-Outcome Measurement:** Records recommended agent vs actual agent used; writes to `.monomind/routing-feedback.jsonl`. Computes an accuracy metric surfaced in `npx monomind doctor`.
- **Adherence Tracking:** Recommended-vs-actual adherence rate visible in doctor output.

**Wiring quality:** ⚠️ The keyword routing path is production-quality and wired end-to-end. LLM fallback works when the API key is present. The accuracy measurement is real and meaningful. However: routing is pure keyword matching — it doesn't use the codebase graph, session history, or embeddings. The ReasoningBank stores patterns but V1 doesn't route from them.

---

#### `@monomind/graph` · v1.4.0

**Path:** `packages/@monomind/graph/`

**What it is:** Static codebase knowledge graph — understands file/module relationships across a polyglot codebase.

**What it does:**
- Parses source code via **tree-sitter** (14 language parsers: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, C#, Ruby, PHP, Kotlin, Swift, Scala, Vue).
- Builds a directed graph using **graphology** with community detection (Louvain algorithm), shortest-path traversal, centrality metrics, bridge node detection.
- Exposed to Claude via **43** `monograph_*` MCP tools (expanded from 23 in v1.11).
- N+1 SQL queries eliminated and prepared statements hoisted across 30+ analysis modules — the analysis layer is now batch-first, reducing SQLite contention during large-repo indexing.
- All 43 tools now return structured text with **file:line navigation hints** so LLMs can jump directly to symbol definitions without a follow-up query.
- Auto-rebuild wired into staleness detection with a `_buildInProgress` guard — passive freshness is a first-class concern.

**The 43 monograph MCP tools (6 categories):**

_Core Navigation:_

| Tool | What it does |
|---|---|
| `monograph_suggest` | Start every task — returns most relevant files ranked by task relevance |
| `monograph_query` | BM25 keyword search; returns file + line number |
| `monograph_god_nodes` | High-centrality internal files (external/test filtered) |
| `monograph_augment` | Graph-RAG: retrieve relevant code context for a natural-language query |
| `monograph_get_node` | Get a specific node by exact ID or name |
| `monograph_neighbors` | All directly connected nodes — outbound and inbound edges |

_Change Impact & Analysis:_

| Tool | What it does |
|---|---|
| `monograph_impact` | Upstream dependents + downstream dependencies (blast radius) |
| `monograph_api_impact` | Blast radius of an HTTP route — handler, BFS through CALLS edges, risk score |
| `monograph_context` | 360° view of a file: importers, imports, parent, community siblings |
| `monograph_detect_changes` | Map current git diff to affected graph nodes + dependents |
| `monograph_shortest_path` | How two modules are connected |
| `monograph_shape_check` | Validate API route response shapes — handler return keys vs consumer accesses |
| `monograph_route_map` | List all HTTP routes with handler info; filter by URL prefix or method |

_Graph Exploration:_

| Tool | What it does |
|---|---|
| `monograph_community` | Which files form a cohesive module cluster |
| `monograph_cypher` | Ad-hoc read-only Cypher MATCH queries against the graph |
| `monograph_surprises` | Unexpected cross-community or low-confidence edges |
| `monograph_rename` | Dry-run multi-file rename — finds all graph + text occurrences |
| `monograph_tool_map` | List MCP/RPC tool definitions with handler associations |

_Index Lifecycle:_

| Tool | What it does |
|---|---|
| `monograph_build` | Full build (or rebuild) — parses code via tree-sitter, indexes into SQLite |
| `monograph_health` | Index staleness: commits behind HEAD |
| `monograph_staleness` | Git staleness details — isStale, changed files, first diverging commit timestamp |
| `monograph_stats` | Quick sanity check — node/edge/community counts |
| `monograph_watch` | Start incremental file watcher — rebuilds on change (3s debounce) |
| `monograph_watch_stop` | Stop the file watcher |
| `monograph_doctor` | Platform diagnostics — Node version, SQLite health, node count, disk space |
| `monograph_embed` | Embed all symbol nodes (384D) — enables hybrid BM25+vector search |

_Snapshots & Export:_

| Tool | What it does |
|---|---|
| `monograph_snapshot` | Save current graph state to a named JSON snapshot |
| `monograph_diff` | Compare two named snapshots (or live graph vs snapshot) |
| `monograph_report` | Generate GRAPH_REPORT.md with top nodes |
| `monograph_export` | Export: json, svg, graphml, cypher, obsidian, canvas |
| `monograph_visualize` | Render interactive HTML graph (Sigma.js), SVG, or JSON |
| `monograph_serve` | Start web UI server for interactive graph visualization |

_Wiki & AI Docs:_

| Tool | What it does |
|---|---|
| `monograph_wiki` | Retrieve LLM-generated wiki pages for code communities |
| `monograph_wiki_build` | Generate wiki pages for communities using Anthropic API |
| `monograph_skill_gen` | Generate per-community skill files for AI navigation |
| `monograph_inject_context` | Inject monograph capabilities into AGENTS.md / CLAUDE.md |
| `monograph_install_skills` | Install skill files for IDE/platform (claude, cursor, vscode, zed) |

_Multi-Repo / Group:_

| Tool | What it does |
|---|---|
| `monograph_list_repos` | List all repos tracked in the global monograph registry |
| `monograph_group_list` | List repos in a group.yaml with index metadata |
| `monograph_group_query` | BM25 search merged across all repos in a group (RRF-ranked) |
| `monograph_group_contracts` | List public API contracts (exported symbols/interfaces/types) for a group |
| `monograph_group_status` | Health status for all groups: indexed, has contracts, recently synced |
| `monograph_group_sync` | Scan and rebuild all repos in a group |

**Wiring quality:** ✅ Graph building and query paths are properly wired. The `monograph.db` is maintained by `monograph build` and queried by all 43 tools. Used actively by CLAUDE.md–directed codebase exploration. Published as standalone `@monoes/monograph@1.2.0`; the 1300-line compat shim has been deleted.

---

#### `@monomind/monograph` / `@monoes/monograph` · v1.2.0

**Path:** `packages/@monomind/monograph/`

**What it is:** The canonical standalone native TypeScript graph engine with deeper AST analysis, optional Anthropic-assisted semantic annotation, and a full 43-tool MCP surface.

**What changed in v1.2:** Published as an independent package (`@monoes/monograph@1.2.0`). The 1300-line backward-compat shim was deleted. The CLI now imports the real package directly. Security hardening applied across the MCP tool layer and HTTP UI server FTS endpoints — path traversal and SQL/embedding DoS vectors are capped.

**Relationship to `@monomind/graph`:** These two packages are architecturally redundant. Monograph is the canonical future. `@monomind/graph` is legacy. Both are still present but monograph is the active development target and the tool surface agents use.

**Wiring quality:** ✅ Functional and independently versioned. The extraction cache TODO from earlier versions has been resolved via the N+1 elimination and batch-query refactor.

---

### 2.3 Infrastructure Packages

---

#### `@monomind/mcp` · v1.0.0

**Path:** `packages/@monomind/mcp/`

**What it is:** The MCP wire protocol implementation — the bridge between Claude Code and all monomind capabilities.

**What it does:**
- Implements MCP over three transports: **stdio** (default, required by Claude Code), **HTTP** (remote access), **WebSocket** (streaming).
- Connection pooling for multiple simultaneous MCP clients.
- Central `ToolRegistry` — all `mcp-tools/*.ts` files register here.
- **Security hardening on every JSON-RPC message:** recursive stripping of `__proto__`, `constructor`, `prototype` fields (prototype pollution prevention); Zod schema validation; Helmet headers on HTTP transport; per-connection rate limiting.

**Wiring quality:** ✅ Correctly wired. MCP server starts cleanly, tools register correctly, Claude Code connects via stdio. HTTP/WebSocket transports work but are rarely used in practice.

---

#### `monofence-ai` · v1.0.0

**Path:** `packages/monofence-ai/` (formerly `packages/@monomind/aidefence/`)

**What it is:** AI manipulation defense library for LLM applications — detects and blocks prompt injection attempts, jailbreaks, role switching, context manipulation, encoding attacks, and PII exposure before they reach agent decision-making.

**Rebranding:** Package was renamed from `@monomind/monodefence` (which was itself a rename from `@monomind/aidefence`) to `monofence-ai`. Git history was preserved via `git mv`. Backward-compatible deprecated aliases are exported with JSDoc. The old import path is removed from the hooks executor. A migration table is in `docs/index.html`.

**What it does:**
- `ThreatDetectionService`: Pattern-matches inputs against 50+ known injection signatures with sub-millisecond latency (~0.04ms per call, >12,000 req/s). Vector-similarity search against a threat library (when LanceDB is available).
- `ThreatLearningService`: Learns new threat patterns from observed attacks; updates the threat library over time.
- `EvasionDetector`: Normalizes obfuscated inputs before pattern matching — defeats homoglyph substitution, spaced characters, leet-speak, and base64 encoding. Hard ordering is enforced: space-collapse runs before leet expansion so `'i g n 0 r e'` → `'ign0re'` → `'ignore'`.
- `ContextTracker`: Sliding-window escalation state machine (clean → probing → escalating → attack) with 30-minute idle decay + 0.5× score halving. Prevents both persistent high-alert lock-in and unbounded cumulative score growth.
- `OutputScanner`: Scans LLM output for PII leakage, echo attacks, policy violations, and prompt contradictions.
- `Allowlist`: 5 built-in bypass rules plus user-defined runtime rules with TTL decay to reduce false positives.
- `SecurityHook`: Optional pre-task/pre-command scanner (priority 1000) that aborts execution when escalation state reaches attack.
- `calculateSecurityConsensus`: Aggregates threat assessments from multiple parallel agents using attention-based weighting; fail-secure on any single critical threat.
- **4 MCP tools** exposed for real-time threat checking from Claude Code.
- MCP handler DoS hardening: 64 KB input cap, k=100 retrieval limit.
- Integrated into `pre-task` and `pre-command` hooks via CLI flag `--monofence-ai-check`.

**Deprecated aliases (until v2):** `createAIDefence` → `createMonoDefence`, `getAIDefence` → `getMonoDefence`, `AIDefenceConfig` → `MonoDefenceConfig`, `AIDefence` → `MonoDefence`.

**Wiring quality:** ⚠️ Detection path works. Learning requires LanceDB as an optional peer dep — silently degrades when absent. The threat library starts sparse and becomes effective with real-world exposure.

---

#### `@monomind/guidance` · v1.0.0

**Path:** `packages/@monomind/guidance/`

**What it is:** Governance control plane — compiles, enforces, and evolves the rules governing how Claude Code behaves on a project.

**28 named exports:**

| Export | What it does |
|---|---|
| `compiler` | Compiles `.claude/` guidance files into a validated rule set |
| `retriever` | Semantic search over compiled guidance |
| `gates` | Pre-edit/pre-command/pre-task checks that block rule violations |
| `coherence` | Detects contradictory rules before they cause confusion |
| `evolution` | Suggests rule updates based on outcomes |
| `trust` / `authority` | Hierarchical trust chains — resolves conflicts between guidance sources |
| `proof` | Generates proof chains justifying actions taken / blocked |
| `conformance-kit` | Audit tooling to verify adherence across sessions |
| `temporal` | Time-aware rule application |
| `adversarial` | Adversarial rule testing |
| `wasm-kernel` | **Stub** — not implemented |
| `meta-governance` | **Stub** — not implemented |
| (15 more) | Various governance sub-modules |

**Wiring quality:** ⚠️ The compiler + gate path is real and regularly exercised. The deeper modules (`wasm-kernel`, `meta-governance`) are stubs. In practice, governance rules come from `.claude/CLAUDE.md` and `.claude/settings.json` rather than the compiled guidance system.

---

#### `@monomind/security` · (workspace)

**Path:** `packages/@monomind/security/`

**What it is:** Input validation and safe execution — prevents the most common attack classes at system boundaries.

**Three components:**

| Export | What it does |
|---|---|
| `InputValidator` | Zod-based validation for all user inputs — CLI args, MCP params, API inputs |
| `PathValidator` | Prevents path traversal (`../`, absolute paths outside allowed roots) — used in every file-reading endpoint |
| `SafeExecutor` | Wraps shell command execution: blocks injection chars, enforces allowlists, captures output safely |

**Wiring quality:** ✅ The most consistently applied package. PathValidator and InputValidator are used in every `server.mjs` endpoint and every CLI command that reads files or executes commands.

---

### 2.4 Auxiliary / Stub Packages

---

#### `@monomind/shared`

**Path:** `packages/@monomind/shared/`

**Exports:**
- `loadConfig`: reads and validates `monomind.config.json`.
- `systemConfigToMonomindConfig`: adapts platform config to the internal schema.

**Wiring quality:** ⚠️ Thin — only two real exports. More complex cross-package type sharing happens through inline TypeScript imports. Exists for future expansion.

---

#### `@monomind/swarm` — **Stub**

**Path:** `packages/@monomind/swarm/`

All meaningful swarm logic lives in `packages/@monomind/cli/src/commands/swarm.ts` (31 KB). This package is an extraction target for a future clean separation.

**Wiring quality:** 🔴 Stub.

---

#### `@monomind/performance` — **Stub**

**Path:** `packages/@monomind/performance/`

All performance profiling logic lives in `packages/@monomind/cli/src/commands/performance.ts` (26 KB).

**Wiring quality:** 🔴 Stub.

---

## 3. CLI — Commands, MCP Tools & UI Server

### 3.1 All 41 Commands

#### Agent Orchestration

| Command | Source size | What it does |
|---|---|---|
| `agent` | 34 KB | Spawn, list, status, stop, metrics, pool management, health monitoring, log streaming |
| `swarm` | 31 KB | Swarm init with 6 topologies (hierarchical, mesh, ring, pipeline, adaptive, hybrid); coordination; consensus |
| `task` | 23 KB | Task CRUD, assignment to agents, lifecycle management (todo → doing → done) |
| `hive-mind` | 51 KB | Byzantine fault-tolerant consensus: queen + workers, 4 topologies, 5 consensus strategies |
| `autopilot` | 16 KB | Auto-run mode: continuous task execution without human prompting |

#### Memory & Intelligence

| Command | Source size | What it does |
|---|---|---|
| `memory` | 61 KB | Semantic search (HNSW), store, list, retrieve, init, export, prune across namespaces |
| `neural` | 48 KB | Pattern training, prediction, status, optimize, list learned patterns |
| `embeddings` | 72 KB | Embed text, batch embedding, semantic search, initialize persistent cache |
| `route` | 37 KB | Route a task description to optimal agent; explain decisions; measure accuracy |

#### Hooks & Learning

| Command | Source size | What it does |
|---|---|---|
| `hooks` | 188 KB | All 17 hooks + 12 background workers + ReasoningBank + trajectory tracking |
| `daemon` | 29 KB | Background daemon lifecycle: start, stop, status, trigger workers, enable/disable |

#### Project Setup & Configuration

| Command | Source size | What it does |
|---|---|---|
| `init` | 41 KB | Project wizard: config generation, skills setup, hook registration, agent registry build |
| `config` | 16 KB | Read, write, validate `monomind.config.json` |
| `guidance` | 27 KB | Governance rules: add, list, validate, evolve, enforce |
| `providers` | 18 KB | AI provider setup: Anthropic, OpenAI, Google, custom endpoints |


#### Code Understanding

| Command | Source size | What it does |
|---|---|---|
| `analyze` | 85 KB | Deep codebase analysis: LOC, complexity, risk scoring, diff classification into 6 categories |
| `monograph` | 25 KB | Codebase graph queries: impact, neighbors, community, shortest-path, god-nodes |

#### Security & Quality

| Command | Source size | What it does |
|---|---|---|
| `security` | 45 KB | Scan, audit, CVE lookup, threat detection, validation, report generation |
| `performance` | 26 KB | Benchmark, profile, metrics, optimization recommendations, reports |
| `benchmark` | 26 KB | Comprehensive benchmark suite across all subsystems |
| `doctor` | 29 KB | 21 parallel health checks (expanded from ~14): Node version, config validity, daemon status, memory DB, API keys, disk space, graph freshness (FRESH/stale/commits-behind), gitignore coverage for 10 runtime path patterns, helper file drift, inline fix hints on every warn/fail |

#### Session Management

| Command | Source size | What it does |
|---|---|---|
| `session` | 28 KB | Session state: start, end, list (352 sessions), restore latest, export, metrics |
| `mcp` | 25 KB | MCP server: start (stdio/http/ws), stop, status, list-tools, execute-tool directly |

#### Advanced & Specialized

| Command | Source size | What it does |
|---|---|---|
| `browse` | 87 KB | DAG workflow engine (Kahn topological sort, per-node timeouts, AbortSignal cancellation, skip/fail error policies); CDP browser automation; 6 built-in action handlers (HTTP, file I/O, Gmail, Google Sheets, Google Drive, Microsoft Graph/Outlook/Teams/OneDrive, Gemini image generation); session persistence; real-time WebSocket/SSE dashboard |
| `deployment` | 27 KB | Deployment pipeline: deploy, rollback, status, environment management, release |
| `workflow` | 24 KB | Workflow templates: create, list, run, export |
| `migrate` | 30 KB | V2→V1 migration with backup and rollback |
| `claims` | 24 KB | Claims-based authorization: check, grant, revoke, list |

#### Utilities

| Command | What it does |
|---|---|
| `status` | Real-time system status with watch mode; statusline now surfaces token spend (today/month with color thresholds), graph freshness indicator, and active org run names |
| `completions` | Shell completions: bash, zsh, fish, powershell |
| `update` | Check for package updates; version tagline displays update availability inline (↑ v1.x.y available / ✓ up to date) on every invocation |
| `cleanup` | Remove stale state files, prune old sessions |
| `replay` | Replay a command from session history (debugging) |
| `platforms` | Detect and display platform-specific capabilities |
| `start` | Quick-start helpers for common setup flows |
| `tokens` | Token counting for prompts and files |
| `transfer-store` | IPFS-based pattern transfer between projects |
| `issues` | GitHub issue tracking integration |
| `progress` | Check V1 implementation progress |
| `process` | Process management utilities |

---

### 3.2 All MCP Tools (50+)

All callable from Claude Code as `mcp__monomind__<tool_name>`. Every tool handler namespace (17+ covering hooks, monograph, memory, config, tasks, hive-mind, neural, github, daa, embeddings, workflow, guidance, a2a, transfer) received input length caps and prototype-pollution guards in a coordinated hardening sweep.

#### Memory Tools (`memory-tools.ts`)
`memory_store` · `memory_search` · `memory_retrieve` · `memory_list`

#### Task Tools (`task-tools.ts`)
`task_create` · `task_update` · `task_get` · `task_list` · `task_output` · `task_stop`

#### Coordination Tools (`coordination-tools.ts`)
`swarm_init` · `agent_spawn` · `task_orchestrate` · `swarm_status` · `memory_usage` · `coordination_sync` · `load_balance` · `bottleneck_analyze` · `performance_report`

#### Hooks Tools (`hooks-tools.ts`)
`hooks_route` · `hooks_pre_task` · `hooks_post_task` · `hooks_intelligence`

#### LanceDB Tools (`lancedb-tools.ts`)
`lancedb_health` · `lancedb_controllers` · `pattern_store` · `pattern_search` · `feedback` · `causal_edge`

#### Analysis Tools (`analyze-tools.ts`)
`analyze_diff` · `diff_risk` · `diff_classify` · `diff_reviewers` · `file_risk` · `diff_stats`

#### Neural Tools (`neural-tools.ts`)
`neural_train` · `neural_predict` · `neural_status` · `neural_patterns`

#### Guidance Tools (`guidance-tools.ts`)
`guidance_check` · `guidance_enforce` · `guidance_evolve`

#### Security Tools (`security-tools.ts`)
`security_scan` · `security_audit` · `security_validate`

#### Workflow Tools (`workflow-tools.ts`)
`workflow_create` · `workflow_execute` · `workflow_export`

#### Embeddings Tools (`embeddings-tools.ts`)
`embeddings_embed` · `embeddings_search` · `embeddings_batch`

#### Claims Tools (`claims-tools.ts`)
`claims_check` · `claims_grant` · `claims_revoke` · `claims_list`

#### System Tools (`system-tools.ts`)
`system_info` · `system_health`

#### Config Tools (`config-tools.ts`)
`config_get` · `config_set` · `config_validate`

#### Autopilot Tools (`autopilot-tools.ts`)
`autopilot_start` · `autopilot_stop` · `autopilot_status`

#### Progress Tools (`progress-tools.ts`)
`progress_report` · `progress_check`

#### Transfer Tools (`transfer-tools.ts`)
`transfer_store` · `transfer_load`

#### DAA Tools (`daa-tools.ts`)
Distributed AI Architecture orchestration tools.

#### Monograph Tools (43 total across 6 categories — see §2.2 graph section for the full list)
_Core:_ `monograph_suggest` · `monograph_query` · `monograph_god_nodes` · `monograph_augment` · `monograph_get_node` · `monograph_neighbors`
_Impact:_ `monograph_impact` · `monograph_api_impact` · `monograph_context` · `monograph_detect_changes` · `monograph_shortest_path` · `monograph_shape_check` · `monograph_route_map`
_Exploration:_ `monograph_community` · `monograph_cypher` · `monograph_surprises` · `monograph_rename` · `monograph_tool_map`
_Index:_ `monograph_build` · `monograph_health` · `monograph_staleness` · `monograph_stats` · `monograph_watch` · `monograph_watch_stop` · `monograph_doctor` · `monograph_embed`
_Snapshots:_ `monograph_snapshot` · `monograph_diff` · `monograph_report` · `monograph_export` · `monograph_visualize` · `monograph_serve`
_Wiki:_ `monograph_wiki` · `monograph_wiki_build` · `monograph_skill_gen` · `monograph_inject_context` · `monograph_install_skills`
_Multi-repo:_ `monograph_list_repos` · `monograph_group_list` · `monograph_group_query` · `monograph_group_contracts` · `monograph_group_status` · `monograph_group_sync`

---

### 3.3 Dashboard UI & Control Server

#### `dist/src/ui/server.mjs` (~280 KB) — all REST endpoints

**Security posture:** Binds to `127.0.0.1` only. No CORS wildcards. Three previously identified critical vulnerabilities (path traversal, arbitrary file read, unbounded POST body) were patched before public release. All POST handlers cap body size at 2 MiB. `orgName` is regex-validated on every endpoint. `activeOrgRuns` in-memory Map is rebuilt from disk on startup so run-state survives server restarts. Org running detection checks both disk state files and in-memory `activeOrgRuns` (eliminates false-negative IDLE status).

All endpoints honour the `?dir=` query parameter for multi-project isolation. The SSE stream filters by project, preventing event cross-contamination across concurrent projects.

| Endpoint | What it returns |
|---|---|
| `GET /` | `dashboard.html` (re-read from disk on every request — edits are live without restart) |
| `GET /data/avatars/*.svg` | Agent avatar images (path-traversal-guarded) |
| `GET /api/orgs` | All org definitions with running status per project dir |
| `GET /api/org/:name` | Rich org bundle: config + state + goals + task columns + routines |
| `GET /api/org/:name/activity` | Org-scoped event timeline (synthesized from org records; strict org filter) |
| `GET /api/org/:name/health` | Aggregate health: running agents, open issues, task queue |
| `GET /api/org/:name/agent/:roleId` | Full agent spec: org role + `.claude/agents` definition (skills, I/O, instructions) |
| `GET /api/org/:name/budgets` | Per-agent token count + total_cost_usd rollup |
| `GET /api/org/:name/approvals` | Pending agent action approvals (with approve/reject POST) |
| `GET /api/org/:name/skills` | Skill matrix mapped to org roles |
| `POST /api/mastermind/event` | Ingest events from CLI (sessions, loops, org:create, agent:spawn) |
| `GET /api/events-stream` | Server-Sent Events — pushes live updates to the dashboard; bounded 2000-entry dedup cap |
| `GET /api/session-journal` | Session list for a given project dir |
| `GET /api/session` | Full session transcript (JSONL → structured) |
| `GET /api/loops` | All active loop configs from `.monomind/loops/*.json` |
| `GET /api/memory/stats` | Memory backend stats |
| `GET /api/data` | Full project snapshot (sessions + memory + loops + orgs) |
| `GET /api/routing-feedback` | Route outcome data for accuracy display |
| `GET /api/adrs` | Architecture Decision Record list |
| `GET /api/token-usage` | Token usage by model and period |
| `GET /api/git-user` | Git user.name + user.email for the project |
| `DELETE /api/org/:name` | Delete an org end-to-end (dashboard button + CLI command wired together) |

#### `dist/src/ui/dashboard.html` (~545 KB) — Single-page SPA

Uses **hash routing** (`#/sessions`, `#/orgs/:name`, etc.) so deep links survive page refresh. SSE deduplication across four independent consumers (chat view, odt-chat, activity tab, global SSE stream) with a bounded 2000-entry cap prevents duplicate event rendering on reconnect.

**Views available:**
- **Sessions** — all past Claude Code sessions; timeline of tool calls; token/cost leaderboard; model mix; heatmap
- **Loops** — all active `--repeat` / `--tillend` loops; status, progress, HIL queue
- **Tokens** — token usage by model and project; cost trends; 30-day cost trend chart; per-project cost breakdown; model cost donut
- **Memory** — memory namespaces; stored patterns; routing decisions; ADRs; swarm state; knowledge chunks
- **Orgs** — org list + detail with **8 tabs** (Chart, Activity, Health, Approvals, Budgets, Charts, Skills, **Chat**)
- **Monograph** — knowledge graph: overview, graph viewer, analyze, query, export, report, wiki

**Real-time cost visibility:** topbar cost badge, live cost ticker updated per SSE event. Three previously missing Claude model variants (`opus-4-8`, `haiku-4`, `opus-4-5`) added to price tables. Daily/monthly aggregation now reads from JSONL source of truth rather than stale cache.

**Orgs detail — 8 tabs:**

| Tab | What it shows |
|---|---|
| **Chart** | SVG org chart with animated communication edges (command=amber, report=blue, handoff=green); agent avatars per node; click-to-open detail drawer |
| **Activity** | Per-org event timeline: org creation, role definitions, goal milestones, approvals, agent heartbeats |
| **Health** | Agent count (running/idle), open issues, task queue depth, error rate |
| **Approvals** | Pending agent action approvals (under board/strict governance); approve/reject buttons |
| **Budgets** | Per-agent token in/out + cost in USD; total; period (token/cost tracking per org run) |
| **Charts** | 14-day activity heatmap (event bars, error highlighting); per-agent run count bars |
| **Skills** | Each role's expertise chips + task-type chips (enriched from `.claude/agents` definitions) |
| **Chat** | Real-time `org:comms` agent-to-agent messages via SSE; continuation runs reuse the same sessionId so all reps group under one session |

**Agent detail drawer** (click any chart node or role card):
- Header: name + agent-type pill + model pill + illustrated avatar (120 agent SVGs)
- Characteristics grid: Goal · Reports to · Model · Max tokens · **Input** · **Output** · Done when · Version
- Skills & expertise chips (from agent definition `expertise[]`)
- Task types chips
- Responsibilities list
- Rendered instruction document (XSS-safe markdown renderer, no external dependency)

#### MonoBrowse Dashboard (`src/browser/dashboard/server.ts`)

A self-contained WebSocket+SSE server (separate from the main control server) that ships alongside the `monomind browse` DAG workflow engine. Provides real-time workflow step streaming with XSS-safe rendering, 127.0.0.1-only binding, and a live Stop button wired to the engine's `AbortController`. The `ws` module is loaded with graceful fallback — no external dependencies required.

---

## 4. Agent & Skill System

### 4.1 Agent Definitions (`.claude/agents/`)

**104 markdown files, 19 category directories, 60+ agent types.**

**Definition format** (YAML frontmatter + instruction body):

```markdown
---
name: <slug>                     # matched by agent_type in org config
description: <one-line summary>
capability:
  role: <slug>
  goal: <standing objective>
  expertise: [...]               # → Skills tab, skill chips in drawer
  task_types: [...]              # → Task types chips in drawer
  input_type: <string>           # → Input row in drawer
  output_type: <string>          # → Output row in drawer
  model_preference: sonnet
  termination: <done condition>
---

# Role Name

You are...   (full instruction document rendered in drawer)
```

**Categories and contents:**

| Directory | Key agents |
|---|---|
| `core/` | coder, reviewer, tester, planner, researcher, coordinator, judge, prosecutor, defender, case-analyst, court-reporter |
| `engineering/` | backend-dev, frontend-developer, mobile-dev, devops-automator, sre, embedded-firmware, ios-developer, cicd-engineer |
| `specialized/` | ai-engineer, blockchain-auditor, solidity-engineer, mcp-builder, feishu-developer, model-qa |
| `architecture/` | software-architect, system-architect, backend-architect, database-optimizer, cloud-architect |
| `design/` | monodesign, accessibility-auditor, cultural-intelligence-strategist |
| `consensus/` | byzantine-coordinator, raft-manager, gossip-coordinator, crdt-synchronizer, quorum-manager |
| `hive-mind/` | queen-coordinator, worker-specialist, mesh-coordinator, load-balancing-coordinator, resource-allocator |
| `github/` | pr-manager, code-review-swarm, issue-tracker, release-manager, repo-architect, sync-coordinator |
| `optimization/` | performance-benchmarker, performance-monitor, autonomous-optimization-architect |
| `sparc/` | specification, pseudocode, architecture, refinement, sparc-coder |
| `swarm/` | hierarchical-coordinator, mesh-coordinator, adaptive-coordinator |
| `testing/` | tdd-london-swarm, api-tester, evidence-collector, test-results-analyzer |
| `goal/` | goal-planner |
| `marketing/` | cro-specialist, email-marketing, competitive-content, launch-strategist, pricing-strategist |
| `specialists/` | incident-commander, threat-detection-engineer, compliance-auditor, data-engineer, technical-writer |
| `generated/` | Auto-generated by `createorg`: judge, prosecutor, defender, case-analyst, court-reporter, editor-in-chief, reporter, fact-checker, copy-editor |
| `schemas/` | JSON schemas for agent frontmatter validation |
| `templates/` | coordinator-swarm-init template |

**Agent resolution at runtime:** `/api/org/:name/agent/:roleId` scans `.claude/agents/**/*.md`, matches by frontmatter `name` first, then by filename slug. Off-domain mismatches (e.g. `reviewer.md` = code review applied to a court reporter) are treated as missing and trigger generation.

---

### 4.2 Mastermind Skills (93 files)

Skills are **instructional markdown documents**, not code. Claude loads them via the `Skill` tool and follows their instructions to execute multi-step workflows. They are the primary mechanism for structured, repeatable work.

**Base protocol files (invoked by all other skills):**

| Skill | Role |
|---|---|
| `_protocol.md` | Swarm rules, brain load/write procedure, dispatch protocol, domain taxonomy |
| `_intake.md` | Vague-prompt handler — asks up to 3 clarifying questions before proceeding |
| `_repeat.md` | `--repeat N / --tillend` looping framework with HIL (human-in-loop) support |
| `_agent-select.md` | How to choose agent types from the registry |
| `_delegation.md` | Multi-agent delegation patterns |

**Org management skills:**

| Skill | What it orchestrates |
|---|---|
| `createorg.md` | Design an org: coin agent types, generate `.claude/agents/generated/` specs, wire communication topology, save JSON, emit `org:create` event; bakes `org:comms` into all new org loop prompts |
| `runorg.md` | Start an org: spawn agents, assign tasks from board, run the coordination loop; handles continuation runs (session reuse across reps), emits org-tagged events |
| `org-settings.md` | Modify topology, governance, budget |
| `approve.md` / `approval-detail.md` | Approve/reject pending agent actions |
| `heartbeat.md` | Monitor agent liveness and status |
| `agents.md` / `agent-detail.md` | Browse and inspect org agents |

**Autonomous Improver / Auto-loop:** The `createorg --schedule` flag combined with `runorg` enables a self-improving org that runs continuously. 50+ autonomous reps have been validated: the org self-logs to `foundation.md` across reps and produces measurable codebase improvements. Org lifecycle commands (`createorg --schedule`, `runorg`, `stoporg`, `orgstatus`, `orgs`) are fully operational with loop state files, rep counters, and staleness guards.

**Development skills (the heaviest):**

| Skill | Size | What it orchestrates |
|---|---|---|
| `architect.md` | 55 KB | Full system design: requirements → constraints → ADR → component spec |
| `idea.md` | 55 KB | Idea → feasibility → spec → plan pipeline |
| `monitor.md` | 45 KB | Production monitoring: anomaly detection, alerting, incident escalation |
| `techport.md` | 34 KB | Technical portfolio mapping: capability audit, gap analysis |
| `autodev.md` | 24 KB | Autonomous dev loop: plan → implement → test → review cycle |
| `taskdev.md` | 12 KB | Task-driven development: implement one task, verify, close |
| `tdd.md` | 9 KB | TDD London School: write failing test → implement → pass |
| `plan.md` | — | Task decomposition and sprint planning |
| `verify.md` | — | Post-implementation verification and sign-off |
| `review.md` | — | Code review with heuristic scoring |
| `build.md` | — | Build, lint, test runner |

**Research & content:**

| Skill | What it orchestrates |
|---|---|
| `research.md` | Multi-source research → adversarial verify → cited report |
| `content.md` | Content creation: brief → draft → review → publish |
| `sales.md` | Sales content and outreach pipeline |
| `marketing.md` | Campaign design and execution |

**Data & ops:**

| Skill | What it orchestrates |
|---|---|
| `finance.md` | Budget analysis, cost breakdown, forecasting |
| `memory.md` | Memory management: search, consolidate, prune |
| `diagnose.md` | System diagnosis: collect signals, root-cause, recommend |
| `backup.md` | State backup and restore |
| `export.md` | Data export to external formats |
| `release.md` | Release pipeline: tag → changelog → publish |

**Project management (full suite):**

`plan.md` · `goals.md` · `goal-detail.md` · `projects.md` · `project-detail.md` · `issues.md` · `issue-detail.md` · `tasks.md` · `routines.md` · `routine-detail.md` · `workspace-detail.md` · `workspaces.md` · `worktree.md`

**Plugin/adapter management:**

`plugins.md` · `plugin-manager.md` · `plugin-settings.md` · `adapters.md` · `adapter-manager.md`

---

## 5. Integration Wiring

### 5.1 Package Dependency Graph

```
                     ┌────────────────────────────────────┐
                     │           @monomind/cli             │
                     │     (hub — all packages import here) │
                     └───┬────┬───────┬──────────┬─────────┘
                         │    │       │          │
              ┌──────────┘    │       │          └────────────┐
              ▼               ▼       ▼                       ▼
        monofence-ai    @monoes/   @monomind/          @monoes/memory
        (AI security)  monograph   guidance            (HNSW + LanceDB)
                       (43 tools)      │                    ▲
                                  @monomind/hooks ──────────┘
                                  (events + learning)
                                       │
                                  @monomind/mcp
                                  (tool registry)

Note: @monomind/embeddings has been removed. Embedding infrastructure
      is now consolidated in @monoes/monograph (batch upsert) and
      @monomind/routing (LLM fallback via @anthropic-ai/sdk).
```

### 5.2 Task → Route → Agent → Result → Learn Data Flow

```
User prompt
    │
    ▼
pre-task hook
    ├──► keyword router ──────────────────────────────► agent type recommendation
    │         │                                              │
    │    (low confidence) ──► Anthropic Haiku fallback       │
    │                                                        │
    ▼                                                        ▼
Claude executes task with recommended agent type
    │
    ├──► post-edit hook ──► ReasoningBank (LanceDB + HNSW) ── pattern stored
    │
    ▼
post-task hook
    ├──► outcome recorded in routing-feedback.jsonl
    ├──► accuracy metric computed (recommended vs actual)
    └──► visible in `npx monomind doctor` and dashboard
```

### 5.3 MCP Tool Invocation Path

```
Claude Code ──[stdio]──► @monomind/mcp server
                               │
                     ToolRegistry.dispatch(name, params)
                     (prototype-pollution check → Zod validate)
                               │
             ┌─────────────────┼─────────────────┐
             ▼                 ▼                  ▼
       memory_search      swarm_init        monograph_query
             │                 │                  │
       @monoes/memory    swarm.ts command    monograph.db (SQLite)
```

### 5.4 Agent Definition Resolution (Drawer)

```
Click chart node (roleId = "defender")
    │
    ▼
v2OpenAgent("defender")
    │
    ▼
GET /api/org/court-sim/agent/defender?dir=<project>
    ├── load court-sim.json → find role where id="defender"
    ├── resolve agent_type = "defender"
    ├── scan .claude/agents/**/*.md:
    │     1. Match frontmatter `name: defender` → found
    │     2. (fallback) match filename defender.md
    │     3. Domain check: is this def appropriate for this role?
    └── return { role: {...}, definition: { capability, document, file } }
    │
    ▼
Drawer renders: avatar · name · type pill · model pill
    Characteristics: goal · reports_to · model · max_tokens · input · output · done_when
    Skills & expertise: expertise[] chips (blue)
    Task types: task_types[] chips (green)
    Responsibilities: role.responsibilities[]
    Instructions: parsed markdown body (XSS-safe renderer)
```

### 5.5 Org Activity Scoping

```
GET /api/org/:name/activity
    │
    ├── (1) global mastermind-events.jsonl
    │         └── STRICT filter: e.org === orgName only (no !e.org leak)
    │
    └── (2) synthesized per-org timeline from org's own files:
              .monomind/orgs/:name.json         → org:create + role:defined events
              .monomind/orgs/:name-goals.json   → goal events
              .monomind/orgs/:name-approvals.json → approval events
              .monomind/orgs/:name-state.json   → heartbeat events (per agent)
              │
              └── sort by ts desc · slice(0, 100) · return
```

### 5.6 Claude Code Hooks Wiring

Hooks are shell commands registered in `.claude/settings.json` that fire on Claude Code lifecycle events:

```json
{
  "hooks": {
    "PreToolUse":  [{ "matcher": "Edit",  "hooks": [{ "type": "command", "command": "npx monomind hooks pre-edit ..." }] }],
    "PostToolUse": [{ "matcher": "Edit",  "hooks": [{ "type": "command", "command": "npx monomind hooks post-edit ..." }] }],
    "PreToolUse":  [{ "matcher": "Bash",  "hooks": [{ "type": "command", "command": "npx monomind hooks pre-command ..." }] }],
    "PostToolUse": [{ "matcher": "Bash",  "hooks": [{ "type": "command", "command": "npx monomind hooks post-command ..." }] }],
    "PreToolUse":  [{ "matcher": "Task",  "hooks": [{ "type": "command", "command": "npx monomind hooks pre-task ..." }] }],
    "PostToolUse": [{ "matcher": "Task",  "hooks": [{ "type": "command", "command": "npx monomind hooks post-task ..." }] }]
  }
}
```

These hooks are the nervous system: every edit and command feeds outcomes into the learning loop without any manual user action.

### 5.7 MonoBrowse DAG Workflow Engine

```
monomind browse workflow run <file.json>
    │
    ▼
WorkflowEngine.run(dag, items)
    ├── Kahn topological sort → execution order
    ├── Per-node timeout (AbortSignal cancellation)
    ├── Error policy: skip | fail | continue
    │
    ├── Built-in action handlers (6):
    │     action.http          → fetch with template substitution
    │     action.file          → read/write local files
    │     action.gmail         → Gmail send/read
    │     action.google_sheets → Sheets read/write
    │     action.google_drive  → Drive upload/download
    │     action.microsoft_*   → Graph/Outlook/Teams/OneDrive
    │     action.gemini_image  → Browser CDP → REST API → mock (3-tier fallback)
    │
    ├── Template expression engine
    │     $json, $env, $node.<id>.output, $now, params
    │
    ├── Session persistence
    │     ~/.monomind/sessions.json (chmod 0o600)
    │     Platform connections (LinkedIn, X, Instagram, Gemini) survive restarts
    │
    └── Real-time dashboard (browser/dashboard/server.ts)
          WebSocket + SSE dual transport
          XSS-safe rendering
          127.0.0.1 binding
          Stop button → AbortController.abort()
```

### 5.8 `createorg` → Full Agent Spec Generation Flow

```
/mastermind:createorg "run a court simulation"
    │
    ▼
Step 2: Parse roles from prompt → [judge, prosecutor, defender, clerk, court-reporter]
    │
    ▼
Step 2.5: For each role:
    ├── Check .claude/agents/**/*.md for a usable definition
    │     (domain-fit check: reviewer.md = code review ≠ court reporter → "not usable")
    ├── No usable def found → GENERATE .claude/agents/generated/<type>.md
    │     - goal, expertise (5 items), task_types (4 items), input_type, output_type
    │     - instruction body: Core Responsibilities, Operating Guidelines,
    │                          Communication (input/output/protocol), Quality Bar
    └── Populate org role skills[] from generated expertise[]
    │
    ▼
Step 3: Build communication edges (completeness rules: no orphan roles)
    ├── Every role gets ≥1 inbound (command/handoff) + ≥1 outbound (report/handoff)
    └── Derive each role's input_type/output_type from its edges
    │
    ▼
Step 6: Save .monomind/orgs/court-sim.json (valid JSON, jq-encoded)
    │
    ▼
Step 7: Emit org:create event to dashboard → Orgs list refreshes
    │
    ▼
Result: Every role has skills, instructions, input, output, communication — from first shot
```

---

## 6. Runtime State

Everything that persists across sessions lives in `.monomind/`:

```
.monomind/
│
├── registry.json              # 243 agent definitions (rebuilt at startup from .claude/agents/)
├── control.json               # daemon PID, port 4242, process start time
├── budget.json                # cumulative cost tracking across all sessions
├── last-dispatch.json         # most recent task dispatch metadata
├── last-route.json            # most recent routing decision + confidence score
├── routing-feedback.jsonl     # route outcome log: recommended agent vs actual, success
├── last-update-check.json     # when monomind last checked npm for updates
├── monograph.db               # codebase knowledge graph SQLite (~400 MB)
├── monograph.db-shm / .wal    # WAL files for concurrent graph reads/writes
│
├── agents/
│   └── registrations/         # per-agent-instance JSON (100+ files in active session)
│                              # format: {agentId, startedAt, pid}
│
├── brain/
│   └── ops/                   # domain-scoped reasoning state (used by brain load/write)
│
├── knowledge/
│   ├── chunks.jsonl           # indexed knowledge chunks (project-specific facts)
│   └── .index-hash            # incremental index checksum (avoid re-indexing unchanged)
│
├── learning/
│   ├── patterns.json          # keyword routing patterns learned over time
│   └── trajectories/          # task → agent → outcome trajectories
│
├── metrics/
│   ├── hook-latency.json      # p50/p95/p99 hook execution latency
│   └── token-summary.json     # token usage by model and period
│
├── loops/                     # 25+ active loop configs
│   └── *.json                 # {id, command, prompt, maxReps, currentRep, status, nextRunAt}
│                              # status: "running" | "hil:pending" | "complete"
│
├── orgs/                      # org definitions and runtime state
│   ├── demo-org.json          # example org: 4 roles, hierarchical, court-tested
│   ├── court-sim.json         # court simulation: 5 roles (judge/prosecutor/defender/clerk/reporter)
│   ├── newsroom.json          # newsroom: 4 roles (editor/reporter/fact-checker/copy-editor)
│   ├── *-approvals.json       # pending approvals per org
│   ├── *-goals.json           # org goal definitions
│   ├── *-state.json           # agent runtime state (status, lastHeartbeat, tokensIn/Out)
│   └── *-budgets.json         # per-org token and cost budgets
│
├── sessions/                  # 352+ session records (JSONL event logs)
│                              # branch-agnostic: data persists when switching git worktrees
│
├── swarm/                     # swarm coordination state files
├── tasks/                     # task board definitions
├── security/                  # threat detection logs
├── worker-dispatch/           # daemon worker dispatch queue
├── test-fixtures/             # test data
├── data/                      # session journal data
├── graph/                     # knowledge graph snapshots
├── logs/                      # execution logs
└── .monomind_inner/           # internal state (agent pools, volatile runtime data)

~/.monomind/sessions.json      # cross-project session persistence for MonoBrowse platform
                               # connections (LinkedIn, Instagram, X, Gemini); chmod 0o600;
```

---

## 7. External Dependencies

### Always Required

| Package | Version | Used for |
|---|---|---|
| `lancedb` | 3.0.0-alpha.11 | Primary memory backend (vector + KV + causal graph) |
| `better-sqlite3` | 11–12.0.0 | monograph.db, pattern caching (requires native binaries) |
| `sql.js` | 1.10–1.14 | Cross-platform SQLite (WASM, zero native compilation) |
| `graphology` | 0.25.4 | In-memory graph data structure |
| `graphology-communities-louvain` | — | Community detection algorithm |
| `graphology-shortest-path` | — | Shortest-path traversal |
| `graphology-metrics` | — | Centrality, density, modularity |
| `graphology-traversal` | — | BFS/DFS |
| `chokidar` | 3.6.0 | File system watching (triggers graph rebuild) |
| `zod` | 3.23 / 4.3.6 | Schema validation throughout |
| `ajv` | 8.12.0 | JSON Schema validation for MCP wire messages |
| `ws` | 8.14–8.18 | WebSocket transport for MCP and MonoBrowse dashboard |
| `semver` | 7.6.0 | Version comparison (update checking, compatibility) |
| `micromatch` | 4.0.8 | Glob pattern matching (file scanning) |
| `@noble/ed25519` | 2.1.0 | Ed25519 cryptography for agent identity |

Note: `@monomind/embeddings` has been removed; `graphology` packages and `chokidar` now pulled transitively via `@monoes/monograph`.

### Conditional / Optional

| Package | Active when | Capability it enables |
|---|---|---|
| `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` set | LLM fallback routing; monograph semantic annotation |
| `@xenova/transformers` | No ONNX accelerator | Local embedding (default, ~500ms/doc) |
| `agentic-flow` | Installed separately | 75x faster ONNX embeddings (~6ms/doc) |
| `tree-sitter` + 14 parsers | Monograph build | AST extraction for all 14 supported languages |
| `express` | HTTP MCP transport | HTTP server for remote MCP connections |
| `helmet` | HTTP transport | Secure HTTP response headers |
| `cors` | HTTP transport | Cross-origin request handling |

### CVE Remediations (pnpm.overrides, v1.13+)

8 transitive vulnerability classes floor-pinned in a single commit:

| CVE class | Package |
|---|---|
| SSRF | `axios` |
| Prototype pollution | `protobufjs`, `qs` |
| Supply-chain exposure | `esbuild` |
| DoS | `ws` |
| Header injection | `hono` |
| ReDoS | `@grpc/grpc-js` |

### Language Parsers (tree-sitter — 14 total)

TypeScript · JavaScript · Python · Go · Rust · Java · C · C++ · C# · Ruby · PHP · Kotlin · Swift · Scala · Vue

---

## 8. Test Coverage

| Package | Test files | Coverage areas |
|---|---|---|
| `@monomind/cli` | 30+ in `/tests/` | Command parsing, memory operations, diff classification, routing |
| `@monomind/hooks` | 46 test files | Hook execution, ReasoningBank, worker dispatch, intelligence pipeline |
| `@monomind/memory` | 11 test files | HNSW search, LanceDB CRUD, schema migration |
| `@monomind/embeddings` | — | Normalization, chunking, hyperbolic math, cache behavior |
| `@monomind/security` | — | Path traversal prevention, injection blocking, Zod schemas |
| `@monomind/routing` | — | Keyword matching, outcome recording, accuracy metric |
| Docker regression | — | Cross-platform compatibility checks |

**Total:** 579 test files · Framework: **vitest** (4.1.4) + chai

**Coverage gaps:** Dashboard UI has no automated tests. No E2E tests for the MCP tool invocation path. Browser automation (`browse` command) has no headless tests. The full neural loop (on `monoes-full-loop` branch) is completely untested in V1.

---

## 9. Wiring Quality Assessment

### ✅ Tier A — Production-quality, fully wired

| Component | Evidence |
|---|---|
| CLI → all packages | 41 commands correctly delegate to their packages; no dead imports |
| MCP tools → CLI commands | All 50+ tools delegate correctly; prototype-pollution guard + length caps on every message |
| Hooks → memory backend | pre/post hooks write patterns to LanceDB; trajectories stored; latency tracked |
| Security (InputValidator + PathValidator) | Applied at every system boundary — file reads, API endpoints, CLI args |
| Avatar serving | Traversal-guarded; 200 for 120 agent types; correct `image/svg+xml` Content-Type |
| monograph MCP tools (43) | Full graph query path working; all 43 tools return structured text with file:line hints |
| Agent definition resolver | Fuzzy slug matching, domain-fit check, graceful degradation to org-config-only |
| Org activity (per-org scoped) | Strict filter (no untagged-leak); synthesizes real per-org timeline |
| MCP server security | Prototype-pollution sanitization + Zod validation + rate limiting + 64 KB caps |
| createorg spec generation | Generates skills + instructions + I/O + communication from first shot |
| monofence-ai detection | ThreatDetectionService, EvasionDetector, ContextTracker, OutputScanner, 4 MCP tools — all wired |
| MonoBrowse DAG engine | Kahn topological sort, per-node timeouts, AbortSignal cancellation, 6 built-in action handlers |
| Dashboard real-time cost | SSE cost events feed topbar badge, live ticker, 30-day chart; price tables accurate for all current models |
| Org lifecycle (full) | create, run, stop, delete, copy, import/export — end-to-end from both CLI and dashboard |
| Session persistence (MonoBrowse) | Platform sessions survive CLI restarts via `~/.monomind/sessions.json` (chmod 0o600) |
| HNSW fast path | bridgeSearchEntries bypasses 5000-row brute-force; tuning params forwarded; 384D default correct |

### ⚠️ Tier B — Partial / conditional wiring

| Component | Gap |
|---|---|
| Full neural pipeline (SONA/LoRA) | On `monoes-full-loop` branch; V1 has keyword routing + outcome measurement only |
| `@monomind/guidance` deeper modules | `wasm-kernel`, `meta-governance` are stubs |
| `monofence-ai` learning | Threat learning requires LanceDB as optional dep; silently degrades when absent |
| Routing context-awareness | Pure keyword matching; no codebase graph, session history, or embeddings used |
| Org activity (live org events) | Synthesized from config records; `runorg` now emits org-tagged events but historical events lack `org` field |
| Guidance in practice | `.claude/CLAUDE.md` is the primary governance mechanism; compiled guidance system used less |

### 🔴 Tier C — Stubs / not wired

| Component | Status |
|---|---|
| `@monomind/swarm` package | All swarm logic in CLI command file; package is an extraction placeholder |
| `@monomind/performance` package | All perf logic in CLI command file; package is an extraction placeholder |
| `gastown-bridge` plugin | Integration target unclear; no active wiring found |
| `prime-radiant` plugin | Stub |

---

## 10. Real Value Assessment Per Component

### Tier 1 — Irreplaceable, used on every invocation

| Component | Real value delivered |
|---|---|
| **CLI** (`@monomind/cli`) | The entire user surface — 41 commands, control room, MCP interface |
| **Hooks system** | The "nervous system" — without hooks, Claude Code has no memory of what worked or failed |
| **Memory backend** (`@monoes/memory`) | Cross-session persistence; semantic search over all learned patterns via HNSW |
| **Dashboard UI** | Visual control room for sessions, loops, memory, orgs, agent topology |
| **Security** (`@monomind/security`) | Applied at every boundary; prevents path traversal, injection, schema violations |
| **MCP tools** | Every capability accessible from Claude Code without leaving the conversation |

### Tier 2 — High value, actively used

| Component | Real value delivered |
|---|---|
| **Routing** (`@monomind/routing`) | Routes tasks to the right agent; outcome feedback closes the improvement loop |
| **monograph tools** (43 MCP tools) | Reduce codebase exploration time dramatically; file:line hints eliminate follow-up queries; impact analysis before any change |
| **Agent definitions** (104 .md files) | Every spawned agent gets context-appropriate instructions, skills, I/O contracts |
| **Mastermind skills** (93 files) | Structured multi-step workflows; `createorg` generates complete agent specs on first run |
| **Browser automation / MonoBrowse** (`browse`) | Full DAG workflow engine + CDP automation + 6 built-in action handlers + session persistence — composable automation without writing TypeScript |
| **Org system** (server + skills) | Full org lifecycle — create, run, stop, delete, copy, import/export — with per-org isolation, cost tracking, and `org:comms` Chat tab |
| **monofence-ai** | Full AI security layer: threat detection, evasion normalization, multi-turn escalation, output scanning, 4 MCP tools — activated via hooks |

### Tier 3 — Value present, partially realized

| Component | Value | Current limitation |
|---|---|---|
| **Guidance** (`@monomind/guidance`) | Governance infrastructure is real | Deeper modules unused; `.claude/CLAUDE.md` does most governance in practice |
| **Graph** (`@monomind/graph`) | Code understanding is genuinely valuable | Architecturally redundant with monograph; legacy status |
| **Org activity** | Per-org real data | Synthesized from config; `runorg` now emits org-tagged events but historical events in `mastermind-events.jsonl` still lack `org` field |
| **Org agent drawer** | Full role spec visible per-org | Complete only when `.claude/agents/generated/` defs exist for the org's types |

### Tier 4 — Infrastructural / future value

| Component | Value when fully realized |
|---|---|
| **MonoVector / SONA** (`monoes-full-loop` branch) | Self-improving routing without manual retraining — the long-term intelligence differentiator |
| **`@monomind/swarm` + `@monomind/performance` packages** | Clean separation; currently the swarm/perf packages are just empty shells |
| **Hyperbolic embeddings** | Correct representation of hierarchical structures (org charts, package trees) in vector space |

| **Byzantine consensus** (`hive-mind`) | Fault-tolerant agent teams at scale — overkill today, ready for growth |

---

## 11. Known Gaps & Honest Caveats

### Architecture

**1. `@monomind/swarm` and `@monomind/performance` are empty packages.**
All swarm coordination logic lives in `packages/@monomind/cli/src/commands/swarm.ts` (31 KB). These packages exist as future extraction targets. They add dependency complexity without delivering independent value today.

**2. Two knowledge graph packages overlap significantly.**
`@monomind/graph` and `@monomind/monograph` do nearly the same thing (tree-sitter + graphology). Monograph is the canonical future and the active development target. Graph is legacy. Neither has been formally deprecated in `package.json`, which creates maintenance ambiguity.

**3. The full neural loop is not in V1.**
SONA (self-optimizing neural architecture), MoE routing, Flash Attention, EWC++ catastrophic-forgetting prevention, and LoRA training are on the `monoes-full-loop` branch. V1 delivers keyword routing + outcome measurement — a working foundation, but not the self-improving intelligence pipeline described in earlier README performance claims.

**4. Routing is pure keyword matching.**
The router matches task text against a static table. It does not use the codebase graph, session history, learned embeddings, or any semantic similarity. The `ReasoningBank` stores patterns, but V1 does not retrieve them into routing decisions.

**5. Historical global events lack org tags.**
`data/mastermind-events.jsonl` events created before the `runorg` event-emission fix have no `org` field. New runs emit org-tagged events, but the Activity tab timeline for older sessions is still synthesized from config records.

### Dependency Risks

**6. `lancedb` is at `3.0.0-alpha.11`.**
The primary memory backend is pre-stable. API breaks without notice are possible, though unlikely given the project controls the upstream.

**7. `better-sqlite3` requires platform-specific native binaries.**
If prebuilt binaries fail for a target platform (new Node version, unusual architecture), the monograph database and pattern cache silently fall back to `sql.js`. The fallback works but is slower.

**8. Several capabilities silently degrade when optional deps are absent.**
`agentic-flow` (75x faster embeddings), `@anthropic-ai/sdk` (LLM routing fallback + monograph annotation), and `lancedb` as a peer dep (monofence-ai threat learning) all degrade silently. The degradation is correct behavior, but the capability gap is not always surfaced to the user in a visible way.

### Accuracy of Existing Documentation

**9. README performance claims require qualification.**
The 150x–12,500x speedup applies to HNSW vs linear vector scan — this is real and V1. The SONA < 0.05ms adaptation, MoE routing, Flash Attention 2.49x–7.47x speedup, and EWC++ apply to the `monoes-full-loop` branch and are not available in the current npm release.

---

*Last updated: 2026-06-20 · Reference commit: `44470d5c` · Run `git log --oneline -1` to confirm.*
