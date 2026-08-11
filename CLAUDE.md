# Claude Code Configuration - Monomind

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- **Versioning policy (NEVER violate)**: When bumping the monomind version, **only the third (patch) digit may ever increase** (e.g. `2.8.4 → 2.8.5`, `2.9.0 → 2.9.1`). **Never** bump the first (major) or second (minor) digit unless the user explicitly says otherwise. This applies to `package.json`, `packages/@monomind/cli/package.json`, `CHANGELOG.md` headers, git tags, and GitHub release names. If unsure, ask — do not guess.
- ALWAYS call `mcp__monomind__monograph_query` BEFORE running grep/rg/find via Bash for code exploration — only fall back to Bash grep if monograph returns 0 results or the DB does not exist
- When starting any task that touches 3+ files: call `mcp__monomind__monograph_suggest` first to get relevant nodes ranked by task relevance

## Coding Principles

### Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity First
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### Surgical Changes
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.
- Every changed line should trace directly to the user's request.

### Goal-Driven Execution
- Transform tasks into verifiable goals with success criteria.
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- For multi-step tasks, state a brief plan with verification steps.

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

### Project Config

- **Topology**: hierarchical-mesh
- **Max Agents**: 8
- **Memory**: hybrid
- **HNSW**: Available (fallback path only)
- **Neural**: Disabled (keyword routing only)

## Build & Test

```bash
# Build
npm run build

# Test
npm test

# Lint
npm run lint
```

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal
- Run `npx monomind@latest security scan` after security-related changes

## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- Use Claude Code's Task tool for spawning agents, not just MCP
- ALWAYS batch ALL todos in ONE TodoWrite call (5-10+ minimum)
- ALWAYS spawn ALL agents in ONE message with full instructions via Task tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL Bash commands in ONE message

## Swarm Orchestration

"Swarm" here means: multiple Claude Code Task-tool agents running in this one
process, coordinated by CLI-tracked state and (for hive-mind) simple
majority-vote arbitration between them — not a distributed system. There is
no networking between separate machines. See `doc/concepts/swarm.md` for the
full picture, including what "consensus" actually computes.

- MUST initialize the swarm using CLI tools when starting complex tasks
- MUST spawn concurrent agents using Claude Code's Task tool
- Never use CLI tools alone for execution — Task tool agents do the actual work
- MUST call CLI tools AND Task tool in ONE message for complex work

## Swarm Configuration & Anti-Drift

- ALWAYS use hierarchical topology for coding swarms
- Keep maxAgents at 6-8 for tight coordination
- Use specialized strategy for clear role boundaries
- Use `raft` consensus for hive-mind — in-process majority-vote counting
  (tolerates fewer than half the voters being wrong), not real Raft leader
  election or log replication
- Run frequent checkpoints via `post-task` hooks
- Keep shared memory namespace for all agents

```bash
npx monomind@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

## Swarm Execution Rules

- ALWAYS use `run_in_background: true` for all agent Task calls
- ALWAYS put ALL agent Task calls in ONE message for parallel execution
- After spawning, STOP — do NOT add more tool calls or check status
- Never poll TaskOutput or check swarm status — trust agents to return
- When agent results arrive, review ALL results before proceeding

## CLI Commands

### Core Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | 5 | Project initialization with wizard, presets, skills, hooks |
| `agent` | 7 | Agent lifecycle (spawn, list, status, stop, metrics, pool, health) — runs in-process, no MCP server needed |
| `swarm` | 6 | Multi-agent swarm coordination and orchestration — runs in-process |
| `memory` | 12 | Memory store (SQLite/JSON; optional vector search) |
| `mcp` | 9 | MCP server management and tool execution |
| `task` | 5 | Task creation, assignment, and lifecycle |
| `session` | 6 | Session state management, persistence, and replay (`session replay`) |
| `config` | 7 | Configuration management and provider setup |
| `status` | 3 | System status monitoring with watch mode |
| `hooks` | 29 | Self-learning hooks + <!-- doc-count:workers -->0<!-- /doc-count:workers --> background workers |
| `org` | 31 | SDK org runtime v2 (run [--dry-run], stop, pause, resume, reload, status, serve, supervisor, test-loop, logs, report, memory, costs, flow, questions, answer, approve, deny, gates, gate-approve, gate-reject, replay, resume-from, branch, decisions, create, validate, migrate, list, delete, mark-complete) |

### Advanced Commands

`agent` and `swarm` above execute MCP tool handlers directly in-process via the local tool registry — they do **not** require a running `mcp start` server.

> **Note:** Hive-mind functionality (byzantine/raft/quorum consensus) is available exclusively via MCP tools (`hive-mind_*`), not as a CLI command. Neural pattern learning was merged into `hooks intelligence`.

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `security` | 6 | Security scanning (scan, cve, audit, secrets, defend, redteam). `audit --action export/log/clear` and `redteam --target` are unimplemented |
| `performance` | 4 | Performance profiling (benchmark, profile, metrics, bottleneck) — real measurements |
| `providers` | 4 | AI providers (list, configure, remove, test) |
| `guidance` | 1 | Governance gate setup (`guidance setup`) |
| `monograph` | – | Knowledge graph CLI (delegates to @monoes/monograph) |
| `browse` | – | Browser automation via CDP (@monoes/monobrowse) |
| `doctor` | 0 | System diagnostics — flat command, flags only |
| `completions` | 4 | Shell completions (bash, zsh, fish, powershell) |
| `autopilot` | 10 | Autonomous task execution (status, enable, disable, config, reset, log, learn, history, predict, check) |
| `tokens` | 4 | Token usage tracking (dashboard, summary, today, lean-delta) |
| `search` | 1 | Universal search (`search scan` refreshes fingerprint) |
| `analyze` | 7 | Codebase analysis (diff, code, deps, ast, complexity, symbols, imports) |
| `route` | 9 | Task-to-agent routing (task, semantic, list-agents, stats, feedback, reset, export, import, coverage) |
| `update` | 5 | Self-update check (check, all, history, rollback, clear-cache) |
| `cleanup` | 0 | Remove monomind project artifacts — flat command, flags only |
| `platforms` | 3 | Install/uninstall Monograph context for AI platforms (install, uninstall, setup) |
| `design` | 4 | Design tooling (detect, fix, ignores, palette) |
| `doc` | 8 | Second Brain — document ingestion & retrieval (ingest, search, list, export, remove, reconcile, import, eval) |
| `start` | 3 | Orchestration system (stop, restart, quick) |
| `crash-reporting` | 3 | Configure crash reporting (enable, disable, status) |
| `report-crash` | – | Internal: file a GitHub issue for a crash (hidden; shelled out to by monotask/mono-clip) |

### Quick CLI Examples

```bash
npx monomind@latest init --wizard
npx monomind@latest agent spawn -t coder --name my-coder
npx monomind@latest swarm init --v1-mode
npx monomind@latest memory search --query "authentication patterns"
npx monomind@latest doctor --fix
```

## Available Agents (60+ Types)

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### Specialized
`security-architect`, `security-auditor`, `memory-specialist`, `performance-engineer`

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`

### GitHub & Repository
`pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

## Memory Commands Reference

```bash
# Store (REQUIRED: --key, --value; OPTIONAL: --namespace, --ttl, --tags)
npx monomind@latest memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns

# Search (REQUIRED: --query; OPTIONAL: --namespace, --limit, --threshold)
npx monomind@latest memory search --query "authentication patterns"

# List (OPTIONAL: --namespace, --limit)
npx monomind@latest memory list --namespace patterns --limit 10

# Retrieve (REQUIRED: --key; OPTIONAL: --namespace)
npx monomind@latest memory retrieve --key "pattern-auth" --namespace patterns
```

## Second Brain — Document Knowledge Base

If the `documents` capability is active (check `.monomind/capabilities.json`), this project indexes documents into a semantic search engine (Office, PDF, text, EPUB, and more; Google Drive files are exported as Office formats).

**When documents are indexed, search knowledge before answering questions about business, compliance, legal, or organizational topics:**
- Call `mcp__monomind__knowledge_search` with a relevant query (add `store: "project"` or `"global"` to search one brain only; default merges both)
- Use the returned excerpts as grounding context for your answer
- Cite the source document name when referencing specific information
- Add with `mcp__monomind__knowledge_ingest`; retract a wrong or stale document with `mcp__monomind__knowledge_remove` (hides it from search immediately, reversible by re-ingesting)

**Global brain:** the user has a personal cross-project knowledge store at `~/.monomind/global-brain`. All searches (knowledge_search, doc search, per-prompt injection) automatically merge it with project knowledge — project results win ties, global hits are labeled `[global]`. Cite the label so the user knows which brain answered.

**Re-indexing** happens automatically on session start (unchanged files are skipped via content hash).

## Knowledge Graph — Monograph (Use Before Codebase Exploration)

Built into monomind — no separate install. Pure TypeScript, parses TS/JS/Python/Go/Rust/C/C++/Java/Ruby/Swift into a SQLite graph with BM25 full-text search.

### MANDATORY: Graph-First, Grep-Last

**Before ANY grep/rg/find via Bash for code navigation:**
1. Call `mcp__monomind__monograph_query` first — returns file path + line number
2. Only fall back to Bash grep if monograph returns 0 results or reports DB missing

**When starting any task touching 3+ files:**
1. `mcp__monomind__monograph_suggest` — relevant nodes ranked by task description
2. `mcp__monomind__monograph_context` — 360° view of a symbol (callers, callees, imports)
3. `mcp__monomind__monograph_impact` — blast radius before changing anything

**If graph is empty:** call `mcp__monomind__monograph_build` (runs in background; proceed with grep while it builds).

The four tools above cover daily use; the full tool list (route maps, communities, export, staleness, etc.) is discoverable via the MCP tool listing.

### Skip monograph for
Single-file edits, doc/config changes, quick fixes where you already know the exact file.

## Quick Setup

```bash
# Add MCP server — includes monograph, swarm, memory, hooks, all 200+ tools
claude mcp add monomind -- npx -y monomind@latest mcp start

# Verify everything works
npx monomind@latest doctor --fix
```

> **Package name changed:** Use `monomind@latest` (not `@monomind/cli@latest` which is the old name and returns 404).

## Claude Code vs CLI Tools

- Claude Code's Task tool handles ALL execution: agents, file ops, code generation, git
- CLI tools handle coordination via Bash: swarm init, memory, hooks, routing
- NEVER use CLI tools as a substitute for Task tool agents

## Support

- Documentation: https://github.com/monoes/monomind
- Issues: https://github.com/monoes/monomind/issues
