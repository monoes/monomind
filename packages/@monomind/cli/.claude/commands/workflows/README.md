---
name: workflows:README
description: Workflow skills index — run, validate, and manage multi-agent workflows using real CLI subcommands and MCP tools
---

# Workflows Skills

Skills for running and managing multi-agent workflows in Monomind.

## Available Skills

- [workflow-execute](./workflow-execute.md) — Run workflows using built-in templates
- [workflow-create](./workflow-create.md) — Create and save custom workflow templates
- [workflow-export](./workflow-export.md) — Manage and list workflow templates
- [development](./development.md) — Development workflow coordination pattern
- [research](./research.md) — Research workflow coordination pattern

## Real CLI Subcommands

```bash
# Run a workflow from a template
npx monomind workflow run -t development --task "Build auth system"
npx monomind workflow run -t research --task "Analyze performance"
npx monomind workflow run -f ./workflow.yaml

# Validate a workflow file
npx monomind workflow validate -f ./workflow.yaml --strict

# List running/completed workflows
npx monomind workflow list --status all --limit 10

# Check workflow status
npx monomind workflow status <workflowId>

# Stop a running workflow
npx monomind workflow stop <workflowId>

# Manage templates
npx monomind workflow template list
npx monomind workflow template show development
npx monomind workflow template create --name "my-workflow"
```

## Built-in Templates

| Template | Stages | Agents |
|----------|--------|--------|
| `development` | Planning → Implementation → Testing → Review → Integration | coder, tester, reviewer |
| `research` | Discovery → Analysis → Synthesis → Documentation | researcher, analyst |
| `testing` | Unit → Integration → E2E → Performance | tester, coder |
| `security-audit` | Threat Model → Static → Dynamic → Report | security-architect, auditor |
| `code-review` | Initial → Security → Quality → Feedback | reviewer, auditor, analyst |
| `refactoring` | Analysis → Planning → Refactor → Validation | architect, coder, reviewer |
| `sparc` | Spec → Pseudocode → Architecture → Refinement → Completion | architect, coder, tester, reviewer |
| `custom` | Define your own stages | configurable |

## MCP Tools

```javascript
mcp__monomind__workflow_run({ template: "development", task: "Build feature", options: { parallel: true } })
mcp__monomind__workflow_list({ status: "all", limit: 10 })
mcp__monomind__workflow_status({ workflowId: "wf-123" })
mcp__monomind__workflow_create({})
mcp__monomind__workflow_template({})
```
