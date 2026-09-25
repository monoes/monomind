---
name: workflows:README
description: Workflow skills index — run multi-agent workflows with the Task tool in Claude Code, or as a persistent org with monomind org; there is no workflow CLI command
---

# Workflows Skills

Skills for running multi-stage, multi-agent workflows in Monomind.

The CLI has no `workflow` command. A workflow runs in one of two real ways:

1. **In the conversation** — Claude Code runs the stages itself, spawning Task-tool agents (all independent agents in one message) and tracking steps with TodoWrite. Best for one-off work.
2. **As an org** — `monomind org` runs a set of roles as a controlled daemon from a JSON config in `.monomind/orgs/<name>.json`. Best for repeatable or scheduled workflows.

## Available Skills

- [workflow-execute](./workflow-execute.md) — Run a workflow (Task tool or `org run`)
- [workflow-create](./workflow-create.md) — Create a reusable workflow as an org config
- [workflow-export](./workflow-export.md) — List, inspect, and export workflows (org configs, Mermaid flow)
- [development](./development.md) — Development workflow pattern
- [research](./research.md) — Research workflow pattern

## Real CLI Commands

```bash
# Scaffold an org from a starter template
npx monomind org create api-dev --template dev-team --goal "Build REST API with auth"

# Validate, preview, run
npx monomind org validate api-dev
npx monomind org run api-dev --dry-run
npx monomind org run api-dev --task "Add refresh-token rotation"

# Observe and control
npx monomind org list
npx monomind org status api-dev
npx monomind org logs api-dev --follow
npx monomind org stop api-dev
npx monomind org report api-dev

# Portable step-by-step procedures (plan, execute, review, debug, research, ...)
npx monomind mastermind --list
npx monomind mastermind run plan --print

# Staged task graph with dependencies
npx monomind task create -t implementation -d "Implement auth API"
npx monomind task create -t testing -d "Test auth API" --dependencies <task-id>
```

## Org Starter Templates

| Template | Roles |
|----------|-------|
| `dev-team` | tech-lead, developer, code-reviewer, qa |
| `research-pod` | lead-analyst, researcher, fact-checker |
| `content-team` | editor-in-chief, writer, reviewer |
| `kg-extraction` | kg-lead, entity-extractor, relationship-resolver, ontology-validator |
| `advisor-orchestrator` | advisor, worker-1, worker-2 |

## MCP Tools

There are no workflow MCP tools. Related real tools:

```javascript
mcp__monomind__monoswarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" })
mcp__monomind__task_create({ /* see task_create schema */ })
mcp__monomind__memory_pattern-store({ pattern: "JWT auth + Zod validation worked well", type: "workflow" })
mcp__monomind__memory_pattern-search({ query: "auth workflow", topK: 5 })
```
