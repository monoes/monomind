---
name: workflows:workflow-execute
description: Run multi-agent workflows using built-in templates (development, research, testing, sparc, security-audit, etc.) via real npx monomind workflow run CLI
---

# Workflow Execute

Run multi-agent workflows using built-in templates or custom workflow files.

## How to Invoke

```
Skill("workflows:workflow-execute")
```

---

## CLI Reference

```bash
# Run a built-in template
npx monomind workflow run -t development --task "Build REST API with auth"
npx monomind workflow run -t research --task "Analyze performance bottlenecks"
npx monomind workflow run -t testing
npx monomind workflow run -t security-audit
npx monomind workflow run -t sparc --task "New payment module"

# Run from a workflow file
npx monomind workflow run -f ./workflow.yaml
npx monomind workflow run -f ./workflow.json

# Validate without executing
npx monomind workflow run -t development --dry-run
```

## All Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--template` | `-t` | — | Built-in template name |
| `--file` | `-f` | — | Workflow definition file (YAML/JSON) |
| `--task` | — | — | Task description passed to the workflow |
| `--parallel` | `-p` | `true` | Enable parallel agent execution |
| `--max-agents` | `-m` | `5` | Maximum agents to spawn |
| `--timeout` | — | `30` | Timeout in minutes |
| `--dry-run` | `-d` | `false` | Validate without executing |

## Built-in Templates

| Template | Stages | Agent Types |
|----------|--------|-------------|
| `development` | Planning → Implementation → Testing → Review → Integration | coder, tester, reviewer |
| `research` | Discovery → Analysis → Synthesis → Documentation | researcher, analyst |
| `testing` | Unit → Integration → E2E → Performance | tester, coder |
| `security-audit` | Threat Model → Static → Dynamic → Report | security-architect, auditor |
| `code-review` | Initial → Security → Quality → Feedback | reviewer, auditor, analyst |
| `refactoring` | Analysis → Planning → Refactor → Validation | architect, coder, reviewer |
| `sparc` | Spec → Pseudocode → Architecture → Refinement → Completion | architect, coder, tester, reviewer |
| `custom` | Define your own | configurable |

## MCP Tools

```javascript
// Run a workflow
mcp__monomind__workflow_run({
  template: "development",
  task: "Build REST API with auth",
  options: {
    parallel: true,
    maxAgents: 6,
    timeout: 30,
    dryRun: false
  }
})

// Check workflow status after launch
mcp__monomind__workflow_status({ workflowId: "wf-123" })

// List all workflows
mcp__monomind__workflow_list({ status: "running", limit: 10 })

// Stop a running workflow
mcp__monomind__workflow_cancel({ workflowId: "wf-123" })
```

## After Launch

Track progress:

```bash
# Check status by ID (shown after run)
npx monomind workflow status <workflowId>

# List all running workflows
npx monomind workflow list --status running
```

## Related Skills

- `workflows:workflow-create` — Save a custom workflow template
- `workflows:development` — Development workflow coordination pattern
- `workflows:research` — Research workflow coordination pattern
- `swarm:swarm` — Direct swarm init for custom coordination
