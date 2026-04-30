# Claude Code Configuration - Monomind v1.5

> **Monomind v1.0.0** (2026-01-20) — First releases of Monomind project extracting main skeleton from Claude Flow project
> Packages: `@monomind/cli@1.0.0`, `monomind@1.0.0`

## Behavioral Rules (Always Enforced)

- For swarm/hive-mind mode selection, use `/mastermind` — it presents all topologies and gives a concrete recommendation. Do NOT auto-prompt for swarm mode.
- For ANY UI testing, browser automation, or web navigation request: ALWAYS invoke `Skill("agent-browser-testing")` FIRST — no exceptions. The skill auto-installs agent-browser if missing.
- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (\*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

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
| `@monomind/hooks`    | `packages/@monomind/hooks/`    | 17 hooks + 12 workers                  |
| `@monomind/memory`   | `packages/@monomind/memory/`   | AgentDB + HNSW search                  |
| `@monomind/security` | `packages/@monomind/security/` | Input validation, CVE remediation      |

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

### 3-Tier Model Routing (ADR-026)

| Tier  | Handler              | Latency | Cost         | Use Cases                                              |
| ----- | -------------------- | ------- | ------------ | ------------------------------------------------------ |
| **1** | Agent Booster (WASM) | <1ms    | $0           | Simple transforms (var->const, add types) -- skip LLM  |
| **2** | Haiku                | ~500ms  | $0.0002      | Simple tasks, low complexity (<30%)                    |
| **3** | Sonnet/Opus          | 2-5s    | $0.003-0.015 | Complex reasoning, architecture, security (>30%)       |

- Check for `[AGENT_BOOSTER_AVAILABLE]` or `[TASK_MODEL_RECOMMENDATION]` before spawning agents
- Use Edit tool directly when `[AGENT_BOOSTER_AVAILABLE]`

### Anti-Drift Coding Swarm (PREFERRED DEFAULT)

- ALWAYS use hierarchical topology, maxAgents 6-8, specialized strategy
- Use `raft` consensus (leader maintains authoritative state)
- Run frequent checkpoints via `post-task` hooks
- Keep shared memory namespace for all agents

```javascript
mcp__ruv-swarm__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" });
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
2. Call `mcp__monomind__monograph_query` for targeted lookups ("what imports auth?", "what does UserService depend on?") — results include exact file path and line number
3. Call `mcp__monomind__monograph_god_nodes` to find high-centrality **internal** files (external/test symbols are automatically filtered)

**Why:** The knowledge graph encodes full dependency relationships, import chains, and architectural topology. It lets you understand the blast radius of a change and find all affected files without grepping the entire codebase.

**Available monograph tools:**

| Tool | Use when |
|---|---|
| `monograph_suggest` | Starting a task — get relevant files ranked by relevance |
| `monograph_query` | **Primary lookup** — find any symbol by keyword; returns `file` + `location` (line number) |
| `monograph_god_nodes` | Finding high-centrality **internal** files; automatically filters out external/test symbols |
| `monograph_shortest_path` | Understanding how two modules are connected |
| `monograph_stats` | Quick sanity check — how many nodes/edges indexed |
| `monograph_community` | Understanding which files form a cohesive module cluster |

**Skip monograph for:** single-file edits, doc/config changes, quick fixes where you already know the file.

**If `monograph_suggest` returns empty or errors:** the graph may not be built yet. Call `mcp__monomind__monograph_build` (codeOnly: true) — it runs in the background; proceed with normal Glob/Grep while it builds.

---

## Claude Code vs MCP Tools

**Claude Code handles ALL EXECUTION:** Task tool (agents), file ops (Read/Write/Edit/Glob/Grep), code generation, Bash, TodoWrite, git.

**MCP tools ONLY COORDINATE:** Swarm init, agent type definitions, task orchestration, memory management, neural features, performance tracking.

---

## CLI Commands (41 Commands)

| Command       | Sub | Description                                          |
| ------------- | --- | ---------------------------------------------------- |
| `init`        | 4   | Project initialization (wizard, presets, skills)     |
| `agent`       | 8   | Agent lifecycle (spawn, list, status, stop, metrics) |
| `swarm`       | 6   | Multi-agent swarm coordination                       |
| `memory`      | 11  | AgentDB with vector search (HNSW)                    |
| `mcp`         | 9   | MCP server management                                |
| `task`        | 6   | Task creation and lifecycle                          |
| `session`     | 7   | Session state management                             |
| `config`      | 7   | Configuration management                             |
| `hooks`       | 17  | Self-learning hooks + 12 background workers          |
| `hive-mind`   | 6   | Byzantine fault-tolerant consensus                   |
| `daemon`      | 5   | Background worker daemon                             |
| `neural`      | 5   | Neural pattern training                              |
| `security`    | 6   | Security scanning                                    |
| `performance` | 5   | Performance profiling                                |
| `plugins`     | 5   | Plugin management                                    |
| `deployment`  | 5   | Deployment management                                |
| `embeddings`  | 4   | Vector embeddings                                    |
| `claims`      | 4   | Claims-based authorization                           |
| `doctor`      | 1   | System diagnostics                                   |

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

## Available Agents (60+ Types)

- **Core:** coder, reviewer, tester, planner, researcher
- **Security:** security-architect, security-auditor, InputValidator, PathValidator, SafeExecutor
- **Swarm:** hierarchical-coordinator, mesh-coordinator, adaptive-coordinator, collective-intelligence-coordinator
- **Consensus:** byzantine-coordinator, raft-manager, gossip-coordinator, crdt-synchronizer, quorum-manager
- **Performance:** perf-analyzer, performance-benchmarker, task-orchestrator, memory-coordinator
- **GitHub:** github-modes, pr-manager, code-review-swarm, issue-tracker, release-manager, repo-architect
- **SPARC:** sparc-coord, sparc-coder, specification, pseudocode, architecture, refinement
- **Specialized:** backend-dev, mobile-dev, ml-developer, cicd-engineer, system-architect

## Hooks System

| Category         | Hooks                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| **Core**         | pre-edit, post-edit, pre-command, post-command, pre-task, post-task             |
| **Session**      | session-start, session-end, session-restore, notify                             |
| **Intelligence** | route, explain, pretrain, build-agents, transfer                                |
| **Learning**     | intelligence (trajectory-start/step/end, pattern-store/search, stats, attention)|
| **Agent Teams**  | teammate-idle, task-completed                                                   |

**12 Workers:** ultralearn, optimize, consolidate, predict, audit (critical), map, preload, deepdive, document, refactor, benchmark, testgaps.

## Hive-Mind Consensus

**Topologies:** hierarchical, mesh, hierarchical-mesh (recommended), adaptive.
**Strategies:** byzantine (f < n/3), raft (f < n/2), gossip, crdt, quorum.

## Project Configuration (Anti-Drift Defaults)

Topology: hierarchical | Max Agents: 8 | Strategy: specialized | Consensus: raft | Memory: hybrid (SQLite + AgentDB) | HNSW: enabled | Neural: SONA enabled.

## Quick Setup

```bash
claude mcp add monomind npx monomind@latest mcp start
npx monomind@latest daemon start
npx monomind@latest doctor --fix
```

## Publishing to npm

MUST publish ALL THREE packages: `@monomind/cli`, `monomind` (umbrella), `monomind` (alias).

```bash
# 1. Build and publish CLI
cd packages/@monomind/cli && npm version 3.0.0-alpha.XXX --no-git-tag-version && npm run build
npm publish --tag alpha && npm dist-tag add @monomind/cli@3.0.0-alpha.XXX latest

# 2. Publish monomind umbrella
cd /workspaces/monomind && npm version 3.0.0-alpha.XXX --no-git-tag-version && npm publish --tag latest
npm dist-tag add monomind@3.0.0-alpha.XXX latest && npm dist-tag add monomind@3.0.0-alpha.XXX alpha

# 3. Publish monomind alias umbrella
cd /workspaces/monomind/monomind && npm version 3.0.0-alpha.XXX --no-git-tag-version
npm publish --tag alpha && npm dist-tag add monomind@3.0.0-alpha.XXX latest

# Verify ALL THREE
npm view @monomind/cli dist-tags --json
npm view monomind dist-tags --json
npm view monomind dist-tags --json
```

- Never forget the `monomind` package (thin wrapper, `npx monomind@alpha`)
- `monomind` source is in `/monomind/` -- depends on `@monomind/cli`

## Plugins

Distributed via IPFS/Pinata. Registry CID in `packages/@monomind/cli/src/plugins/store/discovery.ts`.

```bash
npx monomind@latest plugins list      # Browse available
npx monomind@latest plugins install @monomind/plugin-name
npx monomind@latest plugins create my-plugin  # Development
```

See CLAUDE.local.md for registry maintenance procedures.

## Support

- Documentation: https://github.com/nokhodian/monomind
- Issues: https://github.com/nokhodian/monomind/issues

---

Remember: **Monomind coordinates, Claude Code creates!**
