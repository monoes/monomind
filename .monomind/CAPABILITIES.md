<!-- monomind-block:capabilities -->
# Monomind - Complete Capabilities Reference
> Full documentation: https://github.com/monoes/monomind

## 📋 Table of Contents

1. [Overview](#overview)
2. [Available Agents (60+)](#available-agents)
3. [CLI Commands](#cli-commands)
4. [Hooks System (28 Hook Subcommands + 9 Background Workers)](#hooks-system)
5. [Memory & Intelligence](#memory--intelligence)
6. [Performance Targets](#performance-targets)
7. [Integration Ecosystem](#integration-ecosystem)

---

## Overview

Monomind is a domain-driven design architecture for multi-agent AI coordination with:

- **Agent Orgs** - `monomind org run` runs role-based agent orgs under the Org Runtime
- **ANN Vector Search** - indexed pattern retrieval via SQLite (better-sqlite3, sql.js WASM fallback)
- **Keyword Routing** - deterministic task→agent routing with outcome measurement
- **MCP Server Integration** - Model Context Protocol support

### Current Configuration
| Setting | Value |
|---------|-------|
| Topology | hierarchical-mesh |
| Max Agents | 15 |
| Memory Backend | hybrid |
| `neural.enabled` | On (session start loads the local pattern store only when on; no model is trained) |

---

## Available Agents

The full roster ships as `.claude/agents/**/*.md` and differs per install, so
this file does not list it. Pick agents per task:

- When a prompt carries a `[PICK]` line (`[PICK] agent: <name> · skill: <invoke>`), use that agent/skill unless it is clearly wrong.
- Otherwise call `mcp__monomind__pick` if that tool is available (`{ task, kind: "agents" | "skills" | "both" }`) and use a returned agent `name` as the Task `subagent_type`. Without it (no MCP, or an older server) run `monomind pick -t "<task>" --json`, or `npx -y monomind pick -t "<task>" --json` when `monomind` is not installed.
- A skill's `invoke`: a platform skill (`Skill("<name>")` or `/command`) loads with the Skill tool; an Org skill (`source: "org"`, invoke `mcp__monomind__org_skill_show {"name":"<name>"}`) is read by calling that MCP tool with that input, or with `npx -y monomind org skills show <name>` when the tool is unavailable.

Fallback when picking returns nothing — real core agents:
`coder`, `reviewer`, `tester`, `planner`, `researcher`, `system-architect`, `Security Engineer`, `mesh-coordinator`

---

## CLI Commands

### Core Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | 6 | Project initialization |
| `agent` | 11 | Agent lifecycle management |
| `memory` | 12 | SQLite with ANN vector search |
| `mcp` | 11 | MCP server management |
| `task` | 5 | Task assignment |
| `session` | 6 | Session persistence |
| `config` | 7 | Configuration |
| `status` | 3 | System monitoring |
| `hooks` | 28 | Edit/outcome logging, agent routing + 9 background workers |

> Note: there is no `workflow`, `neural`, `embeddings`, `claims`, `migrate`, or `process` CLI command.
> The old `neural` pattern commands live under `hooks intelligence` — a local JSON pattern store; no model is trained.

### Advanced Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| `security` | 6 | Security scanning |
| `performance` | 4 | Profiling & benchmarks |
| `providers` | 4 | AI provider config |
| `guidance` | 1 | Governance gate setup |
| `doctor` | 0 | Health diagnostics — flat command, flags only (`--component` selects a category) |
| `completions` | 4 | Shell completions |

### Example Commands
```bash
# Initialize
npx monomind init wizard

# Spawn agent
npx monomind agent spawn -t coder --name my-coder

# Memory operations
npx monomind memory store --key "pattern" --value "data" --namespace patterns
npx monomind memory search --query "authentication"

# Diagnostics
npx monomind doctor --fix
```

---

## Hooks System

### 28 Available Hook Subcommands

The four groups below are a curated highlight, not the full 28 — run `monomind hooks --help` for every subcommand.

#### Core Hooks (6)
| Hook | Description |
|------|-------------|
| `pre-edit` | Context before file edits |
| `post-edit` | Record edit outcomes |
| `pre-command` | Risk assessment |
| `post-command` | Command metrics |
| `pre-task` | Task start + agent suggestions |
| `post-task` | Record task outcome |

#### Session Hooks (4)
| Hook | Description |
|------|-------------|
| `session-start` | Start/restore session |
| `session-end` | Persist state |
| `session-restore` | Restore previous |
| `notify` | Cross-agent notifications |

#### Intelligence Hooks (4)
| Hook | Description |
|------|-------------|
| `route` | Optimal agent routing |
| `explain` | Routing decisions |
| `pretrain` | Scan the repository (file types, import lines) into the memory store and local pattern log (no training) |
| `transfer` | Pattern transfer |

#### Coverage Hooks (3)
| Hook | Description |
|------|-------------|
| `coverage-route` | Coverage-based routing |
| `coverage-suggest` | Improvement suggestions |
| `coverage-gaps` | Gap analysis |

### 9 Background Workers (@monoes/hooks, run in-process)
| Worker | Priority | Purpose |
|--------|----------|---------|
| `health` | high | Monitor disk, memory, CPU, processes |
| `ddd` | low | Track DDD domain implementation progress |
| `security` | high | Scan for secrets, vulnerabilities, CVEs |
| `cache` | background | Clean temp files, old logs, stale cache |
| `map` | normal | Codebase mapping — writes .monomind/metrics/codebase-map.json |
| `audit` | high | Security audit — writes .monomind/metrics/security-audit.json |
| `consolidate` | low | RAPTOR memory consolidation — writes .monomind/metrics/consolidation.json |
| `progress` | normal | Implementation metrics — writes .monomind/metrics/progress.json |
| `reflexion` | normal | Turns failed routed tasks from .monomind/route-outcomes.jsonl into templated keyword notes in .monomind/reflexion-store.json (pre-task shows matches) |

Metrics-producing workers (ddd, map, audit, consolidate) refresh at
session start when their output is >6h old; run on demand with
`monomind hooks worker run <name>`.

---

## Memory & Intelligence

### Intelligence System
- **Keyword routing**: Deterministic task→agent routing with outcome measurement
- **ANN pattern search**: Indexed vector search via SQLite
- **Pattern store**: Hooks log edits, outcomes and trajectories to local JSON pattern files for retrieval
- **Pick stats**: Pick adherence and subagent outcomes (`.monomind/pick-stats.json`) act as a bounded ranking prior on later picks
- **Int8 Quantization**: ~4x memory reduction for stored embeddings

No model is trained — routing and pattern logging run in JS on local files.
Route and command outcomes are recorded and scored so routing quality is measured.

### Memory Commands
```bash
# Store pattern
npx monomind memory store --key "name" --value "data" --namespace patterns

# Semantic search
npx monomind memory search --query "authentication"

# List entries
npx monomind memory list --namespace patterns

# Initialize database
npx monomind memory init --force
```

---

## Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| ANN Search | Indexed vector search | ✅ Implemented (SQLite) |
| Memory Reduction | 50-75% | ✅ Implemented (~4x via Int8 quantization) |
| Pattern Logging | Recorded + retrievable | ✅ Implemented (local JSON pattern store) |
| MCP Response | <100ms | ✅ Achieved |
| CLI Startup | <500ms | ✅ Achieved |
| Graph Build (1k) | <200ms | ✅ 2.78ms (71.9x headroom) |
| PageRank (1k) | <100ms | ✅ 12.21ms (8.2x headroom) |
| Insight Recording | <5ms/each | ✅ 0.12ms (41x headroom) |
| Consolidation | <500ms | ✅ 0.26ms (1,955x headroom) |
| Knowledge Transfer | <100ms | ✅ 1.25ms (80x headroom) |

---

## Integration Ecosystem

### Integrated Packages
| Package | Version | Purpose |
|---------|---------|---------|
| better-sqlite3 (sql.js WASM fallback) | latest | SQLite vector database (ANN search) |

### Optional Integrations
| Package | Command |
|---------|---------|
| agentic-jujutsu | `npx agentic-jujutsu@latest` |

### MCP Server Setup
```bash
# Add Monomind MCP
claude mcp add monomind -- npx -y monomind mcp start
```

---

## Quick Reference

### Essential Commands
```bash
# Setup
npx monomind init wizard
npx monomind doctor --fix

# Agents
npx monomind agent spawn -t coder
npx monomind agent list

# Memory
npx monomind memory search --query "patterns"

# Hooks
npx monomind hooks pre-task --description "task"
npx monomind hooks worker run map
```

### File Structure
```
.monomind/
├── config.yaml      # Runtime configuration
├── CAPABILITIES.md  # This file
├── data/            # Memory storage
├── logs/            # Operation logs
├── sessions/        # Session state
├── hooks/           # Custom hooks
├── agents/          # Agent configs
└── workflows/       # Workflow templates
```

---

**Full Documentation**: https://github.com/monoes/monomind
**Issues**: https://github.com/monoes/monomind/issues
<!-- /monomind-block:capabilities -->
