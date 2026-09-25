---
name: workflows:workflow-create
description: Create a reusable multi-agent workflow as an org config with npx monomind org create, then edit and validate it
---

# Workflow Create

Create a reusable workflow. The CLI has no `workflow` command; a reusable workflow is an org config in `.monomind/orgs/<name>.json`.

## How to Invoke

```
Skill("workflows:workflow-create")
```

---

## CLI Reference

```bash
# Scaffold from a starter template
npx monomind org create api-dev --template dev-team --goal "Deliver API features from the backlog"

# Scheduled workflow (hosted by `org serve`)
npx monomind org create weekly-brief --template research-pod --goal "Weekly AI tooling brief" --schedule 2h

# Overwrite an existing config
npx monomind org create api-dev --template dev-team --force

# Validate after editing the JSON
npx monomind org validate api-dev

# List orgs in the project
npx monomind org list
```

## `org create` Flags

| Flag | Description |
|------|-------------|
| `--template` | `content-team` \| `dev-team` \| `research-pod` \| `kg-extraction` \| `advisor-orchestrator` |
| `--goal` | Org goal (defaults to the template's placeholder) |
| `--schedule` | Daemon schedule, e.g. `30m` or `2h` |
| `--force` | Overwrite an existing org config |
| `-y, --yes` | Skip the per-role model confirmation prompt |

## Workflow

1. Scaffold from the closest template:
   ```bash
   npx monomind org create auth-flow --template dev-team --goal "Build auth features"
   ```

2. Edit `.monomind/orgs/auth-flow.json` — adjust roles, responsibilities, and models. For a guided design, use the `mastermind-createorg` skill; to add a role, use `mastermind-new-agent`.

3. Validate and preview:
   ```bash
   npx monomind org validate auth-flow
   npx monomind org run auth-flow --dry-run
   ```

4. Reuse it:
   ```bash
   npx monomind org run auth-flow --task "Add password reset"
   ```

## In-Conversation Alternative

For a one-off workflow, no config is needed: write the stages as a TodoWrite list and spawn Task-tool agents per stage (see `workflows:workflow-execute`). To keep the pattern for later:

```bash
npx monomind memory store --key "workflow-auth" \
  --value "plan (planner) -> implement+test in parallel (coder, tester) -> review (reviewer)" \
  --namespace patterns
```

## Related Skills

- `workflows:workflow-execute` — Run workflows
- `workflows:workflow-export` — Inspect and export workflows
- `mastermind-createorg` — Design an org interactively
