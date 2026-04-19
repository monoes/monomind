# Claude Code Configuration - Monobrain v1.5

> **Monobrain v1.0.0** (2026-01-20) — First releases of Monobrain project extracting main skeleton from Claude Flow project
> Packages: `@monobrain/cli@1.0.0`, `monobrain@1.0.0`

## Behavioral Rules (Always Enforced)

- **`[SWARM_ASK_USER]` in any system-reminder = MANDATORY user prompt before proceeding.** Present all 3 options (Normal / Swarm / Hive-Mind) clearly, state the recommended one with ★, and wait for the user's choice. Once the user replies, execute immediately without asking again.
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
| `@monobrain/cli`      | `packages/@monobrain/cli/`      | CLI entry point (35 commands)          |
| `@monobrain/guidance` | `packages/@monobrain/guidance/` | Governance control plane               |
| `@monobrain/hooks`    | `packages/@monobrain/hooks/`    | 29 hooks + 12 workers                  |
| `@monobrain/memory`   | `packages/@monobrain/memory/`   | AgentDB + HNSW search                  |

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

### MANDATORY: Swarm Mode Prompt Protocol

**When you see `[SWARM_ASK_USER]` in a system-reminder, you MUST ask the user before doing any work.**

Present exactly these 3 options in your reply:

> This task has complexity **X/7**. Which execution mode would you like?
>
> **A)** Normal — single agent (fastest, no coordination overhead)  
> **★ B)** Swarm — hierarchical, 6 agents, specialized roles  
> **★ C)** Hive-Mind — queen-led, `<consensus>` consensus, fault-tolerant  
>
> _(★ = recommended for this complexity)_

Rules:
- Do NOT start working before the user answers.
- Once the user picks A/B/C (or describes a preference), execute immediately without re-asking.
- If the user picks B: call `mcp__monobrain__swarm_init` + spawn agents in ONE message, then proceed.
- If the user picks C: call `mcp__monobrain__hive-mind_init` + spawn agents in ONE message, then proceed.
- If no `[SWARM_ASK_USER]` signal but task clearly touches 3+ files or is a new feature: still ask.

**SKIP asking for:** single-file edits, doc/config changes, quick questions.

---

## Claude Code vs MCP Tools

**Claude Code handles ALL EXECUTION:** Task tool (agents), file ops (Read/Write/Edit/Glob/Grep), code generation, Bash, TodoWrite, git.

**MCP tools ONLY COORDINATE:** Swarm init, agent type definitions, task orchestration, memory management, neural features, performance tracking.

---

## CLI Commands (35 Commands)

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
| `hooks`       | 29  | Self-learning hooks + 12 background workers          |
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

Enabled via `npx monobrain@latest init` (sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).

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
- **Security:** security-architect, security-auditor
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
claude mcp add monobrain npx monobrain@latest mcp start
npx monobrain@latest daemon start
npx monobrain@latest doctor --fix
```

## Publishing to npm

MUST publish ALL THREE packages: `@monobrain/cli`, `monobrain` (umbrella), `monobrain` (alias).

```bash
# 1. Build and publish CLI
cd packages/@monobrain/cli && npm version 3.0.0-alpha.XXX --no-git-tag-version && npm run build
npm publish --tag alpha && npm dist-tag add @monobrain/cli@3.0.0-alpha.XXX latest

# 2. Publish monobrain umbrella
cd /workspaces/monobrain && npm version 3.0.0-alpha.XXX --no-git-tag-version && npm publish --tag latest
npm dist-tag add monobrain@3.0.0-alpha.XXX latest && npm dist-tag add monobrain@3.0.0-alpha.XXX alpha

# 3. Publish monobrain alias umbrella
cd /workspaces/monobrain/monobrain && npm version 3.0.0-alpha.XXX --no-git-tag-version
npm publish --tag alpha && npm dist-tag add monobrain@3.0.0-alpha.XXX latest

# Verify ALL THREE
npm view @monobrain/cli dist-tags --json
npm view monobrain dist-tags --json
npm view monobrain dist-tags --json
```

- Never forget the `monobrain` package (thin wrapper, `npx monobrain@alpha`)
- `monobrain` source is in `/monobrain/` -- depends on `@monobrain/cli`

## Plugins

Distributed via IPFS/Pinata. Registry CID in `packages/@monobrain/cli/src/plugins/store/discovery.ts`.

```bash
npx monobrain@latest plugins list      # Browse available
npx monobrain@latest plugins install @monobrain/plugin-name
npx monobrain@latest plugins create my-plugin  # Development
```

See CLAUDE.local.md for registry maintenance procedures.

## Support

- Documentation: https://github.com/nokhodian/monobrain
- Issues: https://github.com/nokhodian/monobrain/issues

---

Remember: **Monobrain coordinates, Claude Code creates!**
