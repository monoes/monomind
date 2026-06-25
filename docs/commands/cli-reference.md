# CLI Reference

> Complete reference for `monomind` (and `npx monomind@latest`) CLI commands. Version 1.10.54.

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
| `monograph` | 8+ | Knowledge graph |
| `guidance` | — | Governance control plane |
| `browse` | — | CDP browser automation |

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
monomind memory init                    # initialize backend
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
monomind doctor                         # run 16 parallel health checks
monomind doctor --fix                   # auto-fix issues where possible
```

Checks: Node.js ≥20, npm ≥9, git, config validity, daemon status, memory DB, API keys, MCP connectivity, disk space, TypeScript compilation.

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

CDP browser automation (no Playwright/Puppeteer required):

```bash
npx monomind browse open https://app.example.com
npx monomind browse snapshot -i          # interactive elements only
npx monomind browse click @e1
npx monomind browse fill @e2 "value"
npx monomind browse press Enter
npx monomind browse get text @e5
npx monomind browse get url
npx monomind browse wait --text "Success"
npx monomind browse errors               # check for JS errors
npx monomind browse screenshot output.png
npx monomind browse screenshot --full full-page.png
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
