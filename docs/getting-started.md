# Getting Started with Monomind

> **Version:** v1.15.7 · **Node.js:** ≥20 · **Platform:** macOS, Linux, Windows

Monomind is a self-learning Claude Code orchestration layer. It intercepts Claude Code's lifecycle events, routes tasks to specialist agents, maintains persistent memory across sessions, coordinates multi-agent swarms, and continuously improves through neural pattern learning.

---

## Prerequisites

- **Node.js 20+** and **npm 9+**
- **Claude Code** CLI installed and authenticated
- **Git** (for `.monomind/` state tracking)
- Optional: `monotask` Rust CLI (`cargo install monotask`) for task board features

---

## Installation

### 1. Install the package

```bash
# Install globally (recommended)
npm install -g monomind

# Or use npx without installing
npx monomind@latest <command>
```

### 2. Initialize in your project

```bash
cd your-project
monomind init
```

The `init` wizard creates `.monomind/` in your project root with:
- Hook configuration files
- Session state directory
- Memory Palace storage
- Agent registry snapshot

### 3. Add the MCP server to Claude Code

```bash
# Required: use 'mcp start' subcommand explicitly
claude mcp add monomind -- npx monomind@latest mcp start
```

> Note: the `--` separator and explicit `mcp start` are required. Auto-detect via piped stdin is disabled by default.

### 4. Verify installation

```bash
monomind doctor --fix
```

The doctor command runs 21 parallel health checks: Node.js version, npm version, git, config files, daemon status, memory database, API keys, MCP server connectivity, disk space, TypeScript compilation, knowledge graph freshness (FRESH/stale/commits-behind), gitignore coverage for all monomind runtime paths, and helper file drift detection. Inline fix hints are shown for every warn/fail — `--fix` is no longer required for guidance.

---

## First Session

After initialization, open Claude Code in your project directory. On the first session you will see:

```
[SESSION_START] Monomind v1.15.7 active
[KNOWLEDGE_PRELOADED] 3 excerpts (direct keyword search)
[TOKEN_USAGE] Today: $0.00 (0 calls)  |  Month: $0.00 (0 calls)
```

These are injected as system context before your first message.

---

## Key Concepts

### Hook System

Monomind hooks into Claude Code lifecycle events defined in `.claude/settings.json`:

| Event | Hook | What happens |
|---|---|---|
| `SessionStart` | `session-restore` | Loads memory, starts workers, injects context |
| `UserPromptSubmit` | `route` | Routes task to optimal agent, injects intelligence |
| `PreToolUse(Bash)` | `pre-bash` | Safety validation for destructive commands |
| `PostToolUse(Edit/Write)` | `post-edit` | Records edit for pattern learning |
| `TeammateIdle/TaskCompleted` | `post-task` | Stores task outcome in Memory Palace |
| `SessionEnd` | `session-end` | Archives session, consolidates patterns |

### Memory System

Three layers work together:

1. **Memory Palace** (`.monomind/palace/`) — BM25-searchable verbatim chunks from past sessions, auto-injected at startup
2. **LanceDB** (`@monomind/memory`) — Vector-based semantic search with HNSW indexing, 150x–12,500x faster than brute force. Solo mode (`semanticBackend='lancedb'`) is fully SQLite-free when you don't need the hybrid stack.
3. **Monograph** (`.monomind/monograph.db`) — Code knowledge graph with dependency analysis; auto-rebuilds when the index goes stale, guarded against concurrent rebuilds

### Routing

Every user prompt goes through a 4-tier routing waterfall:
1. Non-dev check (trivial prompts skip full routing)
2. Pattern matching (regex on `implement|add|create|fix|...`)
3. Semantic routing (RouteLayer compiled model)
4. Keyword matching (domain keywords)

Output: agent recommendation, confidence score, model tier suggestion.

### Monolean

Monolean is the laziness-ladder coding system built into the Claude Code session. It applies a progressive constraint hierarchy — from lightweight edits to full rewrites — so Claude Code always uses the least expensive intervention that solves the problem. The system is available as `/monolean` and integrates with the pre-edit hook to nudge toward lower rungs before committing to heavy changes.

---

## Core Commands

### Task Workflow

```bash
# Decompose a spec into agent tasks
/monomind:createtask path/to/spec.md

# Execute tasks from the board
/monomind:do

# Research and build the best improvement
/mastermind:autodev

# Research then decompose
/monomind:idea "webhook delivery with retries"
```

### Memory

```bash
# Search memory
monomind memory search "JWT authentication"

# Store a fact
monomind memory store --content "use RS256 for JWT" --namespace "auth"

# View stats
monomind memory stats
```

### Swarms

```bash
# Hierarchical development swarm (recommended default)
monomind swarm init --topology hierarchical --strategy specialized --max-agents 8

# Research swarm (mesh topology)
monomind swarm init --topology mesh --strategy adaptive --max-agents 6
```

### Knowledge Graph

Monograph exposes 43 tools across 6 categories (core navigation, change impact, graph exploration, index lifecycle, snapshots/export, wiki/AI docs). See [`CLAUDE.md`](../CLAUDE.md) for the full tool table.

```bash
# Build code graph (also triggers auto-rebuild when stale)
monomind monograph build --code-only

# Search graph
monomind monograph search "authentication flow"

# Watch mode (incremental updates, 3s debounce)
monomind monograph watch

# Check index freshness
monomind monograph health
```

### MonoBrowse (Browser Automation)

MonoBrowse is a standalone CDP browser automation CLI. It connects directly to Chrome/Chromium via the DevTools Protocol and provides a ref-based element model (`@e1`, `@e2`, ...) with token-efficient accessibility snapshots. No JSON workflow files or external binaries are required.

```bash
# Open a URL (auto-detects and handles login/CAPTCHA walls)
monomind browse open https://example.com

# Capture accessibility snapshot (ref-based element handles)
monomind browse snapshot
monomind browse snapshot --interactive   # interactive elements only (93% token reduction)

# Interact with elements by ref from the last snapshot
monomind browse click @e1
monomind browse fill @e2 "hello world"
monomind browse press Enter
monomind browse hover @e3
monomind browse select @e4 "Option text"
monomind browse check @e5
monomind browse dblclick @e1

# Screenshots
monomind browse screenshot ./output.png
monomind browse screenshot --full        # full-page
monomind browse screenshot --annotate   # overlay @eN labels from last snapshot

# Page data
monomind browse get url
monomind browse get title
monomind browse get text
monomind browse get value @e1
monomind browse get attr @e1 href

# Navigation
monomind browse navigate back
monomind browse navigate forward
monomind browse navigate reload

# Scrolling
monomind browse scroll down 300
monomind browse scroll up

# JavaScript evaluation
monomind browse eval "document.title"

# Session state management
monomind browse state save my-session
monomind browse state load my-session
monomind browse state list

# Browser settings
monomind browse set viewport 1280 800
monomind browse set device "iPhone 12"
monomind browse set media dark

# Network interception
monomind browse network route --pattern "*/api/*" --abort
monomind browse network cookies

# Close the active session
monomind browse close
```

Key capabilities:
- **Ref-based element model** — `snapshot` assigns stable `@eN` handles; `click`, `fill`, `hover`, etc. all accept refs
- **Auto-headed fallback** — detects login walls and CAPTCHA, switches to headed Chrome, then returns to headless after you complete the flow
- **Session persistence** — authenticated sessions saved to `~/.monomind/browser-sessions/` and reused across CLI invocations
- **Platform actions** — built-in actions for LinkedIn, Instagram, X, and Gemini (via `monomind browse action` and `monomind browse platform`)
- **Mobile testing** — `tap`, `swipe`, `set device`, touch event dispatch via CDP
- **File transfer** — `upload` (file inputs) and `download` (click-and-capture with progress tracking)
- **Diagnostics** — `isvisible`, `isenabled`, `ischecked`, `get box`, `get styles`, `get count`

> MonoBrowse requires Chrome/Chromium running with `--remote-debugging-port=9222`. Never use Playwright, Puppeteer, or `mcp__claude-in-chrome__*` tools — always use `monomind browse`.

### Orgs & Autonomous Loops

Orgs are scheduled, self-repeating agent loops. The full org lifecycle (create, run, stop, delete, copy, import/export) is available from both CLI and the dashboard.

```bash
# Create a new org with a schedule
monomind createorg --name "my-improver" --schedule "0 * * * *"

# Run the org immediately
monomind runorg my-improver

# Check status
monomind orgstatus my-improver

# List all orgs
monomind orgs

# Stop a running org
monomind stoporg my-improver
```

Each org run:
- Emits token/cost events visible in the dashboard Costs tab
- Groups all repetitions under a single chat session for clean history
- Streams agent-to-agent (`org:comms`) messages to the dashboard Chat tab in real time
- Guards against re-entry with staleness checks and rep counters in `.monomind/loop-state/`
- Emits `org:artifact` events that appear as artifact cards in the dashboard
- Emits `org:agent:offline` when an agent goes offline, surfaced in the dashboard status view

### Real-Time Dashboard

The dashboard is a self-hosted web UI served by the Monomind daemon. Start it via:

```bash
monomind daemon start
# Then open http://127.0.0.1:<port> in your browser
```

Dashboard features:
- **Org management** — start, stop, and delete orgs; live status with in-memory + disk state reconciliation
- **Session viewer** — browse past and active sessions; loop reps grouped under one session entry
- **Cost & token display** — live cost badge, 30-day trend chart, per-project breakdown, model cost donut
- **Chat tab** — real-time `org:comms` agent conversation stream with SSE deduplication (2000-entry cap); compose bar for sending messages to the active org
- **Artifact cards** — `org:artifact` events render as cards in the dashboard for quick inspection
- **Multi-project isolation** — `?dir=` query param ensures events from different projects never cross-contaminate

### MonoFence AI (AI Security Layer)

MonoFence AI (`monofence-ai`, formerly `@monomind/monodefence`) is an optional security package that intercepts prompts and outputs before execution.

```bash
npm install monofence-ai
```

Detection capabilities:
- **Threat detection** — prompt injection, jailbreak, role-switching, context manipulation, encoding attacks, PII
- **Evasion normalization** — homoglyph substitution, leetspeak, space-separated characters, zero-width characters, base64 payloads
- **Multi-turn escalation tracking** — detects slow-probe campaigns across multiple conversation turns with 30-minute idle decay
- **Output scanning** — PII leakage, prompt echo, policy violations

MonoFence integrates with the Monomind hooks system automatically when installed: `pre-task` and `pre-command` hooks block detected threats before execution.

> If you were using `@monomind/monodefence`, update your import to `monofence-ai`. Backward-compatible aliases are exported with deprecation notices.

---

## Slash Commands Quick Reference

Access inside Claude Code via `/command`:

| Command | Purpose |
|---|---|
| `/mastermind` | Pick a swarm topology — shows all 11 modes, gives concrete recommendation |
| `/mastermind:autodev` | Autonomous: research → build → review. Leading integer = count (e.g., `/mastermind:autodev 3`) |
| `/mastermind:review` | Review current code/work with `--tillend` for continuous review loop |
| `/mastermind:build` | Build a specific feature based on a brief |
| `/mastermind:research` | Deep research on a topic |
| `/mastermind:updateorg` | Edit an existing org's config (schedule, prompt, settings) after creation |
| `/monomind:createtask` | Decompose a spec into agent tasks |
| `/monomind:do` | Execute tasks from board |
| `/monomind:idea` | Research → evaluate → tasks pipeline |
| `/monomind:review` | Multi-agent iterative review loop |
| `/monolean` | Laziness-ladder coding — apply the least invasive change that solves the problem |
| `/tokens` | Token usage dashboard |
| `/ts` | Toggle statusline compact/full mode |

See [`docs/slashcommands.md`](slashcommands.md) for the complete reference.

---

## Autonomous Loop (`--tillend` and Orgs)

Many commands support `--tillend` for continuous autonomous operation within a session. For persistent scheduled loops that survive across sessions, use **Orgs** (see the Orgs & Autonomous Loops section above).

```bash
# Keep reviewing until everything is clean
/mastermind:review --tillend --auto

# Build improvements continuously (stops when no more improvements found)
/mastermind:autodev --tillend --wait 120

# Build 3 improvements per session, repeat until clean
/mastermind:autodev 3 --tillend --wait 60
```

The loop:
1. Runs the command
2. Checks if the round produced any findings or actions
3. If yes → schedules the next run (`--wait` seconds later)
4. If no (empty round) → stops

---

## Background Workers

Monomind runs 12 background workers during sessions:

| Worker | Priority | Purpose |
|---|---|---|
| `ultralearn` | normal | Deep knowledge acquisition from sessions |
| `optimize` | high | Performance optimization analysis |
| `consolidate` | low | Memory consolidation and dedup |
| `predict` | normal | Predictive context preloading |
| `audit` | critical | Security scanning and vulnerability analysis |
| `map` | normal | Codebase mapping and monograph updates |
| `preload` | low | Resource and context preloading |
| `deepdive` | normal | Deep code analysis on changed files |
| `document` | normal | Auto-documentation generation |
| `refactor` | normal | Refactoring opportunity suggestions |
| `benchmark` | normal | Performance benchmarking |
| `testgaps` | normal | Test coverage gap analysis |

Start/stop the daemon:

```bash
monomind daemon start
monomind daemon status
monomind daemon stop
```

---

## Publishing to npm

Two packages need publishing: the scoped CLI and the umbrella:

```bash
# 1. Bump version in root package.json AND packages/@monomind/cli/package.json
# 2. Build CLI
cd packages/@monomind/cli && npm run build
# 3. Publish scoped CLI
npm publish --tag latest
# 4. Publish umbrella
cd ../../.. && npm publish --tag latest
```

---

## Troubleshooting

```bash
# Full system diagnostics
monomind doctor

# Reset corrupted state
monomind config reset

# View daemon logs
monomind daemon logs

# Check MCP connectivity
monomind mcp status
```

For issues: https://github.com/monoes/monomind/issues
