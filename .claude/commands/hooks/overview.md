---
name: hooks:overview
description: Lifecycle hooks that log edits, outcomes and trajectories to local pattern files and route tasks to agents.
---

# Hooks System Overview

Lifecycle hooks that connect Claude Code tool events to Monomind's outcome logging, agent routing, and session persistence. Hooks log edits, outcomes and trajectories to a local pattern store (SQLite `patterns.db`, JSON fallback); no model is trained.

## How It Works

Claude Code fires hook events (PreToolUse, PostToolUse, etc.) which trigger `npx monomind hooks <subcommand>` commands. The hooks system:

1. **Routes** tasks to agents through the keyword picker (pick stats act as a bounded ranking prior)
2. **Records** outcomes (edits, commands, tasks) in a local pattern store (SQLite, JSON fallback)
3. **Persists** session state across conversations
4. **Scans** the repository (file types, import lines) into the memory store and local pattern log (`hooks pretrain`)

## CLI Subcommands

All hooks are invoked as `npx monomind hooks <subcommand>`:

### Lifecycle Hooks
| Subcommand | Purpose |
|---|---|
| `pre-edit` | Context + agent suggestions before file edit |
| `post-edit` | Record edit outcome |
| `pre-command` | Risk assessment before running a command |
| `post-command` | Record command outcome |
| `pre-task` | Register task start, get agent suggestions + model routing |
| `post-task` | Record task completion |
| `session-end` | End session and persist state |
| `session-restore` | Restore a previous session |

### Intelligence & Routing
| Subcommand | Purpose |
|---|---|
| `route` | Route task to optimal agent |
| `explain` | Explain routing decision |
| `pretrain` | Scan the repository (file types, import lines) into the memory store and local pattern log (no model is trained) |
| `metrics` | View recorded routing/outcome metrics |
| `model-route` | Route to optimal model (haiku/sonnet/opus) |
| `model-outcome` | Record model routing result |
| `model-stats` | View model routing statistics |

### Coverage Tools
| Subcommand | Purpose |
|---|---|
| `coverage-route` | Route based on test coverage gaps |
| `coverage-suggest` | Suggest coverage improvements |
| `coverage-gaps` | List all coverage gaps with priorities |

### Workers & Utilities
| Subcommand | Purpose |
|---|---|
| `worker` | Background worker management (<!-- doc-count:workers -->9<!-- /doc-count:workers --> workers; `worker list`, `worker run <name>`) |
| `intelligence` | JS pattern/trajectory store (train, patterns, predict, optimize, export, import) |
| `notify` | Send a notification |
| `statusline` | Generate dynamic statusline display |
| `list` | List all registered hooks |
| `transfer` | Transfer patterns from another local project |

## Claude Code Integration

Configure in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [{
          "type": "command",
          "command": "npx monomind hooks pre-edit --file '${tool.params.file_path}'"
        }]
      },
      {
        "matcher": "^Bash$",
        "hooks": [{
          "type": "command",
          "command": "npx monomind hooks pre-command --command '${tool.params.command}'"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [{
          "type": "command",
          "command": "npx monomind hooks post-edit --file '${tool.params.file_path}' --success true"
        }]
      }
    ]
  }
}
```

## 4-Step Intelligence Pipeline (pretrain)

Running `npx monomind hooks pretrain` executes:
1. **RETRIEVE** — Top-k memory injection with MMR diversity
2. **JUDGE** — LLM-as-judge trajectory evaluation
3. **DISTILL** — Extract strategy memories from trajectories
4. **CONSOLIDATE** — Dedup, detect contradictions, prune old patterns

Optionally adds:
5. **EMBED** — Index documents with ONNX model
6. **HYPERBOLIC** — Poincaré ball projection for hierarchy preservation

