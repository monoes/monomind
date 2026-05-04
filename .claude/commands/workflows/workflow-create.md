---
name: workflows:workflow-create
description: Create and save custom workflow templates using npx monomind workflow template create — save successful workflows for reuse
---

# Workflow Create

Create and save custom workflow templates for reuse.

## How to Invoke

```
Skill("workflows:workflow-create")
```

---

## CLI Reference

```bash
# Create a template from a workflow ID
npx monomind workflow template create --name "my-api-workflow" --workflow wf-abc123

# Create a template from a workflow file
npx monomind workflow template create --name "deploy-workflow" --file ./workflow.yaml

# List existing templates
npx monomind workflow template list

# Show a specific template's stages and agents
npx monomind workflow template show development
npx monomind workflow template show sparc
```

## Template Create Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--name` | `-n` | Template name (required) |
| `--workflow` | `-w` | Workflow ID to save as template |
| `--file` | `-f` | Workflow file to save as template |

## MCP Tools

```javascript
// Create a workflow definition
mcp__monomind__workflow_create({
  name: "my-workflow",
  template: "development",
  task: "Build auth system"
})

// List available templates
mcp__monomind__workflow_template({})

// Execute workflow from template
mcp__monomind__workflow_run({
  template: "my-workflow",
  task: "Build feature X"
})
```

## Workflow

1. Run a workflow that works well:
   ```bash
   npx monomind workflow run -t development --task "Build auth"
   # Note the workflowId in the output
   ```

2. Save it as a reusable template:
   ```bash
   npx monomind workflow template create --name "auth-workflow" --workflow <workflowId>
   ```

3. Reuse it:
   ```bash
   npx monomind workflow run -t auth-workflow --task "New auth task"
   ```

## Related Skills

- `workflows:workflow-execute` — Run workflows from templates
- `workflows:workflow-export` — Browse and manage templates
