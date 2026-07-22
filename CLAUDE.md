# Claude Code Configuration - Monomind v2

> **Monomind v2.5.5** — Packages: `monomind@2.5.5` (umbrella), `@monoes/monomindcli@2.5.5` (CLI), `@monoes/monograph@1.4.1` (knowledge graph)

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
| `@monoes/hooks`    | `packages/@monomind/hooks/`    | Hook registry/executor library + 15 background workers (perf/health/swarm/git/learning/adr/ddd/security/patterns/cache/progress/map/audit/optimize/consolidate); bridged from `.claude/helpers` (session-start workers + security) and started by the CLI MCP server |
| `@monoes/memory`     | `packages/@monomind/memory/`   | Lower-level memory backend library (SQLite/JSON pattern-store implementations) dynamically imported by the CLI's bridge — the live bridge itself (`memory-bridge.ts`, `hnsw-operations.ts`) lives in `packages/@monomind/cli/src/memory/`, not here. Default engine: local SQLite with embedded vectors (better-sqlite3, sql.js WASM fallback; local HF-embeddings) — backs CLI `memory store/search`, the MCP memory tools, and the Second Brain. LanceDB was removed 2026-07 (≈600MB of native deps for no measured value); pure-JS HNSW stays off the default search path (reachable via `memory search --build-hnsw`) |
| `@monoes/mcp`      | `packages/@monomind/mcp/`      | MCP server framework — powers `mcp start -t http`/`-t websocket` (and stdio/in-process transports) only; the *default* stdio transport that `claude mcp add monomind -- npx -y monomind@latest mcp start` wires up is a separate, hand-rolled JSON-RPC loop inside the CLI package itself (`mcp-server.ts`'s `startStdioServer()`), which never imports this package. Also provides session/connection/resource/prompt/task management, rate limiting, OAuth, and sampling; its own built-in tool registry is small (4 tools) — real usage hands it the CLI's actual tool roster |
| `@monoes/routing`  | `packages/@monomind/routing/`  | Semantic routing (`RouteLayer`: keyword pre-filter → real embedding via an isolated worker process — kept out-of-process specifically because loading `onnxruntime` in-process causes SIGSEGVs — → cosine similarity → Haiku LLM fallback below threshold). **Opt-in only** — reached via `route semantic`, `agent --task`, or MCP `hooks_route_semantic`. Bare `monomind route "task"` does **not** use this package: it runs a lightweight keyword-only stub (`createKeywordRouter`, fixed 0.75 confidence, 8 hardcoded categories, no embeddings) in the CLI package itself — this is what the Anti-Drift Defaults "Routing: keyword + route-outcomes" line below describes |
| `@monoes/monobrowse` | `packages/@monoes/monobrowse/` | Browser automation via CDP (standalone)|
| `@monoes/monodesign` | `packages/@monoes/monodesign/` | Frontend design intelligence (tokens, antipattern detection, monodesign skill) |
| `@monoes/monograph`  | `packages/@monomind/monograph/` | Knowledge graph (tree-sitter + SQLite) |
| `monofence-ai`       | `packages/monofence-ai/`       | Independent AI-manipulation-defense library (~1,544 lines: threat/evasion detection, multi-turn context tracking, output scanning, ReasoningBank-style learning) — wired into the live pre-bash/pre-write gate path via its own lazy-loaded integration in `.claude/helpers/handlers/gates-handler.cjs` (`MONOMIND_MONOFENCE_GATE=off` to disable), not via its `registerSecurityHooks()` API (that's consumed only by the in-process `@monoes/hooks` `HookExecutor`, a separate mechanism from the live CJS dispatch path) |

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
| `hooks`          | 29  | Self-learning hooks + 15 background workers (14 configured + always-on progress) (@monoes/hooks WorkerManager) |
| `security`       | 6   | Security scanning: scan, cve, audit, secrets, defend, redteam. `audit`'s `--action export/log/clear` are unimplemented (list-only); `redteam`'s live `--target` execution is unimplemented (`--dry-run` only) |
| `performance`    | 4   | Performance profiling — real benchmark measurements  |
| `guidance`       | 1   | Wire enforcement gates into Claude Code hooks (setup) |
| `org`            | 16  | SDK org runtime v2 — daemon-controlled agent orgs (run [--dry-run], stop, status, serve, test-loop, logs, report, memory [stats\|search\|rules\|rollback], questions, answer, create, validate, migrate, list, delete, mark-complete) |
| `monograph`      | -   | Knowledge graph CLI (delegates to @monoes/monograph) |
| `browse`         | -   | Browser automation via CDP (@monoes/monobrowse)      |
| `doctor`         | 1   | System diagnostics                                   |
| `cleanup`        | -   | Project cleanup utilities                            |
| `autopilot`      | -   | Autonomous task execution                            |
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

## Available Agents (32 definitions in `.claude/agents/`: 30 curated below + 2 non-roster — `templates/coordinator-swarm-init.md` and `generated/dashboard-verifier.md`)

- **Core:** coder, coordinator, planner, researcher, reviewer, tester
- **Engineering:** ai-engineer, backend-architect, code-reviewer, devops-automator, frontend-developer, security-engineer, software-architect, technical-writer
- **GitHub:** github-modes, pr-manager, code-review-swarm, issue-tracker, release-manager, repo-architect
- **Swarm / Hive-Mind:** mesh-coordinator, collective-intelligence-coordinator, queen-coordinator
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

**Hooks — 15 Workers** (`@monoes/hooks` WorkerManager): performance, health, swarm, git, learning, adr, ddd, security, patterns, cache, progress, map, audit, optimize, consolidate — 14 come from the static worker config, plus the always-on `progress` worker. The metrics-producing workers (ddd, map, audit, optimize, consolidate) refresh automatically at session start when their `.monomind/metrics/*.json` output is missing or older than 6 hours; run any worker on demand with `monomind hooks worker run <name>`. (The former standalone worker daemon and its headless-only workers were deleted.)

## Hive-Mind Consensus

**Status: Experimental — single-process vote counting, not distributed consensus.**

**Topologies:** hierarchical, mesh, hierarchical-mesh (recommended), adaptive.
**Strategies:** byzantine (f < n/3), raft (f < n/2), quorum. Gossip and CRDT are planned but not yet implemented.

## Project Configuration (Anti-Drift Defaults)

Topology: hierarchical | Max Agents: 8 | Strategy: specialized | Consensus: raft | Routing: keyword + route-outcomes | Memory: JSON patterns + local SQLite/embeddings (see Key Packages table).

## Quick Setup

```bash
# MCP mode requires explicit `mcp start` subcommand (auto-detect disabled by default)
# Set MONOMIND_MCP_AUTODETECT=1 to restore legacy piped-stdin auto-detect behavior
claude mcp add monomind -- npx -y monomind@latest mcp start
npx monomind@latest doctor --fix
```

## Publishing to npm

Publish two packages: `@monoes/monomindcli` (scoped CLI) and `monomind` (umbrella from repo root).

```bash
# 1. Bump version in BOTH package.json files (root + packages/@monomind/cli)
#    Direct edit — `npm version` chokes on workspace:* protocol entries

# 2. Build CLI
cd packages/@monomind/cli && npm run build

# 3. Publish scoped CLI
npm publish --tag latest

# 4. Publish umbrella from repo root
cd ../../.. && npm publish --tag latest

# Verify
npm view @monoes/monomindcli dist-tags --json
npm view monomind dist-tags --json
```

## Support

- Documentation: https://github.com/monoes/monomind
- Issues: https://github.com/monoes/monomind/issues

---

Remember: **Monomind coordinates, Claude Code creates!**
