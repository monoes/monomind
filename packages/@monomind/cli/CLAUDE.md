# Claude Code Configuration - Monomind v2.0

## Skill Auto-Invocation Rules

- For ANY web animation, motion graphics, or animation request: ALWAYS invoke `Skill("monomotion")` FIRST — no exceptions.
- For ANY UI testing, browser automation, or web navigation request: ALWAYS invoke `Skill("agent-browser-testing")` FIRST — no exceptions.
- NEVER use `mcp__claude-in-chrome__*`, `mcp__plugin_playwright__*`, `mcp__playwright__*`, Playwright, Puppeteer, Selenium, or any external browser tool. ALWAYS use `npx monomind browse`. This rule has no exceptions.

## 🚨 AUTOMATIC SWARM ORCHESTRATION

**When starting work on complex tasks, Claude Code MUST automatically:**

1. **Initialize the swarm** using CLI tools via Bash
2. **Spawn concurrent agents** using Claude Code's Task tool
3. **Coordinate via hooks** and memory

### 🚨 CRITICAL: CLI + Task Tool in SAME Message

**When user says "spawn swarm" or requests complex work, Claude Code MUST in ONE message:**

1. Call CLI tools via Bash to initialize coordination
2. **IMMEDIATELY** call Task tool to spawn REAL working agents
3. Both CLI and Task calls must be in the SAME response

**CLI coordinates, Task tool agents do the actual work!**

### 🛡️ Anti-Drift Config (PREFERRED)

**Use this to prevent agent drift:**

```bash
# Small teams (6-8 agents) - use hierarchical for tight control
npx monomind@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized

# Large teams (10-15 agents) - use hierarchical-mesh for V1 queen + peer communication
npx monomind@latest swarm init --topology hierarchical-mesh --max-agents 15 --strategy specialized
```

**Valid Topologies:**

- `hierarchical` - Queen controls workers directly (anti-drift for small teams)
- `hierarchical-mesh` - V1 queen + peer communication (recommended for 10+ agents)
- `mesh` - Fully connected peer network
- `ring` - Circular communication pattern
- `star` - Central coordinator with spokes
- `hybrid` - Dynamic topology switching

**Anti-Drift Guidelines:**

- **hierarchical**: Coordinator catches divergence
- **max-agents 6-8**: Smaller team = less drift
- **specialized**: Clear roles, no overlap
- **consensus**: raft (leader maintains state)

---

### 🔄 Auto-Start Swarm Protocol (Background Execution)

When the user requests a complex task, **spawn agents in background and WAIT for completion:**

```javascript
// STEP 1: Initialize swarm coordination (anti-drift config)
Bash(
  "npx monomind@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized",
);

// STEP 2: Spawn ALL agents IN BACKGROUND in a SINGLE message
// Use run_in_background: true so agents work concurrently
Task({
  prompt:
    "Research requirements, analyze codebase patterns, store findings in memory",
  subagent_type: "researcher",
  description: "Research phase",
  run_in_background: true, // ← CRITICAL: Run in background
});
Task({
  prompt: "Design architecture based on research. Document decisions.",
  subagent_type: "system-architect",
  description: "Architecture phase",
  run_in_background: true,
});
Task({
  prompt: "Implement the solution following the design. Write clean code.",
  subagent_type: "coder",
  description: "Implementation phase",
  run_in_background: true,
});
Task({
  prompt: "Write comprehensive tests for the implementation.",
  subagent_type: "tester",
  description: "Testing phase",
  run_in_background: true,
});
Task({
  prompt: "Review code quality, security, and best practices.",
  subagent_type: "reviewer",
  description: "Review phase",
  run_in_background: true,
});

// STEP 3: WAIT - Tell user agents are working, then STOP
// Say: "I've spawned 5 agents to work on this in parallel. They'll report back when done."
// DO NOT check status repeatedly. Just wait for user or agent responses.
```

### ⏸️ CRITICAL: Spawn and Wait Pattern

**After spawning background agents:**

1. **TELL USER** - "I've spawned X agents working in parallel on: [list tasks]"
2. **STOP** - Do not continue with more tool calls
3. **WAIT** - Let the background agents complete their work
4. **RESPOND** - When agents return results, review and synthesize

**Example response after spawning:**

```
I've launched 5 concurrent agents to work on this:
- 🔍 Researcher: Analyzing requirements and codebase
- 🏗️ Architect: Designing the implementation approach
- 💻 Coder: Implementing the solution
- 🧪 Tester: Writing tests
- 👀 Reviewer: Code review and security check

They're working in parallel. I'll synthesize their results when they complete.
```

### 🚫 DO NOT:

- Continuously check swarm status
- Poll TaskOutput repeatedly
- Add more tool calls after spawning
- Ask "should I check on the agents?"

### ✅ DO:

- Spawn all agents in ONE message
- Tell user what's happening
- Wait for agent results to arrive
- Synthesize results when they return

## 🧠 AUTO-LEARNING PROTOCOL

### Before Starting Any Task

```bash
# 1. Search memory for relevant patterns from past successes
Bash("npx monomind@latest memory search --query '[task keywords]' --namespace patterns")

# 2. Check if similar task was done before
Bash("npx monomind@latest memory search --query '[task type]' --namespace tasks")

# 3. Load learned optimizations
Bash("npx monomind@latest hooks route --task '[task description]'")
```

### After Completing Any Task Successfully

```bash
# 1. Store successful pattern for future reference
Bash("npx monomind@latest memory store --namespace patterns --key '[pattern-name]' --value '[what worked]'")

# 2. Train neural patterns on the successful approach
Bash("npx monomind@latest hooks post-edit --file '[main-file]' --train-neural true")

# 3. Record task completion with metrics
Bash("npx monomind@latest hooks post-task --task-id '[id]' --success true --store-results true")

# 4. Trigger optimization worker if performance-related
Bash("npx monomind@latest hooks worker run optimize")
```

### Continuous Improvement Triggers

| Trigger                | Worker        | When to Use              |
| ---------------------- | ------------- | ------------------------ |
| After major refactor   | `optimize`    | Performance snapshot     |
| After security changes | `audit`       | Security analysis        |
| Every 5+ file changes  | `map`         | Update codebase map      |
| After heavy sessions   | `consolidate` | Memory consolidation     |

### Memory-Enhanced Development

**ALWAYS check memory before:**

- Starting a new feature (search for similar implementations)
- Debugging an issue (search for past solutions)
- Refactoring code (search for learned patterns)
- Performance work (search for optimization strategies)

**ALWAYS store in memory after:**

- Solving a tricky bug (store the solution pattern)
- Completing a feature (store the approach)
- Finding a performance fix (store the optimization)
- Discovering a security issue (store the vulnerability pattern)

### 📋 Agent Routing (Anti-Drift)

| Code | Task        | Agents                                          |
| ---- | ----------- | ----------------------------------------------- |
| 1    | Bug Fix     | coordinator, researcher, coder, tester          |
| 3    | Feature     | coordinator, architect, coder, tester, reviewer |
| 5    | Refactor    | coordinator, architect, coder, reviewer         |
| 7    | Performance | coordinator, perf-engineer, coder               |
| 9    | Security    | coordinator, security-architect, auditor        |
| 11   | Docs        | researcher, api-docs                            |

**Codes 1-9: hierarchical/specialized (anti-drift). Code 11: mesh/balanced**

### 🎯 Task Complexity Detection

**AUTO-INVOKE SWARM when task involves:**

- Multiple files (3+)
- New feature implementation
- Refactoring across modules
- API changes with tests
- Security-related changes
- Performance optimization
- Database schema changes

**SKIP SWARM for:**

- Single file edits
- Simple bug fixes (1-2 lines)
- Documentation updates
- Configuration changes
- Quick questions/exploration

## 🚨 CRITICAL: CONCURRENT EXECUTION & FILE MANAGEMENT

**ABSOLUTE RULES**:

1. ALL operations MUST be concurrent/parallel in a single message
2. **NEVER save working files, text/mds and tests to the root folder**
3. ALWAYS organize files in appropriate subdirectories
4. **USE CLAUDE CODE'S TASK TOOL** for spawning agents concurrently, not just MCP

### ⚡ GOLDEN RULE: "1 MESSAGE = ALL RELATED OPERATIONS"

**MANDATORY PATTERNS:**

- **TodoWrite**: ALWAYS batch ALL todos in ONE call (5-10+ todos minimum)
- **Task tool (Claude Code)**: ALWAYS spawn ALL agents in ONE message with full instructions
- **File operations**: ALWAYS batch ALL reads/writes/edits in ONE message
- **Bash commands**: ALWAYS batch ALL terminal operations in ONE message
- **Memory operations**: ALWAYS batch ALL memory store/retrieve in ONE message

### 📁 File Organization Rules

**NEVER save to root folder. Use these directories:**

- `/src` - Source code files
- `/tests` - Test files
- `/docs` - Documentation and markdown files
- `/config` - Configuration files
- `/scripts` - Utility scripts
- `/examples` - Example code

## Project Config (Anti-Drift Defaults)

- **Topology**: hierarchical (prevents drift)
- **Max Agents**: 8 (smaller = less drift)
- **Strategy**: specialized (clear roles)
- **Consensus**: raft
- **Memory**: hybrid (JSON patterns + SQLite; optional vector search)
- **Routing**: keyword + route-outcomes

## CLI Commands

### Core Commands

| Command     | Subcommands | Description                                                              | Status          |
| ----------- | ----------- | ------------------------------------------------------------------------ | --------------- |
| `init`      | 5           | Project initialization with wizard, presets, skills, hooks               | Working         |
| `agent`     | 7           | Agent lifecycle (spawn, list, status, stop, metrics, pool, health)       | Working — runs in-process, no MCP server needed |
| `swarm`     | 6           | Multi-agent swarm coordination and orchestration                         | Working — runs in-process, no MCP server needed |
| `memory`    | 12          | Memory store (SQLite/JSON; optional vector search)                        | Working         |
| `mcp`       | 9           | MCP server management and tool execution                                 | Working         |
| `task`      | 5           | Task creation, assignment, and lifecycle                                 | Working         |
| `session`   | 6           | Session state management, persistence, and replay (`session replay`)     | Working         |
| `config`    | 7           | Configuration management and provider setup                              | Working         |
| `status`    | 3           | System status monitoring with watch mode                                 | Working         |
| `hooks`     | 29          | Self-learning hooks + 14 background workers                              | Working         |

### Advanced Commands

`agent` and `swarm` above execute MCP tool handlers directly in-process via the local tool registry (`src/mcp-client.ts`) — they do **not** require a running `mcp start` server. A separate MCP server is only needed when an external MCP *client* (e.g. Claude Code) wants to call these tools over stdio/HTTP.

> **Note:** Hive-mind functionality (BFT/Raft/Quorum consensus) is available exclusively via MCP tools (`hive-mind-tools.ts`), not as a CLI command.

| Command       | Subcommands | Description                                                                   | Status           |
| ------------- | ----------- | ----------------------------------------------------------------------------- | ---------------- |
| `security`    | 6           | Security scanning (scan, audit, cve, threats, validate, report)               | Working          |
| `performance` | 4           | Performance profiling (benchmark, profile, metrics, bottleneck) — real measurements | Working     |
| `providers`   | 4           | AI providers (list, configure, remove, test)                                  | Working          |
| `guidance`    | 1           | Governance gate setup (`guidance setup`)                                      | Working          |
| `monograph`   | -           | Knowledge graph CLI (delegates to @monoes/monograph)                          | Working          |
| `browse`      | -           | Browser automation via CDP (@monoes/monobrowse)                               | Working          |
| `doctor`      | 1           | System diagnostics with health checks                                         | Working          |
| `completions` | 4           | Shell completions (bash, zsh, fish, powershell)                               | Working          |

### Quick CLI Examples

```bash
# Initialize project
npx monomind@latest init --wizard

# Spawn an agent
npx monomind@latest agent spawn -t coder --name my-coder

# Initialize swarm
npx monomind@latest swarm init --v1-mode

# Search memory (HNSW-indexed)
npx monomind@latest memory search --query "authentication patterns"

# System diagnostics
npx monomind@latest doctor --fix

# Security scan
npx monomind@latest security scan --depth full

# Performance benchmark
npx monomind@latest performance benchmark --suite all
```

## Available Agents (13 Core Types, 60+ Routing Target Definitions)

### Core Development

`coder`, `reviewer`, `tester`, `planner`, `researcher`

### Specialized Agents

`security-architect`, `security-auditor`, `memory-specialist`, `performance-engineer`

### Input Guards (inlined into `src/utils/input-guards.ts`)

CVE remediation, input validation, path security (utility functions inlined into the CLI — the former `@monomind/security` package was deleted):

- Input validation via Zod schemas
- Path traversal prevention utilities
- Command injection protection utilities

### Swarm Coordination

`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`, `collective-intelligence-coordinator`, `swarm-memory-manager`

### Consensus & Distributed

`byzantine-coordinator`, `raft-manager`, `gossip-coordinator`, `consensus-builder`, `crdt-synchronizer`, `quorum-manager`, `security-manager`

### Performance & Optimization

`perf-analyzer`, `performance-benchmarker`, `task-orchestrator`, `memory-coordinator`, `smart-agent`

### GitHub & Repository

`github-modes`, `pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`, `workflow-automation`, `project-board-sync`, `repo-architect`, `multi-repo-swarm`

### Specialized Development

`backend-dev`, `mobile-dev`, `ml-developer`, `cicd-engineer`, `api-docs`, `system-architect`, `code-analyzer`, `base-template-generator`

### Testing & Validation

`tdd-london-swarm`, `production-validator`

## 🪝 Hooks System (29 Hook Subcommands + 14 Background Workers)

### All Available Hooks

| Hook               | Description                              | Key Options                                 |
| ------------------ | ---------------------------------------- | ------------------------------------------- |
| `pre-edit`         | Get context before editing files         | `--file`, `--operation`                     |
| `post-edit`        | Record editing outcome for learning      | `--file`, `--success`, `--train-neural`     |
| `pre-command`      | Assess risk before commands              | `--command`, `--validate-safety`            |
| `post-command`     | Record command execution outcome         | `--command`, `--track-metrics`              |
| `pre-task`         | Record task start, get agent suggestions | `--description`, `--coordinate-swarm`       |
| `post-task`        | Record task completion for learning      | `--task-id`, `--success`, `--store-results` |
| `session-start`    | Start/restore session (v2 compat)        | `--session-id`, `--auto-configure`          |
| `session-end`      | End session and persist state            | `--generate-summary`, `--export-metrics`    |
| `session-restore`  | Restore a previous session               | `--session-id`, `--latest`                  |
| `route`            | Route task to optimal agent              | `--task`, `--context`, `--top-k`            |
| `route-task`       | (v2 compat) Alias for route              | `--task`, `--auto-swarm`                    |
| `explain`          | Explain routing decision                 | `--topic`, `--detailed`                     |
| `pretrain`         | Bootstrap intelligence from repo         | `--model-type`, `--epochs`                  |
| `build-agents`     | Generate optimized agent configs         | `--agent-types`, `--focus`                  |
| `metrics`          | View learning metrics dashboard          | `--v1-dashboard`, `--format`                |
| `transfer`         | Transfer patterns via IPFS registry      | `store`, `from-project`                     |
| `list`             | List all registered hooks                | `--format`                                  |
| `intelligence`     | JS pattern/trajectory logging              | `trajectory-*`, `pattern-*`, `stats`        |
| `notify`           | Send/record a notification event         | `--message`                                 |
| `worker`           | Background worker management             | `list`, `run`                               |
| `model-route`      | Route to optimal model (haiku/sonnet/opus) | `--task`                                  |
| `model-outcome`    | Record model routing outcome             | `--task-id`, `--success`                    |
| `model-stats`      | View model routing statistics            | `--format`                                  |
| `statusline`       | Generate dynamic statusline              | `--json`, `--compact`, `--no-color`         |
| `coverage-route`   | Route based on test coverage gaps        | `--task`, `--path`                          |
| `coverage-suggest` | Suggest coverage improvements            | `--path`                                    |
| `coverage-gaps`    | List coverage gaps with priorities       | `--format`, `--limit`                       |
| `pre-bash`         | (v2 compat) Alias for pre-command        | Same as pre-command                         |
| `post-bash`        | (v2 compat) Alias for post-command       | Same as post-command                        |

### 14 Background Workers (@monomind/hooks, run in-process)

| Worker        | Priority   | Description                                          |
| ------------- | ---------- | ---------------------------------------------------- |
| `performance` | normal     | Benchmark search, memory, startup performance        |
| `health`      | high       | Monitor disk, memory, CPU, processes                 |
| `swarm`       | high       | Monitor swarm activity, agent coordination           |
| `git`         | normal     | Track uncommitted changes, branch status             |
| `learning`    | normal     | Optimize learning, SONA adaptation                   |
| `adr`         | low        | Check ADR compliance across codebase                 |
| `ddd`         | low        | Track DDD progress → metrics/ddd-progress.json       |
| `security`    | high       | Scan for secrets, vulnerabilities, CVEs              |
| `patterns`    | normal     | Consolidate, dedupe, optimize learned patterns       |
| `cache`       | background | Clean temp files, old logs, stale cache              |
| `map`         | normal     | Codebase mapping → metrics/codebase-map.json         |
| `audit`       | high       | Security audit → metrics/security-audit.json         |
| `optimize`    | normal     | Performance snapshot → metrics/performance.json      |
| `consolidate` | low        | RAPTOR memory consolidation → metrics/consolidation.json |

The metrics-producing workers (ddd, map, audit, optimize, consolidate) refresh
automatically at session start when their output file is missing or older than
6 hours. Run any worker on demand with `hooks worker run <name>`.

### Essential Hook Commands

```bash
# Core hooks
npx monomind@latest hooks pre-task --description "[task]"
npx monomind@latest hooks post-task --task-id "[id]" --success true
npx monomind@latest hooks post-edit --file "[file]" --train-neural true

# Session management
npx monomind@latest hooks session-start --session-id "[id]"
npx monomind@latest hooks session-end --export-metrics true
npx monomind@latest hooks session-restore --session-id "[id]"

# Intelligence routing
npx monomind@latest hooks route --task "[task]"
npx monomind@latest hooks explain --topic "[topic]"

# Neural learning
npx monomind@latest hooks pretrain --model-type moe --epochs 10
npx monomind@latest hooks build-agents --agent-types coder,tester

# Background workers
npx monomind@latest hooks worker list
npx monomind@latest hooks worker run audit

# Coverage-aware routing
npx monomind@latest hooks coverage-gaps --format table
npx monomind@latest hooks coverage-route --task "[task]"

# Statusline (for Claude Code integration)
npx monomind@latest hooks statusline
npx monomind@latest hooks statusline --json
```

## 🧠 Intelligence System

The lean build records what happens and measures whether routing helped — no neural training:

- **Keyword routing**: deterministic task→handler routing (`createKeywordRouter`)
- **Route-outcome measurement**: correlates recommended routes with actual outcomes; accuracy/adherence surfaced by `doctor`
- **Trajectory + outcome logging**: `intelligence.ts` records steps/trajectories; `command-outcomes.ts` tracks command results
- **Pattern persistence**: plain `patterns.json` read by `intelligence.ts`
- **HNSW**: pure-JS approximate nearest-neighbor via `@monoes/memory` (optional, not on the routing hot path)

> The full neural learning loop (SONA, MoE, Flash Attention, EWC++/LoRA) lives on the `monoes-full-loop` branch.

## Embeddings (MCP tools + @monoes/memory)

Features:

- **sql.js**: Cross-platform SQLite persistent cache (WASM, no native compilation)
- **Document chunking**: Configurable overlap and size
- **Normalization**: L2, L1, min-max, z-score
- **Hyperbolic embeddings**: Poincare ball model for hierarchical data

## Hive-Mind Consensus (Single-Process Vote Counting)

### Topologies

- `hierarchical` - Queen controls workers directly
- `mesh` - Fully connected peer network
- `hierarchical-mesh` - Hybrid (recommended)
- `adaptive` - Dynamic based on load

### Consensus Strategies

These implement vote-counting logic in a single process (not distributed networking):

- `byzantine` / `bft` - BFT vote counting (requires 2f+1 votes, tolerates f < n/3 faulty)
- `raft` - Majority vote counting (tolerates f < n/2)
- `quorum` - Configurable preset (majority/supermajority/unanimous)

`gossip` and `crdt` are planned but not implemented — `hive-mind_init` rejects them.

## Performance Targets

| Metric           | Target                   |
| ---------------- | ------------------------ |
| Memory Reduction | 50-75% with quantization |
| MCP Response     | <100ms                   |
| CLI Startup      | <500ms                   |

## 📊 Performance Optimization Protocol

### Automatic Performance Tracking

```bash
# After any significant operation, track metrics
Bash("npx monomind@latest hooks post-command --command '[operation]' --track-metrics true")

# Periodically run benchmarks (every major feature)
Bash("npx monomind@latest performance benchmark --suite all")

# Analyze bottlenecks when performance degrades
Bash("npx monomind@latest performance profile --target '[component]'")
```

### Session Persistence (Cross-Conversation Learning)

```bash
# At session start - restore previous context
Bash("npx monomind@latest session restore --latest")

# At session end - persist learned patterns
Bash("npx monomind@latest hooks session-end --generate-summary true --persist-state true --export-metrics true")
```

### Pattern Logging & Lookup

```bash
# Look up stored patterns relevant to a task (keyword match, not ML prediction)
Bash("npx monomind@latest hooks intelligence predict --input '[task description]'")

# View stored patterns
Bash("npx monomind@latest hooks intelligence patterns --action list")
```

## 🔧 Environment Variables

```bash
# Configuration
MONOMIND_CONFIG=./monomind.config.json
MONOMIND_LOG_LEVEL=info

# Provider API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# MCP Server
MONOMIND_MCP_PORT=3000
MONOMIND_MCP_HOST=localhost
MONOMIND_MCP_TRANSPORT=stdio

# Memory
MONOMIND_MEMORY_BACKEND=hybrid
MONOMIND_MEMORY_PATH=./data/memory
```

## 🔍 Doctor Health Checks

Run `npx monomind@latest doctor` to check:

- Node.js version (20+)
- npm version (9+)
- Git installation
- Config file validity
- Memory database
- API keys
- MCP servers
- Disk space
- TypeScript installation
- Worker metrics freshness

## 🚀 Quick Setup

```bash
# Add MCP servers (requires explicit `mcp start` subcommand)
claude mcp add monomind -- npx -y monomind@latest mcp start

# Run doctor
npx monomind@latest doctor --fix
```

## 🎯 Claude Code vs CLI Tools

### Claude Code Handles ALL EXECUTION:

- **Task tool**: Spawn and run agents concurrently
- File operations (Read, Write, Edit, MultiEdit, Glob, Grep)
- Code generation and programming
- Bash commands and system operations
- TodoWrite and task management
- Git operations

### CLI Tools Handle Coordination (via Bash):

- **Swarm init**: `npx monomind@latest swarm init --topology <type>`
- **Swarm status**: `npx monomind@latest swarm status`
- **Agent spawn**: `npx monomind@latest agent spawn -t <type> --name <name>`
- **Memory store**: `npx monomind@latest memory store --key "mykey" --value "myvalue" --namespace patterns`
- **Memory search**: `npx monomind@latest memory search --query "search terms"`
- **Memory list**: `npx monomind@latest memory list --namespace patterns`
- **Memory retrieve**: `npx monomind@latest memory retrieve --key "mykey" --namespace patterns`
- **Hooks**: `npx monomind@latest hooks <hook-name> [options]`

## 📝 Memory Commands Reference (IMPORTANT)

### Store Data (ALL options shown)

```bash
# REQUIRED: --key and --value
# OPTIONAL: --namespace (default: "default"), --ttl, --tags
npx monomind@latest memory store --key "pattern-auth" --value "JWT with refresh tokens" --namespace patterns
npx monomind@latest memory store --key "bug-fix-123" --value "Fixed null check" --namespace solutions --tags "bugfix,auth"
```

### Search Data (semantic vector search)

```bash
# REQUIRED: --query (full flag, not -q)
# OPTIONAL: --namespace, --limit, --threshold
npx monomind@latest memory search --query "authentication patterns"
npx monomind@latest memory search --query "error handling" --namespace patterns --limit 5
```

### List Entries

```bash
# OPTIONAL: --namespace, --limit
npx monomind@latest memory list
npx monomind@latest memory list --namespace patterns --limit 10
```

### Retrieve Specific Entry

```bash
# REQUIRED: --key
# OPTIONAL: --namespace (default: "default")
npx monomind@latest memory retrieve --key "pattern-auth"
npx monomind@latest memory retrieve --key "pattern-auth" --namespace patterns
```

### Initialize Memory Database

```bash
npx monomind@latest memory init --force --verbose
```

**KEY**: CLI coordinates the strategy via Bash, Claude Code's Task tool executes with real agents.

## 📚 Full Capabilities Reference

For a comprehensive overview of all Monomind features, agents, commands, and integrations, see:

**`.monomind/CAPABILITIES.md`** - Complete reference generated during init

This includes:

- All 60+ agent type definitions (routing targets) with recommendations
- All 32 CLI commands
- All 29 hook subcommands + 14 background workers (@monomind/hooks)
- Intelligence system details (keyword routing + trajectory/outcome logging)
- Hive-Mind consensus mechanisms
- Integration ecosystem (agentic-flow, lancedb,agentic-jujutsu)
- Performance targets and status

## Support

- Documentation: https://github.com/monoes/monomind
- Issues: https://github.com/monoes/monomind/issues

---

Remember: **Monomind CLI coordinates, Claude Code Task tool creates!**

# important-instruction-reminders

Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User.
Never save working files, text/mds and tests to the root folder.

## 🚨 SWARM EXECUTION RULES (CRITICAL)

1. **SPAWN IN BACKGROUND**: Use `run_in_background: true` for all agent Task calls
2. **SPAWN ALL AT ONCE**: Put ALL agent Task calls in ONE message for parallel execution
3. **TELL USER**: After spawning, list what each agent is doing (use emojis for clarity)
4. **STOP AND WAIT**: After spawning, STOP - do NOT add more tool calls or check status
5. **NO POLLING**: Never poll TaskOutput or check swarm status - trust agents to return
6. **SYNTHESIZE**: When agent results arrive, review ALL results before proceeding
7. **NO CONFIRMATION**: Don't ask "should I check?" - just wait for results

Example spawn message:

```
"I've launched 4 agents in background:
- 🔍 Researcher: [task]
- 💻 Coder: [task]
- 🧪 Tester: [task]
- 👀 Reviewer: [task]
Working in parallel - I'll synthesize when they complete."
```
