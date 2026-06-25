---
name: workflows:workflow-export
description: Browse, inspect, and manage workflow templates — list built-in templates, show template details and stages, validate workflow files
---

# Workflow Templates

Browse and manage workflow templates — inspect built-in templates and validate custom workflow files.

## How to Invoke

```
Skill("workflows:workflow-export")
```

---

## CLI Reference

```bash
# List all available templates
npx monomind workflow template list

# Show details for a specific template (stages, agents, estimated duration)
npx monomind workflow template show development
npx monomind workflow template show sparc
npx monomind workflow template show security-audit

# Validate a custom workflow file
npx monomind workflow validate -f ./workflow.yaml
npx monomind workflow validate -f ./workflow.json --strict

# List past workflow runs
npx monomind workflow list --status completed --limit 20
npx monomind workflow list --status all
```

## Built-in Templates Reference

| Template | Stages | Estimated Duration |
|----------|--------|--------------------|
| `development` | Planning → Implementation → Testing → Review → Integration | 15-30 min |
| `research` | Discovery → Analysis → Synthesis → Documentation | 10-20 min |
| `testing` | Unit → Integration → E2E → Performance | 5-15 min |
| `security-audit` | Threat Model → Static → Dynamic → Report | 20-40 min |
| `code-review` | Initial → Security → Quality → Feedback | 10-25 min |
| `refactoring` | Analysis → Planning → Refactor → Validation | 15-35 min |
| `sparc` | Spec → Pseudocode → Architecture → Refinement → Completion | 25-45 min |
| `custom` | Define your own stages | varies |

## MCP Tools

```javascript
// List templates
mcp__monomind__workflow_template({})

// List past workflow runs
mcp__monomind__workflow_list({ status: "completed", limit: 20 })

// Get status of a specific run
mcp__monomind__workflow_status({ workflowId: "wf-123" })
```

## Workflow File Format

To create a custom workflow file for use with `workflow run -f`:

```yaml
name: my-workflow
stages:
  - name: Planning
    agents: [architect]
  - name: Implementation
    agents: [coder]
  - name: Testing
    agents: [tester]
  - name: Review
    agents: [reviewer]
```

Validate before running:

```bash
npx monomind workflow validate -f ./my-workflow.yaml --strict
```

## Related Skills

- `workflows:workflow-execute` — Run workflows from templates
- `workflows:workflow-create` — Save a custom workflow as a template
