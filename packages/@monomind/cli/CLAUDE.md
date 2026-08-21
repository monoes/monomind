# Claude Code Configuration - Monomind v2.0

## Skill Auto-Invocation Rules

- For ANY web animation, motion graphics, or animation request: ALWAYS invoke `Skill("monomotion")` FIRST — no exceptions.
- For ANY UI testing, browser automation, or web navigation request: ALWAYS invoke `Skill("agent-browser-testing")` FIRST — no exceptions.
- NEVER use `mcp__claude-in-chrome__*`, `mcp__plugin_playwright__*`, `mcp__playwright__*`, Playwright, Puppeteer, Selenium, or any external browser tool. ALWAYS use `npx monomind browse`. This rule has no exceptions. If a `browse` command appears to hang or a Chrome process is left running after one, see `doc/concepts/monobrowse.md#5-recovery--if-a-command-hangs-or-chrome-is-left-running` for the recovery path (commands time out on their own after ~30s; Ctrl-C runs best-effort cleanup; `browse close` in a fresh process can kill an orphan via its persisted PID) before reaching for a different tool.

## Automatic Monoswarm Orchestration

For complex work, Claude Code MUST initialize the monoswarm via CLI (Bash) AND spawn agents via the Task tool in the SAME message — CLI coordinates, Task tool agents do the actual work.

Coordination state (topology, roster, votes) lives in
`.monomind/monoswarm/state.json`; agents relate and vote per that state. See
`doc/concepts/monoswarm.md` for the full picture, including the vote strategy
table (`majority`/`supermajority`/`unanimous`/`threshold`).

**Monoswarm spawn-and-wait rules:**

- Spawn ALL agents in ONE message, each with `run_in_background: true` and full instructions
- After spawning, tell the user what each agent is doing, then STOP — no more tool calls
- Never poll TaskOutput or check monoswarm status; don't ask "should I check?" — wait for results
- When agent results arrive, review ALL results before proceeding

### Anti-Drift Config (PREFERRED)

**Use this to prevent agent drift:**

```bash
# Small teams (6-8 agents) - use hierarchical for tight control
npx monomind@latest monoswarm init --topology hierarchical --max-agents 8 --strategy specialized

# Large teams (10-15 agents) - use hierarchical-mesh for V1 queen + peer communication
npx monomind@latest monoswarm init --topology hierarchical-mesh --max-agents 15 --strategy specialized
```

**Valid Topologies:**

- `hierarchical` - Queen controls workers directly (anti-drift for small teams)
- `hierarchical-mesh` - V1 queen + peer communication (recommended for 10+ agents)
- `mesh` - Fully connected peer network
- `ring` - Circular communication pattern
- `star` - Central coordinator with spokes
- `hybrid` / `adaptive` - Caller-interpreted labels recorded in monoswarm state — no automatic reconfiguration

**Anti-Drift Guidelines:**

- **hierarchical**: Coordinator catches divergence
- **max-agents 6-8**: Smaller team = less drift
- **specialized**: Clear roles, no overlap
- **consensus**: `majority` — see `doc/concepts/monoswarm.md` for `supermajority`/`unanimous`/`threshold`

## Memory Loop (Feedback + Knowledge Graph)

- When memory/knowledge search results helped, call `memory_feedback` with the task id and the result `entryIds` — EWMA-trains ranking (idempotent per taskId).
- At session wrap-up, distill durable insight (entities/relations/rules) once via `memory_kg_ingest` with `originRef` = session id; reuse existing entity names (`memory_kg_stats` with `glossary:true`).
- Relationship questions → `memory_kg_search`. Bad ingest → `memory_kg_rollback` with the originRef.

## AUTO-LEARNING PROTOCOL

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

# 4. Refresh the codebase map worker after a structural change
Bash("npx monomind@latest hooks worker run map")
```

### Continuous Improvement Triggers

| Trigger                | Worker        | When to Use              |
| ---------------------- | ------------- | ------------------------ |
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

**Codes 1-11: hierarchical/specialized (anti-drift). Code 13: mesh/balanced**

This table is a convention, not code: nothing in `src/` dispatches on these codes.
The root `CLAUDE.md` table is authoritative and this one matches it. The narrower table
emitted for new projects by `src/init/claudemd-generator.ts` stops at code 9.

### Task Complexity Detection

**AUTO-INVOKE MONOSWARM when task involves:**

- Multiple files (3+)
- New feature implementation
- Refactoring across modules
- API changes with tests
- Security-related changes
- Performance optimization
- Database schema changes

**SKIP MONOSWARM for:**

- Single file edits
- Simple bug fixes (1-2 lines)
- Documentation updates
- Configuration changes
- Quick questions/exploration

## CRITICAL: CONCURRENT EXECUTION & FILE MANAGEMENT

**ABSOLUTE RULES**:

1. ALL operations MUST be concurrent/parallel in a single message
2. **NEVER save working files, text/mds and tests to the root folder**
3. ALWAYS organize files in appropriate subdirectories
4. **USE CLAUDE CODE'S TASK TOOL** for spawning agents concurrently, not just MCP

### GOLDEN RULE: "1 MESSAGE = ALL RELATED OPERATIONS"

**MANDATORY PATTERNS:**

- **TodoWrite**: ALWAYS batch ALL todos in ONE call (5-10+ todos minimum)
- **File operations**: ALWAYS batch ALL reads/writes/edits in ONE message
- **Bash commands**: ALWAYS batch ALL terminal operations in ONE message
- **Memory operations**: ALWAYS batch ALL memory store/retrieve in ONE message

### File Organization Rules

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
- **Consensus**: majority
- **Memory**: hybrid (JSON patterns + SQLite; optional vector search)
- **Routing**: keyword + route-outcomes

## CLI Commands

### Core Commands

| Command     | Subcommands | Description                                                              | Status          |
| ----------- | ----------- | ------------------------------------------------------------------------ | --------------- |
| `init`      | 5           | Project initialization with wizard, presets, skills, hooks               | Working         |
| `ui`        | 0           | Start the Neural Control Room dashboard (`--no-open`, `--port`; alias `dashboard`) | Working         |
| `agent`     | 7           | Agent lifecycle (spawn, list, status, stop, metrics, pool, health)       | Working — runs in-process, no MCP server needed |
| `monoswarm` | 6           | Multi-agent coordination and orchestration                               | Working — runs in-process, no MCP server needed |
| `memory`    | 12          | Memory store (SQLite/JSON; optional vector search)                        | Working         |
| `mcp`       | 9           | MCP server management and tool execution                                 | Working         |
| `task`      | 5           | Task creation, assignment, and lifecycle                                 | Working         |
| `session`   | 6           | Session state management, persistence, and replay (`session replay`)     | Working         |
| `config`    | 7           | Configuration management and provider setup                              | Working         |
| `status`    | 3           | System status monitoring with watch mode                                 | Working         |
| `hooks`     | 28          | Self-learning hooks + <!-- doc-count:workers -->9<!-- /doc-count:workers --> background workers                               | Working         |
| `org`       | 33          | SDK org runtime v2 (run [--dry-run], stop, pause, resume, reload, status, serve, supervisor, test-loop, logs, watch, report, memory [stats\|search\|rules\|rollback], costs, inbox, flow, questions, answer, approve, deny, gates, gate-approve, gate-reject, replay, resume-from [resumes live execution from a checkpoint — distinct from replay's debug-only event replay], branch, decisions, create, validate, migrate, list, delete, mark-complete) | Working |

### Advanced Commands

`agent` and `monoswarm` above execute MCP tool handlers directly in-process via the local tool registry (`src/mcp-client.ts`) — they do **not** require a running `mcp start` server. A separate MCP server is only needed when an external MCP *client* (e.g. Claude Code) wants to call these tools over stdio/HTTP.

| Command       | Subcommands | Description                                                                   | Status           |
| ------------- | ----------- | ----------------------------------------------------------------------------- | ---------------- |
| `security`    | 6           | Security scanning (scan, cve, audit, secrets, defend, redteam). `audit --action list/log/export/clear` reads/writes a real audit trail; `redteam --target` sends the attack-prompt library live and evaluates responses via monofence-ai (dry-run listing is still the default with no `--target`) | Working |
| `performance` | 4           | Performance profiling (benchmark, profile, metrics, bottleneck) — real measurements | Working     |
| `providers`   | 4           | AI providers (list, configure, remove, test)                                  | Working          |
| `guidance`    | 1           | Governance gate setup (`guidance setup`)                                      | Working          |
| `monograph`   | -           | Knowledge graph CLI (delegates to @monoes/monograph)                          | Working          |
| `browse`      | -           | Browser automation via CDP (@monoes/monobrowse)                               | Working          |
| `doctor`      | 0           | System diagnostics — flat command, flags only (`--component` accepts 28 named categories, dispatch table `doctor.ts:97-111`) | Working          |
| `completions` | 4           | Shell completions (bash, zsh, fish, powershell)                               | Working          |

### Quick CLI Examples

```bash
# Initialize project
npx monomind@latest init --wizard

# Spawn an agent
npx monomind@latest agent spawn -t coder --name my-coder

# Initialize monoswarm
npx monomind@latest monoswarm init --v1-mode

# Search memory (local SQLite + local HF-embeddings; keyword fallback. Not HNSW —
# the pure-JS HNSW index is a sql.js-fallback path only, via --build-hnsw)
npx monomind@latest memory search --query "authentication patterns"

# System diagnostics
npx monomind@latest doctor --fix

# Security scan
npx monomind@latest security scan --depth full

# Performance benchmark
npx monomind@latest performance benchmark --suite all
```

## Available Agents (97 definitions in this package's `.claude/agents/`, 97 registered)

**Counts are for THIS package, not the repo root.** `packages/@monomind/cli/.claude/agents/`
holds 97 `.md` files with 97 entries in `packages/@monomind/cli/.monomind/registry.json`;
the repo-root `.claude/agents/` tree is a different set (88 files). Unlike the repo-root
tree, this package's tree has no `generated/` subdirectory — the one generated definition
(`dashboard-verifier`) lives only under the repo-root `.claude/agents/generated/`. Because
`package.json`'s `files` array includes `.claude`, all 97 ship to npm users — so the
package's own tree is the number that matters here.

By directory: engineering 23, specialized 15, github 12, testing 9, reengineer-squad 9,
core 6, optimization 5, marketing 5, monoswarm 5, consensus 2, templates 2, plus one
file each in architecture, design, goal, and specialists.

The curated roster below is the subset worth routing to by hand. It is **not** the complete
set — names such as `security-manager`, `production-validator`,
`swarm-memory-manager` and `workflow-automation` are absent from it but do exist as
checked-in definitions in this package, and `src/init/executor.ts` and
`mcp-tools/guidance-tools.ts` can legitimately reference them.

### Core

`coder`, `coordinator`, `planner`, `researcher`, `reviewer`, `tester`

### Engineering

`ai-engineer`, `backend-architect`, `code-reviewer`, `devops-automator`, `frontend-developer`, `security-engineer`, `software-architect`, `technical-writer`

### GitHub

`github-modes`, `pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`, `repo-architect`

### Monoswarm / Consensus

`mesh-coordinator`, `collective-intelligence-coordinator`, `quorum-manager`
(`queen-coordinator` was absorbed into `core/coordinator` in 2026-07.)

### Specialized

`mcp-builder`, `mobile-dev` (spec-mobile-react-native), `integration-architect`, `goal-planner`, `tdd-london-swarm`

### Design

`monodesign` — the only design agent.

### Non-roster definitions

`coordinator-swarm-init` (template) and `dashboard-verifier` (generated).

### Input Guards (inlined into `src/utils/input-guards.ts`)

Not agents — utility functions inlined into the CLI after the former `@monomind/security`
package was deleted:

- Input validation via Zod schemas
- Path traversal prevention utilities
- Command injection protection utilities

## Hooks System (29 Hook Subcommands + 9 Background Workers)

Full hook list with flags: `npx monomind@latest hooks list`. Worker list: `npx monomind@latest hooks worker list` (run one on demand with `hooks worker run <name>`). The metrics-producing workers (ddd, map, audit, consolidate) refresh automatically at session start when their output file is missing or older than 6 hours.

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
npx monomind@latest hooks pretrain --path . --depth medium

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

## Intelligence System

The lean build records what happens and measures whether routing helped — no neural training:

- **Keyword routing**: deterministic task→handler routing (`createKeywordRouter`)
- **Route-outcome measurement**: correlates recommended routes with actual outcomes; accuracy/adherence surfaced by `doctor`
- **Trajectory + outcome logging**: `intelligence.ts` records steps/trajectories; `command-outcomes.ts` tracks command results
- **Pattern persistence**: plain `patterns.json` read by `intelligence.ts`
- **HNSW**: pure-JS approximate nearest-neighbor (`src/memory/hnsw-operations.ts`) — a dead fallback, not on the default search path. It is reachable only via `memory search --build-hnsw`, which is a no-op unless the SQLite bridge is down and the sql.js WASM fallback is in use.

**SONA and EWC++ ship in main** (`src/memory/sona-optimizer.ts`, `src/memory/ewc-consolidation.ts`) — see the file headers for their actual scope.

## Embeddings (MCP tools + @monoes/memory)

Features:

- **sql.js**: Cross-platform SQLite persistent cache (WASM, no native compilation)
- **Document chunking**: Configurable overlap and size
- **Normalization**: L2, L1, min-max, z-score
- **Hyperbolic embeddings**: Poincare ball model for hierarchical data

## Performance Targets

| Metric           | Target                   |
| ---------------- | ------------------------ |
| Memory Reduction | 50-75% with quantization |
| MCP Response     | <100ms                   |
| CLI Startup      | <500ms                   |

## Performance Optimization Protocol

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

## Environment Variables

```bash
# Configuration
MONOMIND_CONFIG=./monomind.config.json
MONOMIND_LOG_LEVEL=info

# Provider API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...    # @ai-sdk/google (Gemini API)
ZHIPU_API_KEY=...                    # GLM via z.ai (Vercel runner, vendor: 'glm')
XAI_API_KEY=...                      # xAI Grok (Vercel runner, vendor: 'xai')
DEEPSEEK_API_KEY=...                 # DeepSeek (Vercel runner, vendor: 'deepseek')
MISTRAL_API_KEY=...                  # Mistral (Vercel runner, vendor: 'mistral')
GROQ_API_KEY=...                     # Groq (Vercel runner, vendor: 'groq')
TOGETHER_API_KEY=...                 # Together AI (Vercel runner, vendor: 'together')
FIREWORKS_API_KEY=...                # Fireworks AI (Vercel runner, vendor: 'fireworks')
COHERE_API_KEY=...                   # Cohere (Vercel runner, vendor: 'cohere')
PERPLEXITY_API_KEY=...               # Perplexity Sonar (Vercel runner, vendor: 'perplexity')
ALIBABA_API_KEY=...                  # Alibaba Qwen (Vercel runner, vendor: 'alibaba')
OPENROUTER_API_KEY=...               # OpenRouter aggregator (Vercel runner, vendor: 'openrouter')

# MCP Server
MONOMIND_MCP_PORT=3000
MONOMIND_MCP_HOST=localhost
MONOMIND_MCP_TRANSPORT=stdio

# Memory
MONOMIND_MEMORY_BACKEND=hybrid
MONOMIND_MEMORY_PATH=./data/memory
```

## Doctor Health Checks

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

## Quick Setup

```bash
# Add MCP servers (requires explicit `mcp start` subcommand)
claude mcp add monomind -- npx -y monomind@latest mcp start

# Run doctor
npx monomind@latest doctor --fix
```

## Claude Code vs CLI Tools

### Claude Code Handles ALL EXECUTION:

- **Task tool**: Spawn and run agents concurrently
- File operations (Read, Write, Edit, MultiEdit, Glob, Grep)
- Code generation and programming
- Bash commands and system operations
- TodoWrite and task management
- Git operations

### CLI Tools Handle Coordination (via Bash):

- **Monoswarm init**: `npx monomind@latest monoswarm init --topology <type>`
- **Monoswarm status**: `npx monomind@latest monoswarm status`
- **Agent spawn**: `npx monomind@latest agent spawn -t <type> --name <name>`
- **Memory store**: `npx monomind@latest memory store --key "mykey" --value "myvalue" --namespace patterns`
- **Memory search**: `npx monomind@latest memory search --query "search terms"`
- **Memory list**: `npx monomind@latest memory list --namespace patterns`
- **Memory retrieve**: `npx monomind@latest memory retrieve --key "mykey" --namespace patterns`
- **Hooks**: `npx monomind@latest hooks <hook-name> [options]`

**KEY**: CLI coordinates the strategy via Bash, Claude Code's Task tool executes with real agents.

## Full Capabilities Reference

For a comprehensive overview of all Monomind features, agents, commands, and integrations, see:

**`.monomind/CAPABILITIES.md`** — written by `monomind init` (`writeCapabilitiesDoc()` in
`src/init/write-capabilities.ts`, split out of `executor.ts` in the god-file refactor). It exists only in projects where init has run and did not skip it;
**it is not present in this repo**, so do not expect to read it here.

It includes:

- Agent type definitions with recommendations
- All 32 CLI commands
- All 29 hook subcommands + <!-- doc-count:workers -->9<!-- /doc-count:workers --> background workers (@monoes/hooks)
- Intelligence system details (keyword routing + trajectory/outcome logging)
- Monoswarm coordination and vote strategies
- Integration ecosystem (agentic-flow, agentic-jujutsu)
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
