---
name: automation:workflow-select
description: Pick a predefined multi-agent workflow for a common task.
---

# workflow-select

Pick a predefined multi-agent workflow for a common task. The CLI has no `workflow` command; predefined workflows are org starter templates, run with `monomind org`.

## Templates

| Template | Use for |
|---|---|
| `dev-team` | Feature development: plan, implement, test, review |
| `research-pod` | Research and analysis |
| `content-team` | Content production |
| `kg-extraction` | Knowledge-graph extraction from documents |
| `advisor-orchestrator` | An orchestrator that consults advisor roles |

## Examples

### Create an org from a template

```bash
npx monomind org create oauth --template dev-team --goal "Add OAuth login"
```

### Preview without executing

```bash
npx monomind org validate oauth
npx monomind org run oauth --dry-run
```

### Run it

```bash
npx monomind org run oauth --task "Add OAuth login" --budget-usd 5
```

## Workflow Status

```bash
npx monomind org list
npx monomind org status oauth
npx monomind org logs oauth
```

For a one-off workflow inside the conversation, skip the org and spawn the stage's agents with the Task tool instead (see `/workflows:workflow-execute`).

## See Also

- `auto-agent` — spawn agents without a template
- `smart-spawn` — auto-select agents from task description
- `monoswarm init` — manual monoswarm initialization
