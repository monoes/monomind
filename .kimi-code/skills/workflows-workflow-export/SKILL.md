---
name: workflows-workflow-export
description: Inspect and export workflows — list org configs, export an org's flow as a Mermaid diagram, summarize runs, and print portable Mastermind procedures
type: flow
---

# Workflow Export

Inspect and export workflows. The CLI has no `workflow` command; the real equivalents operate on org configs (`.monomind/orgs/<name>.json`) and Mastermind procedures.

## How to Invoke

```
Skill("workflows:workflow-export")
```

---

## CLI Reference

```bash
# List orgs (workflows) in the project and their runtime state
npx monomind org list
npx monomind org status

# Validate one or all org configs
npx monomind org validate api-dev
npx monomind org validate

# Export an org's flow as a Mermaid diagram (latest run by default)
npx monomind org flow api-dev
npx monomind org flow api-dev --run <run-id>

# Summarize runs
npx monomind org report api-dev
npx monomind org report api-dev --all
npx monomind org report api-dev --by-role
npx monomind org report api-dev --format mermaid

# Portable step-by-step procedures for platforms without native skills
npx monomind mastermind --list
npx monomind mastermind run plan --print > plan-workflow.md
```

## Sharing a Workflow

The org config is a plain JSON file, so it can be copied into another project's `.monomind/orgs/` and checked with `npx monomind org validate <name>`. For a full archive with the org's data, use the `mastermind-export` skill (and `mastermind-import` on the other side).

## Org Starter Templates

| Template | Roles |
|----------|-------|
| `dev-team` | tech-lead, developer, code-reviewer, qa |
| `research-pod` | lead-analyst, researcher, fact-checker |
| `content-team` | editor-in-chief, writer, reviewer |
| `kg-extraction` | kg-lead, entity-extractor, relationship-resolver, ontology-validator |
| `advisor-orchestrator` | advisor, worker-1, worker-2 |

## Related Skills

- `workflows:workflow-execute` — Run workflows
- `workflows:workflow-create` — Create a reusable workflow
- `mastermind-export` / `mastermind-import` — Org archives
