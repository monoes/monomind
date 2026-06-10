---
name: mastermind-plan-to-tasks
description: Mastermind plan-to-tasks — converts a written plan (prose, outline, or structured doc) into assigned org issues with correct specialties, dependency wiring, and parallelization. Mirrors Paperclip's plan-to-tasks skill. Use when breaking down a project plan into executable issue trees.
type: domain-skill
default_mode: confirm
---

# Mastermind Plan to Tasks

This skill is invoked by `mastermind:plan-to-tasks` or directly via `/mastermind:plan-to-tasks`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to create issues in (required)
- `plan`: the plan text (required — paste inline or pipe in)
- `project_id`: assign all issues to this project (optional)
- `workspace_id`: assign all issues to this workspace (optional)
- `dry_run`: true | false (default: false — if true, print plan without creating issues)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Validate Inputs

```bash
[ -z "$org_name" ] && { echo "ERROR: --org required."; exit 1; }
[ -z "$plan"     ] && { echo "ERROR: --plan required (the plan text to decompose)."; exit 1; }

orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }
```

---

## Step 2 — Load Agents for Specialty Matching

```bash
echo "PLAN-TO-TASKS — $org_name"
echo "────────────────────────────────────────────────────────"
echo ""
echo "AGENTS IN ORG:"
jq -r '(.roles // [])[] | "  \(.id)  \(.title // "-")  [\(.adapter.type // "?")]"' "$orgFile"
echo ""
```

---

## Step 3 — Decompose Plan into Issues

Read the plan carefully and apply these rules:

**Planning principles (from Paperclip plan-to-tasks):**

1. **Plan deeply.** Capture real detail: goals, constraints, unknowns, success criteria, risks. A shallow plan becomes rework.
2. **Know your team.** Read the org's agents and their specialties (titles, roles, adapters) before assigning anything.
3. **Assign for specialty.** Hand each piece of work to the most relevant agent. If no agent fits, flag the gap.
4. **Take responsibility.** When you (the AI) are best-suited for a piece, assign it to yourself instead of delegating.
5. **Use the dependency tree.** Express every concrete deliverable as an issue. Wire real blockers via `blockedByIssueIds`. When done, dependents auto-wake.
6. **Order, then parallelize.** Sequence by real dependencies. Independent branches start in parallel.
7. **Enough is enough.** Plans unblock execution. Don't re-plan already clear work.

**Decomposition output:**

For each issue extracted from the plan, produce:
```
ISSUE: <title>
  assignee:    <agent-id or UNASSIGNED>
  priority:    low | medium | high | urgent
  blockedBy:   <issue-title> (or none)
  description: <1-2 sentence summary of the deliverable>
```

**Quality checklist before creating:**
- [ ] Enough detail that assignees can act without re-asking
- [ ] Every concrete deliverable is an issue
- [ ] Each issue has a deliberate, specialty-matched assignee
- [ ] Each issue's real blockers are declared
- [ ] Independent branches can start in parallel
- [ ] Gaps (missing skills, decisions, external inputs) are surfaced, not hidden

---

## Step 4 — Create Issues (unless dry_run=true)

```bash
issuesFile=".monomind/orgs/${org_name}-issues.json"
[ ! -f "$issuesFile" ] && echo '{"issues":[]}' > "$issuesFile"

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Issues are created from the decomposition above
# Each issue gets:
#   id: issue-<timestamp>-<N>
#   title, description, priority, status: open
#   assigneeId (from matched agent)
#   projectId, workspaceId (if provided)
#   blockedByIssueIds (resolved after all issues are created)
#   createdAt, updatedAt

echo ""
if [ "${dry_run:-false}" = "true" ]; then
  echo "DRY RUN — no issues were created."
  echo "Remove --dry-run to create these issues."
else
  echo "CREATED ISSUES:"
  # (issue creation happens inline above as each issue is decomposed)
fi
```

---

## Step 5 — Return Output

```yaml
domain: ops
status: complete
action: plan-to-tasks
org_name: <org_name>
issues_created: <N>
dry_run: <true|false>
```

---

## Step 6 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
