---
name: hooks:overview
---

# Hooks System Overview

Self-learning hooks for intelligent workflow automation. Hooks connect Claude Code tool events to Monomind's pattern learning, agent routing, and session persistence.

## How It Works

Claude Code fires hook events (PreToolUse, PostToolUse, etc.) which trigger `npx monomind hooks <subcommand>` commands. The hooks system:

1. **Routes** tasks to optimal agents using learned patterns
2. **Records** outcomes (edits, commands, tasks) for neural pattern learning
3. **Persists** session state across conversations
4. **Bootstraps** intelligence from repository code

## CLI Subcommands

All hooks are invoked as `npx monomind hooks <subcommand>`:

### Lifecycle Hooks
| Subcommand | Purpose |
|---|---|
| `pre-edit` | Context + agent suggestions before file edit |
| `post-edit` | Record edit outcome for learning |
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
| `pretrain` | Bootstrap intelligence from repo (4-step pipeline) |
| `build-agents` | Generate optimized agent configs from pretrain data |
| `metrics` | View learning metrics dashboard |
| `model-route` | Route to optimal model (haiku/sonnet/opus) |
| `model-outcome` | Record model routing result |
| `model-stats` | View model routing statistics |

### Coverage & Token Tools
| Subcommand | Purpose |
|---|---|
| `coverage-route` | Route based on test coverage gaps |
| `coverage-suggest` | Suggest coverage improvements |
| `coverage-gaps` | List all coverage gaps with priorities |
| `token-optimize` | Token optimization (30-50% savings) |

### Workers & Utilities
| Subcommand | Purpose |
|---|---|
| `worker` | Background worker management (12 workers) |
| `intelligence` | RuVector trajectory and pattern system |
| `notify` | Send a notification |
| `statusline` | Generate dynamic statusline display |
| `list` | List all registered hooks |
| `progress` | Check v1 implementation progress |
| `transfer` | Transfer patterns via IPFS or from another project |

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

## Model Routing Output (pre-task)

`npx monomind hooks pre-task -d "your task"` outputs one of:
- `[AGENT_BOOSTER_AVAILABLE]` — skip LLM entirely, use Agent Booster (< 1ms, $0)
- `[TASK_MODEL_RECOMMENDATION] Use model="haiku|sonnet|opus"` — use that model in Task tool
