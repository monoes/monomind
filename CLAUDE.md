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
- **Max Agents**: 15
- **Memory**: hybrid
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

## Monoswarm Rules

- MUST initialize the monoswarm for complex tasks: `npx monomind@latest monoswarm init --topology hierarchical --max-agents 8 --strategy specialized`
- ALWAYS spawn ALL agents in ONE message via the Task tool with `run_in_background: true` — CLI tools coordinate, Task agents do the work
- After spawning, STOP — never poll TaskOutput or check monoswarm status; trust agents to return
- When agent results arrive, review ALL results before proceeding
- Keep shared memory namespace for all agents; run frequent checkpoints via `post-task` hooks

## CLI Commands

### Core Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | 5 | Project initialization |
| `agent` | 7 | Agent lifecycle management |
| `monoswarm` | 6 | Multi-agent coordination |
| `memory` | 12 | SQLite memory with ANN search |
| `task` | 5 | Task creation and lifecycle |
| `session` | 6 | Session state management |
| `hooks` | 29 | Self-learning hooks + 8 background workers _(unavailable in this install)_ |

> Note: there is no `neural` CLI command. Neural pattern learning was merged
> into `hooks intelligence`. See `doc/concepts/monoswarm.md` for monoswarm
> coordination and vote strategies.

### Quick CLI Examples

```bash
npx monomind@latest init --wizard
npx monomind@latest agent spawn -t coder --name my-coder
npx monomind@latest monoswarm init --v1-mode
npx monomind@latest memory search --query "authentication patterns"
npx monomind@latest doctor --fix
```

## Available Agents (Curated Subset)

The full roster ships as `.claude/agents/**/*.md` — this is a hand-picked
subset worth routing to by name; it is not the complete set.

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### Specialized
`security-architect`

### Monoswarm Coordination
`mesh-coordinator`

### GitHub & Repository
`pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

## Memory Commands

```bash
npx monomind@latest memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns
npx monomind@latest memory search --query "authentication patterns"
```

Full command reference: `npx monomind@latest memory --help`

## Second Brain — Document Knowledge Base

If the `documents` capability is active (check `.monomind/capabilities.json`), this project indexes documents (Office, PDF, plain text, and more) into a semantic search engine.

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

Core tools (prefix: `mcp__monomind__`): `monograph_build`, `monograph_query`, `monograph_suggest`, `monograph_impact` — the full tool list self-describes via MCP.

### Skip monograph for
Single-file edits, doc/config changes, quick fixes where you already know the exact file.

## Quick Setup

```bash
# Add MCP server — includes monograph, monoswarm, memory, hooks, all 66+ tools
claude mcp add monomind -- npx -y monomind@latest mcp start

# Verify everything works
npx monomind@latest doctor --fix
```

> **Package name changed:** Use `monomind@latest` (not `@monomind/cli@latest` which is the old name and returns 404).

## Claude Code vs CLI Tools

- Claude Code's Task tool handles ALL execution: agents, file ops, code generation, git
- CLI tools handle coordination via Bash: monoswarm init, memory, hooks, routing
- NEVER use CLI tools as a substitute for Task tool agents

## Support

- Documentation: https://github.com/monoes/monomind
- Issues: https://github.com/monoes/monomind/issues
# monomind:start instructions:claude
# Monomind

Use the `monomind` MCP tools for graph navigation, impact analysis, memory, and organization work.
For multi-step work, load only the applicable `mastermind-*` skill; do not load all workflows at once.
If MCP is unavailable, run `npx -y monomind@latest doctor` and use `npx -y monomind@latest` commands.
# monomind:end instructions:claude
