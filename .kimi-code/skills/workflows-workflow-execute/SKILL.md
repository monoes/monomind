---
name: workflows-workflow-execute
description: Run multi-agent workflows — in the conversation with Task-tool agents, or as a persistent org with npx monomind org run
type: flow
---

# Workflow Execute

Run a multi-stage, multi-agent workflow. The CLI has no `workflow` command; use one of the two real paths below.

## How to Invoke

```
Skill("workflows:workflow-execute")
```

---

## Path 1: In the Conversation (Task Tool)

Claude Code executes the stages directly:

1. Break the work into stages with TodoWrite (plan → implement → test → review)
2. Spawn every independent agent for a stage in ONE message via the Task tool
3. Wait for results, review them, then start the next stage

```javascript
// Stage: implement + test in parallel
Task({ subagent_type: "coder",  prompt: "Implement the auth API in src/auth/ per the plan ..." })
Task({ subagent_type: "tester", prompt: "Write tests for the auth API contract ..." })

// Next stage: review
Task({ subagent_type: "reviewer", prompt: "Review the diff in src/auth/ ..." })
```

Optionally record topology and roster, and track the task for routing:

```bash
npx monomind monoswarm init --topology hierarchical --max-agents 8
npx monomind hooks pre-task --description "Build REST API with auth" --task-id api-auth
# ... stages run ...
npx monomind hooks post-task --task-id api-auth --success true
```

## Path 2: As an Org (`monomind org`)

For repeatable, scheduled, or long-running workflows:

```bash
# Create from a starter template (or use an existing .monomind/orgs/<name>.json)
npx monomind org create api-dev --template dev-team --goal "Build REST API with auth"

# Validate and preview each role's briefing without starting agents
npx monomind org validate api-dev
npx monomind org run api-dev --dry-run

# Run (foreground daemon); override the goal for this run
npx monomind org run api-dev --task "Add refresh-token rotation"

# Cap spend
npx monomind org run api-dev --budget-usd 5
```

### `org run` Flags

| Flag | Description |
|------|-------------|
| `--task` | Override the org goal for this run |
| `--dry-run` | Validate and print each role's briefing without starting sessions |
| `--resume` | Resume from the persisted checkpoint instead of starting fresh |
| `--budget-usd` | Hard-stop if the upfront cost estimate exceeds this value |
| `-y, --yes` | Skip the cost-estimate confirmation prompt |

## After Launch

```bash
npx monomind org status api-dev          # runtime state
npx monomind org logs api-dev --follow   # live event log
npx monomind org questions api-dev       # pending ask_human questions
npx monomind org approvals api-dev       # pending tool approvals
npx monomind org pause api-dev           # finish current turns, start no new cycles
npx monomind org stop api-dev            # stop the daemon
npx monomind org report api-dev          # outcome, per-role activity, tokens
```

## Related Skills

- `workflows:workflow-create` — Create a reusable workflow as an org config
- `workflows:development` — Development workflow pattern
- `workflows:research` — Research workflow pattern
- `monoswarm:monoswarm` — Monoswarm coordination
- `mastermind-runorg` — Start a saved org
