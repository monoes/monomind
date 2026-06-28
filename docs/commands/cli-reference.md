# CLI Reference

> Complete reference for `monomind` (and `npx monomind@latest`) CLI commands. Version 1.15.7.

**Usage:** `monomind <command> [subcommand] [options]`

---

## Quick Reference

| Command | Subcommands | Purpose |
|---|---|---|
| `init` | 5 | Project initialization |
| `agent` | 8 | Agent lifecycle management |
| `swarm` | 6 | Multi-agent swarm coordination |
| `memory` | 11 | LanceDB with vector search |
| `mcp` | 9 | MCP server management |
| `task` | 6 | Task lifecycle |
| `session` | 7 | Session state management |
| `config` | 7 | Configuration management |
| `hooks` | 27 | Self-learning hooks + workers |
| `hive-mind` | 6 | Byzantine fault-tolerant consensus |
| `daemon` | 5 | Background worker daemon |
| `neural` | 5 | Neural pattern training |
| `security` | 6 | Security scanning |
| `performance` | 5 | Performance profiling |

| `deployment` | 5 | Deployment management |
| `embeddings` | 4 | Vector embeddings |
| `claims` | 4 | Claims-based authorization |
| `doctor` | 1 | System diagnostics |
| `monograph` | 43 | Knowledge graph |
| `guidance` | — | Governance control plane |
| `browse` | 55 | CDP browser automation |

---

## `monomind init`

Initialize monomind in a project.

```bash
monomind init                     # interactive wizard
monomind init --preset minimal    # minimal config (hooks only)
monomind init --preset full       # all features
monomind init --preset team       # multi-developer setup
monomind init --skip-hooks        # skip hook configuration
monomind init --force             # overwrite existing config
```

**What it creates:**
- `.monomind/` directory (not gitignored — committed to source control)
- `.claude/settings.json` — hook wiring
- `.claude/helpers/` — CJS runtime files
- `.monomind/.gitignore` — excludes only sensitive/machine-specific data (sessions, security, tmp, logs, daemon.pid, .db)

---

## `monomind agent`

```bash
monomind agent spawn --type coder --task "implement JWT auth"
monomind agent spawn --type architect --name "lead-arch" --model sonnet
monomind agent list                          # list all agents
monomind agent list --status active         # filter by status
monomind agent status <agent-id>
monomind agent stop <agent-id>
monomind agent metrics <agent-id>           # per-agent performance
monomind agent metrics --all --period today
```

**Agent types:** `coordinator`, `researcher`, `coder`, `analyst`, `architect`, `tester`, `reviewer`, `optimizer`, `documenter`, `monitor`, `specialist`, `queen`, `worker`

---

## `monomind swarm`

```bash
monomind swarm init --topology hierarchical --strategy specialized --max-agents 8
monomind swarm init --topology mesh --strategy adaptive --consensus raft
monomind swarm start
monomind swarm status
monomind swarm status --watch             # continuous monitoring
monomind swarm scale --agents 12
monomind swarm coordinate "task description"
monomind swarm stop
```

**Topologies:** `hierarchical`, `mesh`, `centralized`, `hybrid`, `hierarchical-mesh`, `adaptive`  
**Strategies:** `specialized`, `adaptive`, `balanced`, `sequential`, `parallel`  
**Consensus:** `raft`, `byzantine`, `gossip`, `crdt`, `quorum`

---

## `monomind memory`

```bash
monomind memory init                    # initialize hybrid backend (default)
monomind memory init -b lancedb         # initialize LanceDB-only backend (solo mode, no SQLite)
monomind memory init -b sqlite          # initialize SQLite-only backend
monomind memory init -b hybrid          # initialize hybrid backend explicitly
monomind memory init --path ./data/memory.db --force   # reinitialize at custom path
monomind memory store \
  --content "JWT: use RS256, refresh 7d" \
  --namespace "auth" \
  --tags "security,jwt"
monomind memory store --file path/to/notes.md
monomind memory edit <id>               # update existing entry
monomind memory retrieve <id>
monomind memory search "JWT authentication" \
  --mode hybrid \                        # semantic | bm25 | hybrid
  --threshold 0.7 \
  --namespace auth \
  --limit 10
monomind memory list --namespace auth --type semantic
monomind memory delete <id>
monomind memory templates               # list memory templates
monomind memory stats                   # usage statistics
monomind memory configure               # update backend settings
monomind memory cleanup                 # prune expired entries
monomind memory compress               # compress old entries
monomind memory export --output memory.json
monomind memory import --input memory.json
```

**Backend options for `memory init`:**

| Backend | Flag | Description |
|---|---|---|
| `hybrid` | `-b hybrid` | Default — SQLite (structured) + LanceDB (vector). Dual-write for consistency. |
| `lancedb` | `-b lancedb` | Solo LanceDB mode — fully SQLite-free. LanceDB handles all structured and vector queries. Requires `@lancedb/lancedb` and `apache-arrow`. |
| `sqlite` | `-b sqlite` | SQLite only. No vector search. |

> **Solo LanceDB mode** (`-b lancedb`): when `semanticBackend='lancedb'` and no SQLite path is configured, a single LanceDB instance handles all reads and writes. This eliminates the SQLite dependency entirely and is recommended for pure vector-search workloads.

---

## `monomind mcp`

```bash
monomind mcp start                      # start MCP server (stdio transport)
monomind mcp start --transport http --port 3000
monomind mcp start --transport websocket
monomind mcp status
monomind mcp list                       # list all 138 tools
monomind mcp list --category memory
monomind mcp call <tool-name> --args '{"key": "val"}'
monomind mcp restart
monomind mcp stop
monomind mcp logs
```

**138 MCP tools** across categories: memory, swarm, agent, hooks, hive-mind, monograph, claims, browser, performance, neural, guidance, embeddings.

---

## `monomind task`

```bash
monomind task create --title "Implement webhook" --description "..."
monomind task create --file spec.md    # parse spec into tasks
monomind task list
monomind task list --status pending
monomind task get <task-id>
monomind task update <task-id> --status in_progress
monomind task update <task-id> --status completed
monomind task delete <task-id>
```

---

## `monomind session`

```bash
monomind session start
monomind session restore
monomind session status                 # show elapsed time + metrics
monomind session end
monomind session list                   # list archived sessions
monomind session get <session-id>
monomind session cleanup --older-than 30d
```

---

## `monomind config`

```bash
monomind config get                     # show all config
monomind config get memory.backend
monomind config set memory.backend hybrid
monomind config set swarm.maxAgents 8
monomind config list                    # list all keys
monomind config reset                   # reset to defaults
monomind config validate                # check for invalid values
monomind config export --output config.json
```

---

## `monomind hooks`

27 subcommands — see [`docs/concepts/hooks.md`](../concepts/hooks.md) for the full reference.

```bash
monomind hooks pre-task --description "implement JWT auth"
monomind hooks post-task --task-id "abc123" --success true
monomind hooks route --task "add authentication to API"
monomind hooks pretrain                 # run 4-step learning pipeline
monomind hooks worker list              # list all workers + status
monomind hooks statusline               # generate statusline output
monomind hooks metrics                  # hook execution metrics
```

---

## `monomind hive-mind`

```bash
monomind hive-mind init \
  --topology hierarchical-mesh \
  --consensus byzantine
monomind hive-mind spawn --workers 5 --claude   # --claude: Claude as Queen
monomind hive-mind status
monomind hive-mind consensus propose "use PostgreSQL"
monomind hive-mind memory search "architecture decisions"
monomind hive-mind shutdown
```

---

## `monomind daemon`

```bash
monomind daemon start                   # start background workers
monomind daemon stop
monomind daemon status
monomind daemon restart
monomind daemon logs                    # view worker logs
```

---

## `monomind neural`

```bash
monomind neural patterns list
monomind neural patterns search "auth"
monomind neural predict --input "implement auth"   # predict routing from logged patterns
monomind neural optimize --method quantize
monomind neural status
```

> Neural training (`neural train`, `--flash`/`--moe`) was removed in the lean build; it lives on the `monoes-full-loop` branch.

---

## `monomind security`

```bash
monomind security scan                  # full security scan
monomind security scan --path src/
monomind security scan --severity critical  # filter by severity
monomind security cve list              # list tracked CVEs
monomind security cve check             # check for CVE exposure
monomind security audit                 # generate security audit report
monomind security fix --cve CVE-2024-XXXX  # auto-remediate CVE
```

---

## `monomind performance`

```bash
monomind performance profile            # profile current session
monomind performance benchmark          # run full benchmark suite
monomind performance optimize           # apply optimizations
monomind performance optimize --target memory  # memory | cpu | latency | all
monomind performance optimize --apply         # apply (vs dry-run)
monomind performance report             # generate performance report
```

---

## `monomind deployment`

```bash
monomind deployment create --env staging
monomind deployment list
monomind deployment status <deployment-id>
monomind deployment rollback <deployment-id>
monomind deployment logs <deployment-id>
```

---

## `monomind embeddings`

```bash
monomind embeddings generate --input "text to embed"
monomind embeddings generate --file document.txt
monomind embeddings search "query" --index my-index
monomind embeddings index build --source ./docs
```

---

## `monomind claims`

Claims-based authorization for multi-agent environments:

```bash
monomind claims claim --resource "file:src/auth.ts" --agent coder-1
monomind claims release --resource "file:src/auth.ts"
monomind claims steal --resource "file:src/auth.ts"   # force-take from another agent
monomind claims list                    # list all active claims
```

---

## `monomind doctor`

```bash
monomind doctor                         # run parallel health checks
monomind doctor --fix                   # auto-fix issues where possible
monomind doctor --check gitignore       # check a specific component
monomind doctor --check helpers         # check helper file drift
```

Checks: Node.js ≥20, npm ≥9, git, config validity, daemon status, memory DB, API keys, MCP connectivity, disk space, TypeScript compilation, gitignore coverage, helper file drift.

**Gitignore coverage** (`gitignore`): verifies that all monomind runtime paths (sessions, logs, daemon.pid, `.db` files, etc.) are covered by `.gitignore`. Reports missing patterns and provides a one-line fix command.

**Helper file drift** (`helpers`): compares `.claude/helpers/*.cjs` files in the project against the bundled versions shipped with the current CLI. Reports stale helpers and the fix command to re-run `monomind init`.

---

## `monomind monograph`

```bash
monomind monograph build                # build knowledge graph
monomind monograph build --code-only    # fast: skip doc/PDF extraction
monomind monograph build --llm          # add LLM semantic extraction
monomind monograph build --force        # force full rebuild

monomind monograph search "authentication"
monomind monograph search "auth" --mode semantic  # bm25 | semantic | hybrid
monomind monograph search "auth" --label file     # filter node type

monomind monograph stats                # node/edge counts, top concepts
monomind monograph health               # staleness: commits behind HEAD
monomind monograph watch                # incremental rebuild on file changes

monomind monograph analyze              # full analysis pipeline
monomind monograph export --format graphml --output graph.graphml
# formats: json, svg, graphml, cypher, html, markdown, SARIF
```

43 MCP tools available — see the [Knowledge Graph section in CLAUDE.md](../../CLAUDE.md) for the full tool reference organized by category (core navigation, change impact, graph exploration, index lifecycle, snapshots, wiki & AI docs, multi-repo).

---

## `monomind guidance`

Governance control plane (ADR-G001 through ADR-G026):

```bash
monomind guidance status                # governance status
monomind guidance validate              # validate agent outputs against constitution
monomind guidance audit                 # audit recent decisions
monomind guidance enforce               # enforce governance rules
```

---

## `monomind browse`

Pure CDP browser automation via Chrome DevTools Protocol — no Playwright, Puppeteer, or external binary required. Provides a ref-based element model (`@e1`, `@e2`, ...) and token-efficient accessibility snapshots.

55 subcommands covering: navigation, interaction, inspection, network interception, session state, mobile emulation, performance profiling, and recording.

```bash
# Navigation
npx monomind browse open https://app.example.com
npx monomind browse open https://app.example.com --headed   # visible window
npx monomind browse navigate back|forward|reload

# Snapshots & inspection
npx monomind browse snapshot -i          # interactive elements only (93% token reduction)
npx monomind browse snapshot --save baseline.txt
npx monomind browse snapshot --diff baseline.txt
npx monomind browse get url
npx monomind browse get title
npx monomind browse get text @e5
npx monomind browse get value @e2
npx monomind browse get attr @e3 href
npx monomind browse get count ".item"
npx monomind browse get box @e1
npx monomind browse get styles @e1

# Interaction
npx monomind browse click @e1
npx monomind browse click --x 400 --y 300   # click by coordinates
npx monomind browse dblclick @e1
npx monomind browse fill @e2 "value"
npx monomind browse type @e2 "appended text"
npx monomind browse press Enter
npx monomind browse press "Control+a"
npx monomind browse hover @e1
npx monomind browse focus @e1
npx monomind browse select @e1 "Option text"
npx monomind browse check @e1
npx monomind browse uncheck @e1
npx monomind browse drag @e1 @e2
npx monomind browse upload @e1 ./file.pdf
npx monomind browse download @e1 ./output.pdf

# State queries
npx monomind browse isvisible @e1
npx monomind browse isenabled @e1
npx monomind browse ischecked @e1

# Scrolling
npx monomind browse scroll down 300
npx monomind browse scroll up --selector ".sidebar"
npx monomind browse scrollintoview @e1

# Waiting
npx monomind browse wait --text "Success"
npx monomind browse wait --url "**/dashboard"
npx monomind browse wait --selector ".modal"
npx monomind browse wait --ms 500
npx monomind browse wait --download ./output.csv

# Screenshots & recording
npx monomind browse screenshot output.png
npx monomind browse screenshot --full full-page.png
npx monomind browse screenshot --annotate        # overlay @eN labels
npx monomind browse pdf output.pdf
npx monomind browse record start output.gif
npx monomind browse record stop

# Network interception & inspection
npx monomind browse network route --pattern "**/*.json" --fulfill '{"ok":true}'
npx monomind browse network capture start
npx monomind browse network requests
npx monomind browse errors               # check for JS errors

# Browser configuration
npx monomind browse set viewport 1280 720
npx monomind browse set device "iPhone 14"
npx monomind browse set geo 37.7749 -122.4194
npx monomind browse set offline true
npx monomind browse set media dark
npx monomind browse set useragent "MyBot/1.0"

# Session state
npx monomind browse state save my-session
npx monomind browse state load my-session
npx monomind browse state list
npx monomind browse state show
npx monomind browse state clear
npx monomind browse state rename old-name new-name
npx monomind browse state clean --older-than 7

# Tabs
npx monomind browse tab new
npx monomind browse tab list
npx monomind browse tab switch <id>
npx monomind browse tab close <id>

# Frames
npx monomind browse frame list
npx monomind browse frame switch <id>

# JavaScript evaluation
npx monomind browse eval "document.title"
npx monomind browse eval --stdin          # read expression from stdin

# Storage
npx monomind browse storage get localStorage key
npx monomind browse storage set sessionStorage key value

# Keyboard / touch
npx monomind browse keyboard inserttext "hello"
npx monomind browse keydown Shift
npx monomind browse keyup Shift
npx monomind browse tap @e1
npx monomind browse swipe up 300

# Performance & diagnostics
npx monomind browse vitals              # Web Vitals (LCP, FID, CLS)
npx monomind browse har start
npx monomind browse har stop output.har
npx monomind browse trace start
npx monomind browse trace stop output.json
npx monomind browse profiler start
npx monomind browse profiler stop output.json
npx monomind browse diff baseline.png   # visual diff

# Misc
npx monomind browse close               # close session
npx monomind browse connect --port 9222 # connect to existing Chrome
npx monomind browse find "Submit"       # find element by text
npx monomind browse highlight @e1       # highlight element
npx monomind browse resize 1440 900     # resize window
npx monomind browse clipboard read
npx monomind browse clipboard write "text"
npx monomind browse dialog accept
npx monomind browse dialog dismiss
npx monomind browse cookies list
npx monomind browse batch ./commands.txt  # run a batch of commands
```

---

## Global Flags

```bash
--help, -h          Show help
--version, -v       Show version
--json              Output as JSON
--quiet             Suppress output except errors
--debug             Enable debug logging
--config <path>     Use custom config file
```
