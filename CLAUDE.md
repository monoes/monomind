# Claude Code Configuration - Monomind v1.5

> **Monomind v1.0.0** (2026-01-20) — First releases of Monomind project extracting main skeleton from Claude Flow project
> Packages: `@monomind/cli@1.0.0`, `monomind@1.0.0`

## Behavioral Rules (Always Enforced)

- For swarm/hive-mind mode selection, use `/mastermind` — it presents all topologies and gives a concrete recommendation. Do NOT auto-prompt for swarm mode.
- For ANY UI testing, browser automation, or web navigation request: ALWAYS invoke `Skill("agent-browser-testing")` FIRST — no exceptions. Uses native `monomind browse` CDP client — no external binary needed.
- NEVER use `mcp__claude-in-chrome__*`, `mcp__plugin_playwright__*`, `mcp__playwright__*`, Playwright, Puppeteer, Selenium, or any external browser tool for web browsing. ALWAYS use `npx monomind browse`. This rule has no exceptions — not even "just this once".
- For ANY web animation, motion graphics, or animation request: ALWAYS invoke `Skill("monomotion")` FIRST — no exceptions. This includes: "animate this", "add animation", "create an animation", "motion graphics", "animated intro/outro", "text animation", "scroll animation", "GSAP".
- For ANY frontend design, UI improvement, design critique, design system, brand identity, UX research, visual storytelling, image generation for design, component systems, or CSS architecture task: ALWAYS invoke `Skill("monodesign")` FIRST — no exceptions. This is the ONLY design agent — there are no separate UI Designer, UX Architect, UX Researcher, Brand Guardian, Visual Storyteller, Whimsy Injector, Image Prompt Engineer, or Inclusive Visuals agents anymore. All design intelligence is in monodesign. This includes: "design this", "redesign", "improve the UI", "add polish", "make it look better", "audit the design", "critique the UI", "fix the layout", "colorize", "typeset", "design system", "design tokens", "antipattern", "brand identity", "brand strategy", "ux research", "user research", "usability test", "persona", "component system", "css architecture", "theme toggle", "dark mode", "image prompt", "hero image", "generate image", "whimsy", "delight", "visual narrative", "inclusive design".
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

## File Organization

- NEVER save to root folder — use the directories below
- Use `/src` for source code files
- Use `/tests` for test files
- Use `/docs` for documentation and markdown files
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- Use `/examples` for example code

## Project Architecture

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Key Packages

| Package               | Path                            | Purpose                                |
| --------------------- | ------------------------------- | -------------------------------------- |
| `@monomind/cli`      | `packages/@monomind/cli/`      | CLI entry point (41 commands)          |
| `@monomind/guidance` | `packages/@monomind/guidance/` | Governance control plane               |
| `@monomind/hooks`    | `packages/@monomind/hooks/`    | 26 hook subcommands + 11 workers (perf/health/swarm/git/learning/adr/ddd/security/patterns/cache/progress) |
| `@monomind/memory`   | `packages/@monomind/memory/`   | LanceDB + HNSW search                  |
| `@monomind/security` | `packages/@monomind/security/` | Input validation, path security        |
| `@monomind/mcp`      | `packages/@monomind/mcp/`      | MCP server framework (HTTP/WS transport) |
| `@monomind/routing`  | `packages/@monomind/routing/`  | Semantic routing (embedding + keyword cascade) |
| `@monoes/monobrowse` | `packages/@monoes/monobrowse/` | Browser automation via CDP (standalone)|
| `@monoes/monograph`  | `packages/@monoes/monograph/`  | Knowledge graph (tree-sitter + SQLite) |
| `monofence-ai`       | `packages/monofence-ai/`       | Security guardrails middleware         |

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

Use `/mastermind` to pick a swarm or hive-mind topology. It lists all options and gives a concrete recommendation for the current task. Do not auto-prompt or interrupt work to ask about swarm mode.

---

## Knowledge Graph — Monograph (Use Before Codebase Exploration)

**When starting any task that touches 3+ files, introduces a new feature, or requires understanding a module you haven't worked in recently:**

1. Call `mcp__monomind__monograph_suggest` first — it returns the most relevant files and relationships for your task description
2. Call `mcp__monomind__monograph_query` for targeted lookups ("what imports auth?", "what does UserService depend on?") — results include exact file path and line number. PPR graph reranking is on by default (HippoRAG-style, boosts neighbors of top hits for better related-code discovery); pass `rerank: false` to disable
3. Call `mcp__monomind__monograph_god_nodes` to find high-centrality **internal** files (external/test symbols are automatically filtered)

**Why:** The knowledge graph encodes full dependency relationships, import chains, and architectural topology. It lets you understand the blast radius of a change and find all affected files without grepping the entire codebase.

**Available monograph tools (44 total):**

### Core Navigation (use these first)

| Tool | Use when |
|---|---|
| `monograph_suggest` | **Start every task** — returns ambiguous edges, bridge nodes, isolated nodes ranked by task relevance |
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
| `monograph_shortest_path` | Understanding how two modules are connected |
| `monograph_shape_check` | Validate API route response shapes — handler return keys vs consumer property accesses |
| `monograph_route_map` | List all HTTP routes with handler info; filter by URL prefix or method |

### Dead Code & Stale Artifacts

| Tool | Use when |
|---|---|
| `monograph_dead_code` | **Stale hunt** — finds dead exported functions, orphan files with no importers, and stale dist build artifacts. Categories: `dead-functions`, `orphan-files`, `stale-dist`. Verifies candidates against source before reporting. |

### Graph Exploration

| Tool | Use when |
|---|---|
| `monograph_community` | Understanding which files form a cohesive module cluster |
| `monograph_cypher` | Ad-hoc read-only Cypher MATCH queries against the graph |
| `monograph_surprises` | Unexpected cross-community or low-confidence edges |
| `monograph_rename` | Dry-run multi-file rename — finds all graph + text occurrences |
| `monograph_tool_map` | List MCP/RPC tool definitions with handler associations |

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
| `monograph_embed` | Embed all symbol nodes (384D, requires `@huggingface/transformers`) — enables hybrid BM25+vector search |

### Snapshots & Export

| Tool | Use when |
|---|---|
| `monograph_snapshot` | Save current graph state to a named JSON snapshot for before/after diffing |
| `monograph_diff` | Compare two named snapshots (or live graph vs snapshot) |
| `monograph_report` | Generate GRAPH_REPORT.md with top nodes |
| `monograph_export` | Export: json, svg, graphml, cypher, obsidian, canvas |
| `monograph_visualize` | Render interactive HTML graph (Sigma.js), SVG, or JSON |
| `monograph_serve` | Start web UI server for interactive graph visualization |

### Wiki & AI Docs

| Tool | Use when |
|---|---|
| `monograph_wiki` | Retrieve LLM-generated wiki pages for code communities |
| `monograph_wiki_build` | Generate wiki pages for communities using Anthropic API |
| `monograph_skill_gen` | Generate per-community skill files for AI navigation |
| `monograph_inject_context` | Inject monograph capabilities into AGENTS.md / CLAUDE.md |
| `monograph_install_skills` | Install skill files for IDE/platform (claude, cursor, vscode, zed) |

### Multi-Repo / Group

| Tool | Use when |
|---|---|
| `monograph_list_repos` | List all repos tracked in the global monograph registry |
| `monograph_group_list` | List repos in a group.yaml with index metadata |
| `monograph_group_query` | BM25 search merged across all repos in a group (RRF-ranked) |
| `monograph_group_contracts` | List public API contracts (exported symbols/interfaces/types) for a group |
| `monograph_group_status` | Health status for all groups: indexed, has contracts, recently synced |
| `monograph_group_sync` | Scan and rebuild all repos in a group |

**Skip monograph for:** single-file edits, doc/config changes, quick fixes where you already know the file.

**If `monograph_suggest` returns empty or errors:** the graph may not be built yet. Call `mcp__monomind__monograph_build` (codeOnly: true) — it runs in the background; proceed with normal Glob/Grep while it builds.

---

## Claude Code vs MCP Tools

**Claude Code handles ALL EXECUTION:** Task tool (agents), file ops (Read/Write/Edit/Glob/Grep), code generation, Bash, TodoWrite, git.

**MCP tools ONLY COORDINATE:** Swarm init, agent type definitions, task orchestration, memory management, neural features, performance tracking.

---

## CLI Commands (41 Commands)

| Command          | Sub | Description                                          |
| ---------------- | --- | ---------------------------------------------------- |
| `init`           | 4   | Project initialization (wizard, presets, skills)     |
| `start`          | -   | Start MCP server or daemon                           |
| `status`         | 3   | System status monitoring with watch mode             |
| `agent`          | 8   | Agent lifecycle (spawn, list, status, stop, metrics) |
| `swarm`          | 6   | Multi-agent swarm coordination                       |
| `memory`         | 11  | LanceDB with vector search (HNSW)                    |
| `mcp`            | 9   | MCP server management                                |
| `task`           | 6   | Task creation and lifecycle                          |
| `session`        | 7   | Session state management                             |
| `config`         | 7   | Configuration management                             |
| `hooks`          | 26  | Self-learning hooks + 11 background workers (@monomind/hooks WorkerManager) |
| `hive-mind`      | 6   | BFT/Raft/Quorum vote counting (single-process)      |
| `daemon`         | 5   | Background worker daemon (12 workers)                |
| `neural`         | 5   | Pattern storage and similarity search                |
| `security`       | 6   | Security scanning                                    |
| `performance`    | 5   | Performance profiling                                |
| `guidance`       | 7   | Governance control plane (compile, gates, optimize)  |
| `monograph`      | -   | Knowledge graph CLI (delegates to @monoes/monograph) |
| `browse`         | -   | Browser automation via CDP (@monoes/monobrowse)      |
| `workflow`       | 6   | Workflow execution and template management           |
| `claims`         | 4   | Claims-based authorization                           |
| `doctor`         | 1   | System diagnostics                                   |
| `cleanup`        | -   | Project cleanup utilities                            |
| `autopilot`      | -   | Autonomous task execution                            |
| `analyze`        | -   | Codebase analysis                                    |
| `route`          | -   | Task routing                                         |
| `providers`      | 5   | AI provider management                               |
| `search`         | -   | Universal search                                     |
| `scan`           | -   | Security/code scanning                               |
| `doc`            | -   | Documentation generation                             |
| `design`         | -   | Design detection and routing                         |
| `enrich`         | -   | Context enrichment                                   |
| `tokens`         | -   | Token counting                                       |
| `platforms`      | -   | Platform management                                  |
| `issues`         | -   | Issue tracking                                       |
| `completions`    | 4   | Shell completions (bash, zsh, fish, powershell)      |
| `replay`         | -   | Session replay                                       |
| `transfer-store` | -   | Pattern transfer between projects                    |
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

**Hooks:** `TeammateIdle` (auto-assign tasks), `TaskCompleted` (train patterns, notify lead).

## Available Agents (13 Core Types, 60+ Routing Target Definitions)

- **Core:** coder, reviewer, tester, planner, researcher
- **Security:** security-architect, security-auditor
- **Swarm:** hierarchical-coordinator, mesh-coordinator, adaptive-coordinator, collective-intelligence-coordinator
- **Consensus:** byzantine-coordinator, raft-manager, gossip-coordinator, crdt-synchronizer, quorum-manager
- **Performance:** perf-analyzer, performance-benchmarker, task-orchestrator, memory-coordinator
- **GitHub:** github-modes, pr-manager, code-review-swarm, issue-tracker, release-manager, repo-architect
- **SPARC:** sparc-coord, sparc-coder, specification, pseudocode, architecture, refinement
- **Specialized:** backend-dev, mobile-dev, ml-developer, cicd-engineer, system-architect

Note: @monomind/security provides input validation (Zod schemas), path traversal prevention, and command injection protection as utility functions, not standalone agent classes.

## Hooks System

| Category         | Hooks                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| **Core**         | pre-edit, post-edit, pre-command, post-command, pre-task, post-task             |
| **Session**      | session-start, session-end, session-restore, notify                             |
| **Intelligence** | route, explain, pretrain, build-agents, transfer                                |
| **Learning**     | intelligence (trajectory-start/step/end, pattern-store/search, stats, attention)|
| **Agent Teams**  | teammate-idle, task-completed (Claude Code hook events, not CLI subcommands)    |

**Daemon — 12 Workers** (`packages/@monomind/cli` daemon system): ultralearn, optimize, consolidate, predict, audit (critical), map, preload, deepdive, document, refactor, benchmark, testgaps.

**Hooks — 11 Workers** (`@monomind/hooks` WorkerManager, separate system): performance, health, swarm, git, learning, adr, ddd, security, patterns, cache, progress.

## Hive-Mind Consensus

**Topologies:** hierarchical, mesh, hierarchical-mesh (recommended), adaptive.
**Strategies:** byzantine (f < n/3), raft (f < n/2), quorum. Gossip and CRDT are planned but not yet implemented.

## Project Configuration (Anti-Drift Defaults)

Topology: hierarchical | Max Agents: 8 | Strategy: specialized | Consensus: raft | Routing: keyword + route-outcomes | Memory: hybrid (SQLite + LanceDB) | HNSW: pure-JS via LanceDB.

## Quick Setup

```bash
# MCP mode requires explicit `mcp start` subcommand (auto-detect disabled by default)
# Set MONOMIND_MCP_AUTODETECT=1 to restore legacy piped-stdin auto-detect behavior
claude mcp add monomind npx monomind@latest mcp start
npx monomind@latest daemon start
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
