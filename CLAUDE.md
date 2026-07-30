# Claude Code Configuration - Monomind v2

> **Monomind v2.7.6** — Packages: `monomind@2.7.6` (umbrella), `@monoes/monomindcli@2.7.6` (CLI), `@monoes/monograph@1.5.4` (knowledge graph)

## Behavioral Rules (Always Enforced)

- For swarm/hive-mind mode selection, use `/mastermind:topology` — it presents all topologies and gives a concrete recommendation. Do NOT auto-prompt for swarm mode. (`/mastermind` itself is the universal intent router: it deeply analyzes any prompt and routes it to the right monomind/mastermind/monodesign/monomotion capability, executing or instructing per its `--auto`/`--suggest` flags.)
- For ANY UI testing, browser automation, or web navigation request: ALWAYS invoke `Skill("agent-browser-testing")` FIRST — no exceptions. Uses native `monomind browse` CDP client — no external binary needed.
- NEVER use `mcp__claude-in-chrome__*`, `mcp__plugin_playwright__*`, `mcp__playwright__*`, Playwright, Puppeteer, Selenium, or any external browser tool for web browsing. ALWAYS use `npx monomind browse`. This rule has no exceptions — not even "just this once" (this governs agent web-navigation; monodesign's own internal antipattern-detection driver has an optional Puppeteer fallback scoped to its own tooling — monobrowse preferred, Puppeteer only if monobrowse is unavailable — which is not a rule exception).
- For ANY web animation, motion graphics, or animation request: ALWAYS invoke `Skill("monomotion")` FIRST — no exceptions. This includes: "animate this", "add animation", "create an animation", "motion graphics", "animated intro/outro", "text animation", "scroll animation", "GSAP".
- For ANY frontend design, UI improvement, design critique, design system, brand identity, UX research, visual storytelling, image generation for design, component systems, or CSS architecture task: ALWAYS invoke `Skill("monodesign")` FIRST — no exceptions. This is the ONLY design agent — there are no separate UI Designer, UX Architect, UX Researcher, Brand Guardian, Visual Storyteller, Whimsy Injector, Image Prompt Engineer, or Inclusive Visuals agents anymore. All design intelligence is in monodesign. Note: monodesign produces image *prompts* (text specs) only, not actual images — for image generation itself use the separate `monoagent-image` skill (no code sharing between the two). This includes: "design this", "redesign", "improve the UI", "add polish", "make it look better", "audit the design", "critique the UI", "fix the layout", "colorize", "typeset", "design system", "design tokens", "antipattern", "brand identity", "brand strategy", "ux research", "user research", "usability test", "persona", "component system", "css architecture", "theme toggle", "dark mode", "image prompt", "hero image", "generate image", "whimsy", "delight", "visual narrative", "inclusive design".
- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (\*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- ALWAYS call `mcp__monomind__monograph_query` BEFORE running grep/rg/find via Bash for code exploration — only fall back to Bash grep if monograph returns 0 results or the DB does not exist
- When starting any task that touches 3+ files: call `mcp__monomind__monograph_suggest` first to get relevant nodes ranked by task relevance
- **Crash reporting**: monomind, mono-agent, monotask, and mono-clip each auto-report uncaught crashes as GitHub issues on their own repo (on by default — `monomind crash-reporting disable` to opt out; see `packages/@monomind/cli/src/services/crash-reporter.ts`). This only covers hard crashes, not everyday friction — so when a user is stuck on something that ISN'T a crash (a confusing error message, a workflow that doesn't behave as documented, something in these four tools that seems broken or inconsistent), **suggest opening a GitHub issue** rather than filing one yourself. One line is enough: name the repo (`monoes/monomind`, `monoes/mono-agent`, `monoes/monotask`, or `monoes/mono-clip`, whichever is actually implicated) and ask if they'd like you to open it (via `gh issue create`) or if they'd rather do it themselves. Don't do this for run-of-the-mill usage questions you can just answer — only when something is genuinely unresolved, contradictory, or looks like a real bug in one of these four tools.

## Memory Loop (Feedback + Knowledge Graph)

- When memory/knowledge search results (`memory_*`, `knowledge_search`) materially help a task, close the loop: call `mcp__monomind__memory_feedback` with the task id and the result `entryIds` (+ `success`/`quality`) — this EWMA-trains ranking for future sessions. Idempotent per taskId.
- At the end of a session that produced durable insight (entities, relationships, "when X do Y" rules), distill it once via `mcp__monomind__memory_kg_ingest` with an `originRef` of the session id. Reuse existing entity names (check `memory_kg_stats` with `glossary:true`) instead of minting near-duplicates.
- Query structured memory with `mcp__monomind__memory_kg_search` (relationship/dependency questions) — `knowledge_search` routes there automatically for relationship-shaped queries.
- Bad ingest? `memory_kg_rollback` with the originRef deletes everything that source wrote.

## File Organization

- NEVER save to root folder — use the directories below
- Use `/src` for source code files
- Use `/tests` for test files
- Use `/docs` for documentation and markdown files
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- Use `/examples` for example code

## Project Architecture

- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Ensure input validation at system boundaries

### Key Packages

| Package               | Path                            | Purpose                                |
| --------------------- | ------------------------------- | -------------------------------------- |
| `@monomind/cli`      | `packages/@monomind/cli/`      | CLI entry point (32 commands)          |
| `@monoes/hooks`    | `packages/@monomind/hooks/`    | Hook registry/executor library + 8 on-demand workers (health/ddd/security/cache/progress/map/audit/consolidate); bridged from `.claude/helpers` (session-start workers + security) and started by the CLI MCP server. 7 workers with zero consumers were deleted (performance/patterns/adr/learning/git/swarm/optimize). No interval timers — all on-demand via `hooks worker run <name>` or session-start freshness check |
| `@monoes/memory`     | `packages/@monomind/memory/`   | Lower-level memory backend library (SQLite/JSON pattern-store implementations) dynamically imported by the CLI's bridge — the live bridge itself (`memory-bridge.ts`, `hnsw-operations.ts`) lives in `packages/@monomind/cli/src/memory/`, not here. Default engine: local SQLite with embedded vectors (better-sqlite3, sql.js WASM fallback; local HF-embeddings) — backs CLI `memory store/search`, the MCP memory tools, and the Second Brain. LanceDB was removed 2026-07 (≈600MB of native deps for no measured value); pure-JS HNSW stays off the default search path (reachable via `memory search --build-hnsw`) |
| `@monoes/mcp`      | `packages/@monomind/mcp/`      | MCP server framework — powers `mcp start -t http`/`-t websocket` (and stdio/in-process transports) only; the *default* stdio transport that `claude mcp add monomind -- npx -y monomind@latest mcp start` wires up is a separate, hand-rolled JSON-RPC loop inside the CLI package itself (`mcp-server.ts`'s `startStdioServer()`), which never imports this package. Also provides session/connection/resource/prompt/task management, rate limiting, OAuth, and sampling; its own built-in tool registry is small (4 tools) — real usage hands it the CLI's actual tool roster |
| `@monoes/routing`  | `packages/@monomind/routing/`  | Semantic routing (`RouteLayer`: keyword pre-filter → real embedding via an isolated worker process — kept out-of-process specifically because loading `onnxruntime` in-process causes SIGSEGVs — → cosine similarity → Haiku LLM fallback below threshold). **Opt-in only** — reached via `route semantic`, `agent --task`, or MCP `hooks_route_semantic`. Bare `monomind route "task"` does **not** use this package: it runs a lightweight keyword-only stub (`createKeywordRouter`, fixed 0.75 confidence, 8 hardcoded categories, no embeddings) in the CLI package itself — this is what the Anti-Drift Defaults "Routing: keyword + route-outcomes" line below describes |
| `@monoes/monobrowse` | `packages/@monoes/monobrowse/` | Browser automation via CDP (standalone)|
| `@monoes/monodesign` | `packages/@monoes/monodesign/` | Frontend design intelligence (tokens, antipattern detection, monodesign skill) |
| `@monoes/monograph`  | `packages/@monomind/monograph/` | Knowledge graph (tree-sitter + SQLite) |
| `monofence-ai`       | `packages/monofence-ai/`       | Independent AI-manipulation-defense library (~2,370 lines of `src/`: threat/evasion detection, multi-turn context tracking, output scanning, ReasoningBank-style learning) — wired into the live pre-bash/pre-write gate path via its own lazy-loaded integration in `.claude/helpers/handlers/gates-handler.cjs` (`MONOMIND_MONOFENCE_GATE=off` to disable), not via its `registerSecurityHooks()` API (that's consumed only by the in-process `@monoes/hooks` `HookExecutor`, a separate mechanism from the live CJS dispatch path) |

(The former `@monomind/security` package was deleted — input validation is inlined at `packages/@monomind/cli/src/utils/input-guards.ts`.)

## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- Use Claude Code's Task tool for spawning agents, not just MCP

**Mandatory patterns:**

- ALWAYS batch ALL todos in ONE TodoWrite call (5-10+ minimum)
- ALWAYS spawn ALL agents in ONE message with full instructions via Task tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL terminal operations in ONE Bash message
- ALWAYS batch ALL memory store/retrieve operations in ONE message

---

## Swarm Orchestration

Org runtime v2: use `monomind org run <name>`; `/mastermind:runorg` now delegates to the v2 daemon. The legacy prompt-orchestrated path is `/mastermind:runorgv1` (kept reachable only under that explicit v1 name).

- MUST initialize the swarm using MCP tools when starting complex tasks
- MUST spawn concurrent agents using Claude Code's Task tool
- Never use MCP tools alone for execution — Task tool agents do the actual work
- MUST call MCP tools AND Task tool in ONE message for complex work

### Anti-Drift Coding Swarm (PREFERRED DEFAULT)

- ALWAYS use hierarchical topology, maxAgents 6-8, specialized strategy
- Use `raft` consensus (leader maintains authoritative state)
- Run frequent checkpoints via `post-task` hooks
- Keep shared memory namespace for all agents

```javascript
mcp__monomind__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" });
```

### Agent Routing (Anti-Drift)

| Code | Task        | Agents                                          |
| ---- | ----------- | ----------------------------------------------- |
| 1    | Bug Fix     | coordinator, researcher, coder, tester          |
| 3    | Feature     | coordinator, architect, coder, tester, reviewer |
| 5    | Refactor    | coordinator, architect, coder, reviewer         |
| 7    | Performance | coordinator, perf-engineer, coder               |
| 9    | Security    | coordinator, security-architect, auditor        |
| 11   | Memory      | coordinator, memory-specialist, perf-engineer   |
| 13   | Docs        | researcher, api-docs                            |

Codes 1-11: hierarchical/specialized. Code 13: mesh/balanced.

### On-Demand Swarm Selection

Use `/mastermind:topology` to pick a swarm or hive-mind topology. It lists all options and gives a concrete recommendation for the current task. Do not auto-prompt or interrupt work to ask about swarm mode.

---

## Knowledge Graph — Monograph (Use Before Codebase Exploration)

**When starting any task that touches 3+ files, introduces a new feature, or requires understanding a module you haven't worked in recently:**

1. Call `mcp__monomind__monograph_suggest` first — it returns the most relevant files and relationships for your task description
2. Call `mcp__monomind__monograph_query` for targeted lookups ("what imports auth?", "what does UserService depend on?") — results include exact file path and line number. PPR graph reranking is on by default (HippoRAG-style, boosts neighbors of top hits for better related-code discovery); pass `rerank: false` to disable
3. Call `mcp__monomind__monograph_god_nodes` to find high-centrality **internal** files (external/test symbols are automatically filtered)

**Why:** The knowledge graph encodes full dependency relationships, import chains, and architectural topology. It lets you understand the blast radius of a change and find all affected files without grepping the entire codebase.

**Available monograph tools: 19 default tools; 27 advanced via `MONOGRAPH_MCP_ADVANCED=1`.**

### Core Navigation (use these first)

| Tool | Use when |
|---|---|
| `monograph_suggest` | **Start every task** — returns ambiguous edges, bridge nodes, isolated nodes ranked by task relevance. Pass `checkStaleness: true` to auto-trigger a background rebuild when the index is behind HEAD |
| `monograph_query` | **Primary lookup** — BM25 keyword search; returns file + line number. PPR graph reranking is on by default; pass `rerank: false` to disable |
| `monograph_god_nodes` | Finding high-centrality internal files (external/test filtered) |
| `monograph_augment` | Graph-RAG: retrieve relevant code context for a natural-language query |
| `monograph_get_node` | Get a specific node by exact ID or name |
| `monograph_neighbors` | Show all directly connected nodes for a symbol — outbound and inbound edges |

### Change Impact & Analysis

| Tool | Use when |
|---|---|
| `monograph_impact` | **Before changing anything** — find all upstream dependents + downstream dependencies (blast radius) |
| `monograph_api_impact` | Blast radius of an HTTP route — finds handler, BFS through CALLS edges, risk score |
| `monograph_context` | 360° view of a file: importers, imports, parent, community siblings |
| `monograph_detect_changes` | Map current git diff to affected graph nodes + dependents |
| `monograph_route_map` | List all HTTP routes with handler info; filter by URL prefix or method |
| `monograph_dead_code` | **Stale hunt** — finds dead exported functions, orphan files with no importers, and stale dist build artifacts. Categories: `dead-functions`, `orphan-files`, `stale-dist`. Verifies candidates against source before reporting. |

### Index Lifecycle

| Tool | Use when |
|---|---|
| `monograph_build` | Full build (or rebuild) — parses code via tree-sitter, indexes into SQLite |
| `monograph_health` | Index staleness: commits behind HEAD |
| `monograph_staleness` | Git staleness details — isStale, changed files, first diverging commit timestamp |
| `monograph_stats` | Quick sanity check — node/edge/community counts |
| `monograph_watch` | Start incremental file watcher — rebuilds on change (3s debounce) |
| `monograph_watch_stop` | Stop the file watcher |
| `monograph_doctor` | Platform diagnostics — Node version, SQLite health, node count, disk space |

### Advanced Tools (hidden by default — set `MONOGRAPH_MCP_ADVANCED=1` to expose)

27 additional tools, gated to keep the default MCP surface small:

- **Graph exploration:** `cypher`, `shortest_path`, `community`, `surprises`, `shape_check`, `rename`, `tool_map`
- **Visualization & export:** `serve`, `visualize`, `snapshot`, `diff`, `report`, `export`
- **Wiki & AI docs:** `wiki`, `wiki_build`, `skill_gen`, `install_skills`, `inject_context`
- **Multi-repo/group:** `group_list`, `group_query`, `group_sync`, `group_contracts`, `group_status`, `list_repos`
- **Agent memory:** `agent_history`, `agent_patterns`, `agent_record`

(All prefixed `monograph_`. Removed entirely: `monograph_embed`, `monograph_suggest_auto` — use `monograph_suggest` with `checkStaleness: true` — `monograph_rank_with_graph`, `monograph_ppr_rerank`, `monograph_community_summaries`.)

**Skip monograph for:** single-file edits, doc/config changes, quick fixes where you already know the file.

**If `monograph_suggest` returns empty or errors:** the graph may not be built yet. Call `mcp__monomind__monograph_build` (codeOnly: true) — it runs in the background; proceed with normal Glob/Grep while it builds.

### Speculative Tools (hidden by default — set `MONOMIND_MCP_SPECULATIVE=1` to expose)

Same pattern as monograph's advanced-tools gate above, applied to tools whose names imply more than they deliver — real local computation, but not the distributed/ML capability the name suggests (see the honesty review for the full evidence trail). 10 tools gated:

- **`hive-mind_*`** — 9 of 11 (`spawn`, `init`, `consensus`, `broadcast`, `shutdown`, `memory`, `leave`, `audit_list`, `audit_verify`). `hive-mind_status`/`hive-mind_join` stay visible by default as legitimate read/registration primitives.
- **`embeddings_neural`** — 1 of 7 `embeddings_*` tools. Its `init` action persists config flags (`sona`, `flashAttention`, `ewcPlusPlus`, ...) with no implementing code behind them.
- *(The 6 IPFS `transfer_*` tools that used to be gated here were deleted outright in 2026-07 — see below.)*

**Deleted rather than gated** (2026-07):

- `daa_*` (all 8 tools, 630 lines) — local JSON bookkeeping with fabricated running-average metrics and zero tests.
- `coherence_*` (all 6 tools, 2,616 lines) — genuine graph/spectral/TDA math, but zero tests, zero callers outside its own directory, and no CLI surface. Real code that nothing consumed, behind names like "quantum topology" involving no quantum computation.
- The 6 IPFS `transfer_*` tools (`ipfs-resolve`, `store-search`/`-info`/`-download`/`-featured`/`-trending`) together with the ~4,600-line `src/transfer/{store,ipfs,storage,models,serialization}` subtree. Unreachable three ways over: gated out of the MCP surface, exposed only on a CLI path the dispatcher cannot reach (`hooks transfer store …` is four levels deep; the dispatcher resolves three), and pointing at a registry whose bootstrap config held the placeholder `publicKey: 'ed25519:monomind-registry-key'`. `transfer_detect-pii` is unrelated — a real local regex PII scanner — and stays visible; `hooks transfer from-project` also still works, since it calls `hooks_transfer` and never touched the store code.

**Deleted** (2026-07): `neural_*` (all 6 tools, `neural-tools.ts`) — an embedding-backed pattern store whose names (`train`, `predict`, `learn`) implied ML that never occurred. Removed entirely; the genuinely useful `embeddings_*` tools cover real embedding work.

### Tool roster — core default + on-demand discovery (2026-07)

`tools/list` advertises only a **core roster** (~88 tools: memory, monograph, a hooks subset, task, session, knowledge, system/mcp, guidance, config, agent) to keep the per-call schema payload small. Non-core categories (browser, github, swarm, claims, terminal, embeddings, performance, etc.) remain fully callable by name and are discoverable via the **`monomind_tool_search`** tool, which returns their full `inputSchema`. Set **`MONOMIND_MCP_FULL=1`** on the MCP server to advertise the entire roster (power users / CI). See `packages/@monomind/cli/src/mcp-client.ts` (`isCoreAdvertised`, `searchNonCoreTools`).

**`swarm_*` and `agent_spawn` are not gated but are metadata-only**: `swarm_init`, `swarm_scale`, and `agent_spawn` write JSON state records — they start no process, thread, or agent. Real concurrency comes only from Claude Code's Task tool. Their descriptions say so explicitly.

---

## Claude Code vs MCP Tools

**Claude Code handles ALL EXECUTION:** Task tool (agents), file ops (Read/Write/Edit/Glob/Grep), code generation, Bash, TodoWrite, git.

**MCP tools ONLY COORDINATE:** Swarm init, agent type definitions, task orchestration, memory management, neural features, performance tracking.

---

## CLI Commands (32 Commands)

| Command          | Sub | Description                                          |
| ---------------- | --- | ---------------------------------------------------- |
| `init`           | 5   | Project initialization (wizard, presets, skills)     |
| `start`          | -   | Start MCP server (foreground or daemonized)          |
| `status`         | 3   | System status monitoring with watch mode             |
| `agent`          | 7   | Agent lifecycle (spawn, list, status, stop, metrics, pool, health). Runs in-process — no separate MCP server required |
| `swarm`          | 6   | Multi-agent swarm coordination. Runs in-process — no separate MCP server required |
| `memory`         | 12  | Memory store — local SQLite + local embeddings (semantic search, keyword fallback); JSON pattern store for hooks/intelligence |
| `mcp`            | 9   | MCP server management                                |
| `task`           | 5   | Task creation and lifecycle                          |
| `session`        | 6   | Session state management (incl. `replay` show/list)  |
| `config`         | 7   | Configuration management                             |
| `hooks`          | 29  | Self-learning hooks + 8 on-demand workers (@monoes/hooks WorkerManager) |
| `security`       | 6   | Security scanning: scan, cve, audit, secrets, defend, redteam. `audit`'s `--action export/log/clear` are unimplemented (list-only); `redteam`'s live `--target` execution is unimplemented (`--dry-run` only) |
| `performance`    | 4   | Performance profiling — real benchmark measurements  |
| `guidance`       | 1   | Wire enforcement gates into Claude Code hooks (setup) |
| `org`            | 16  | SDK org runtime v2 — daemon-controlled agent orgs (run [--dry-run], stop, status, serve, test-loop, logs, report, memory [stats\|search\|rules\|rollback], questions, answer, create, validate, migrate, list, delete, mark-complete) |
| `monograph`      | -   | Knowledge graph CLI (delegates to @monoes/monograph) |
| `browse`         | -   | Browser automation via CDP (@monoes/monobrowse)      |
| `doctor`         | 1   | System diagnostics                                   |
| `cleanup`        | -   | Project cleanup utilities                            |
| `autopilot`      | -   | Task discovery + next-action heuristic (reads local task files; picks the first incomplete one at fixed 0.5 confidence). The learning/prediction path needs `agentic-flow`, which is **not a declared dependency** and is absent in normal installs |
| `analyze`        | -   | Codebase analysis                                    |
| `route`          | -   | Task routing                                         |
| `providers`      | 4   | AI provider management (configure, test, list, remove) |
| `search`         | 1   | Universal search (`search scan` refreshes fingerprint) |
| `doc`            | -   | Documentation generation                             |
| `design`         | -   | Design detection and routing                         |
| `tokens`         | -   | Token counting                                       |
| `platforms`      | -   | Platform management                                  |
| `completions`    | 4   | Shell completions (bash, zsh, fish, powershell)      |
| `update`         | -   | Self-update check                                    |
| `report-crash`   | -   | Report a crash                                       |
| `crash-reporting` | -  | Configure crash reporting                            |

## Agent Teams (Multi-Agent Coordination)

Enabled via `npx monomind@latest init` (sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).

**Components:** Team Lead (main Claude), Teammates (Task tool), Task List (TaskCreate/TaskList/TaskUpdate), Mailbox (SendMessage).

**Best practices:**
1. Spawn teammates with `run_in_background: true` for parallel work
2. Create tasks first via TaskCreate before spawning teammates
3. Name teammates by role (architect, developer, tester)
4. Don't poll status -- wait for completion/messages
5. Send `shutdown_request` before TeamDelete

**Hooks:** `teammate-idle` (auto-assign tasks), `task-completed` (train patterns, notify lead).

## Available Agents (31 definitions in `.claude/agents/`, all 31 registered: 29 curated below + 2 non-roster — `templates/coordinator-swarm-init.md` and `generated/dashboard-verifier.md`)

- **Core:** coder, coordinator, planner, researcher, reviewer, tester
- **Engineering:** ai-engineer, backend-architect, code-reviewer, devops-automator, frontend-developer, security-engineer, software-architect, technical-writer
- **GitHub:** github-modes, pr-manager, code-review-swarm, issue-tracker, release-manager, repo-architect
- **Swarm / Hive-Mind:** mesh-coordinator, collective-intelligence-coordinator (`queen-coordinator` was absorbed into `core/coordinator` in 2026-07 — same shape, one entry point; hive-session guidance lives in that agent's "Hive sessions" section)
- **Consensus:** quorum-manager
- **Specialized:** mcp-builder, mobile (spec-mobile-react-native), integration-architect, goal-planner, tdd-london-swarm
- **Design:** monodesign (the only design agent)

## Hooks System

Note: rows below (except Agent Teams) are `monomind hooks <subcommand>` CLI names (part of the 29 `hooks` subcommands), not the 20 typed `HookEvent` registry/executor events (pre-edit, post-edit, session-start, etc. in `@monoes/hooks`'s `HookEvent` enum) — the two are different mechanisms.

| Category         | Hooks                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| **Core**         | pre-edit, post-edit, pre-command, post-command, pre-task, post-task             |
| **Session**      | session-start, session-end, session-restore, notify                             |
| **Intelligence** | route, explain, pretrain, build-agents, transfer                                |
| **Learning**     | intelligence (trajectory-start/step/end, pattern-store/search, stats, attention)|
| **Agent Teams**  | teammate-idle, task-completed (Claude Code hook events, not CLI subcommands)    |

**Hooks — 8 Workers** (`@monoes/hooks` WorkerManager): health, ddd, security, cache, progress, map, audit, consolidate — all on-demand only (`enabled: false`, no interval timers). Run via `monomind hooks worker run <name>` or triggered by session-restore-handler's freshness check at session start. 7 workers with zero consumers were deleted in 2026-07: performance, patterns, adr, learning, git, swarm, optimize.

## Hive-Mind Consensus

**Status: Experimental — single-process vote counting, not distributed consensus.**

**Topologies:** hierarchical, mesh, hierarchical-mesh (recommended), adaptive.
**Strategies:** byzantine (f < n/3), raft (f < n/2), quorum. Gossip and CRDT are planned but not yet implemented.

## Project Configuration (Anti-Drift Defaults)

Topology: hierarchical | Max Agents: 8 | Strategy: specialized | Consensus: raft | Routing: keyword + route-outcomes | Memory: JSON patterns + local SQLite/embeddings (see Key Packages table).

### Hook / roster env switches (2026-07)

| Var | Effect |
|---|---|
| `MONOMIND_MCP_FULL=1` | Advertise the full MCP tool roster (~270) instead of the core default (~88). |
| `MONOMIND_HOOK_QUIET=1` | Silence per-prompt advisory blocks (`[AUDIT]`, `[CODEBASE]`, `[MONOGRAPH]`, `[INTELLIGENCE]`, `[COST]`, knowledge/memory excerpts, etc.). Side-effects (file writes, telemetry, route mutations) are unchanged. |
| `MONOMIND_MASTERMIND=1` | Emit the Mastermind skill-router table at session start (off by default). |
| `MONOMIND_SKILL_AUTO=1` | Surface skill-match suggestions in the route hook (off by default). |
| `MONOMIND_GRAPH_GATE=off` | Disable the bash/search graph-gate that requires a monograph call first (unchanged). |

## Quick Setup

```bash
# MCP mode requires explicit `mcp start` subcommand (auto-detect disabled by default)
# Set MONOMIND_MCP_AUTODETECT=1 to restore legacy piped-stdin auto-detect behavior
claude mcp add monomind -- npx -y monomind@latest mcp start
npx monomind@latest doctor --fix
```

## Published npm Packages (authoritative roster)

**These 9 packages are real.** Each has exactly one source directory in this repo and is
the only correct thing to publish. Anything on the npm account that is not in this table
is not a live package — see "Deprecated aliases" below.

| npm name | Source directory | Role |
| --- | --- | --- |
| `monomind` | repo root | **Umbrella shim only** — no code of its own; pins and re-execs the CLI |
| `@monoes/monomindcli` | `packages/@monomind/cli/` | The real CLI engine (all commands, MCP server, `.claude` tree) |
| `@monoes/monograph` | `packages/@monomind/monograph/` | Knowledge graph |
| `@monoes/memory` | `packages/@monomind/memory/` | Memory backend library |
| `@monoes/hooks` | `packages/@monomind/hooks/` | Hook registry + 8 on-demand workers |
| `@monoes/mcp` | `packages/@monomind/mcp/` | MCP server framework |
| `@monoes/routing` | `packages/@monomind/routing/` | Semantic routing |
| `@monoes/monobrowse` | `packages/@monoes/monobrowse/` | CDP browser automation |
| `@monoes/monodesign` | `packages/@monoes/monodesign/` | Design intelligence |
| `monofence-ai` | `packages/monofence-ai/` | AI-manipulation defense |

### Deprecated aliases — never publish these again

- **`@monoes/monomind`** (last: 1.18.11) — stub that pinned `monomind` at an exact old version.
- **`@monoes/monofence-ai`** (last: 1.0.0) — stub that pinned `monofence-ai@1.0.0`.

Both were hand-published one-offs with no source directory here, both went stale, and both
are now `npm deprecate`d pointing at their unscoped counterparts. They are intentionally
left published (unpublishing would break anyone who pinned them). If you find yourself
about to publish a "scoped alias", don't — there is no such pattern in this repo.

### `monomind` is a shim, not a second copy of the CLI

Until 2.7.12, root `package.json` shipped the entire CLI payload (`dist/`, `bin/`,
`.claude/`) *in addition to* `@monoes/monomindcli` shipping the same thing — ~27 MB of
duplicate bytes per release, and two packages that had to be version-bumped in lockstep or
silently diverge. Root now ships only `bin/cli.js` + README + LICENSE (~11 kB) and declares
`"@monoes/monomindcli": "<exact version>"` as its single dependency.

Do not re-add `packages/@monomind/cli/**` to the root `files` array.

`bin/cli.js` resolves the CLI by scanning `require.resolve.paths()` on the filesystem
rather than calling `require.resolve()` on the package — the CLI's `exports` map gates
every specifier, and older published versions export `"."` with only an `import` condition,
which makes CJS `require.resolve()` throw `ERR_PACKAGE_PATH_NOT_EXPORTED`. The filesystem
scan keeps a new umbrella working against an older installed CLI.

## Publishing to npm

`monomind` is a shim that pins `@monoes/monomindcli` exactly. Two numbers must
agree, and the pin itself is generated — never hand-written:

- root `package.json` → `version`
- `packages/@monomind/cli/package.json` → `version`
- root `package.json` → `dependencies["@monoes/monomindcli"]` is **`workspace:*`**,
  which pnpm rewrites to the CLI's exact version when it builds the tarball

`npm run check:versions` (wired into root `prepublishOnly`) blocks the publish on
drift, on a hand-written pin, and on publishing root with the wrong tool.

**Publish root with `pnpm publish`, never `npm publish`.** npm does not understand
the workspace protocol — it copies package.json verbatim, so the published tarball
would depend on the literal string `workspace:*`, which no consumer can resolve.
Nothing looks wrong at publish time; the package simply installs for nobody. The
guard blocks this (override with `MONOMIND_ALLOW_NPM_PUBLISH=1` only if you are
certain). Only root is affected — it is the only package using the protocol.

**Publish the CLI before the umbrella,** and do not push the version bump until the
CLI is on npm: the pin resolves against the registry for anyone outside this
workspace, so a bump pushed early breaks CI with `ERR_PNPM_NO_MATCHING_VERSION`.

```bash
# 1. Bump the version in BOTH package.json files. Leave the pin alone.
#    Direct edit — `npm version` chokes on workspace:* protocol entries.
npm run check:versions          # verify before going further

# 2. Build + publish the CLI (the real payload)
cd packages/@monomind/cli && npm run build
npm publish --tag latest

# 3. Publish the umbrella shim from repo root — pnpm, not npm
cd ../../.. && pnpm publish --tag latest --no-git-checks

# Verify — these two must report the SAME version
npm view @monoes/monomindcli dist-tags --json
npm view monomind dist-tags --json
```

Publish the CLI **before** the umbrella: the umbrella pins the CLI exactly, so publishing
it first leaves a window where `npm i monomind` cannot resolve its own dependency.

Sub-packages (`@monoes/memory`, `@monoes/monograph`, …) version and publish independently
from their own directories — they are not part of the umbrella's lockstep.

## Support

- Documentation: https://github.com/monoes/monomind
- Issues: https://github.com/monoes/monomind/issues

---

Remember: **Monomind coordinates, Claude Code creates!**
