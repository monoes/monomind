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

If `caller` is not "command", load brain context following mastermind-protocol/SKILL.md Brain Load Procedure with namespace: `ops`.

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

For each issue extracted from the plan, emit one object into a JSON array and write the
whole array to `.monomind/orgs/<org_name>-plan-decomposition.json` using the Write tool:

```json
[
  {
    "title": "Short imperative deliverable name",
    "description": "1-2 sentence summary of the deliverable",
    "assignee": "<agent-id from the org roster, or null if unassigned>",
    "priority": "low | medium | high | urgent",
    "blockedBy": ["<exact title of a blocking issue in this same array>"]
  }
]
```

Titles must be unique within the array — `blockedBy` is resolved by exact title match.
Use `[]` for `blockedBy` when an issue has no blockers.

**Quality checklist before creating:**
- [ ] Enough detail that assignees can act without re-asking
- [ ] Every concrete deliverable is an issue
- [ ] Each issue has a deliberate, specialty-matched assignee
- [ ] Each issue's real blockers are declared
- [ ] Independent branches can start in parallel
- [ ] Gaps (missing skills, decisions, external inputs) are surfaced, not hidden

---

## Step 4 — Create Issues (unless dry_run=true)

Reads the decomposition written in Step 3, assigns collision-free ids, validates assignees
against the org roster, resolves `blockedBy` titles into `blockedByIssueIds`, and appends
to the issues file atomically. Fails loudly on any unresolved or ambiguous reference —
an unresolved blocker silently dropped is exactly what produces a `blocked` issue with an
empty `blockedByIssueIds`, which `mastermind-liveness` reports as stalled.

```bash
issuesFile=".monomind/orgs/${org_name}-issues.json"
decompFile=".monomind/orgs/${org_name}-plan-decomposition.json"
[ ! -f "$issuesFile" ] && echo '{"issues":[]}' > "$issuesFile"
[ ! -f "$decompFile" ] && { echo "ERROR: $decompFile not found — Step 3 must write it first."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$issuesFile" "$decompFile" "$orgFile" "${project_id:-}" "${workspace_id:-}" "${dry_run:-false}" "$ts" <<'PYEOF'
import json, os, sys, time

issues_path, decomp_path, org_path, project_id, workspace_id, dry_run, ts = sys.argv[1:]
dry = dry_run == "true"

VALID_PRIORITY = {"low", "medium", "high", "urgent"}

decomp = json.load(open(decomp_path))
if not isinstance(decomp, list) or not decomp:
    print("ERROR: decomposition must be a non-empty JSON array.")
    sys.exit(1)

roster = {r.get("id") for r in json.load(open(org_path)).get("roles", [])}
data   = json.load(open(issues_path))
issues = data.setdefault("issues", [])

# --- Validate before mutating anything ---
errors, titles = [], {}
for n, item in enumerate(decomp, 1):
    title = (item.get("title") or "").strip()
    if not title:
        errors.append(f"item {n}: missing title")
        continue
    if title in titles:
        errors.append(f"item {n}: duplicate title {title!r} — titles must be unique to resolve blockedBy")
    titles[title] = None
    pri = item.get("priority") or "medium"
    if pri not in VALID_PRIORITY:
        errors.append(f"{title!r}: priority {pri!r} must be one of {sorted(VALID_PRIORITY)}")
    asgn = item.get("assignee")
    if asgn and asgn not in roster:
        errors.append(f"{title!r}: assignee {asgn!r} is not a role in this org (roster: {sorted(roster)})")

existing_by_title = {i.get("title"): i.get("id") for i in issues}
for item in decomp:
    for b in item.get("blockedBy") or []:
        if b not in titles and b not in existing_by_title:
            errors.append(f"{item.get('title')!r}: blockedBy {b!r} matches no issue in this batch or in the existing file")

if errors:
    print("ERROR: decomposition did not validate — no issues were created.")
    for e in errors:
        print(f"  · {e}")
    sys.exit(1)

# --- Assign ids (batch-stable, collision-free) ---
batch = int(time.time() * 1000)
for n, item in enumerate(decomp, 1):
    titles[item["title"].strip()] = f"issue-{batch}-{n:03d}"

def resolve(t):
    return titles.get(t) or existing_by_title[t]

created = []
for item in decomp:
    title = item["title"].strip()
    created.append({
        "id": titles[title],
        "title": title,
        "description": item.get("description") or "",
        "status": "todo",
        "priority": item.get("priority") or "medium",
        "assigneeId": item.get("assignee") or None,
        "assigneeAgentId": item.get("assignee") or None,
        "assigneeUserId": None,
        "parentId": None,
        "projectId": project_id or None,
        "workspaceId": workspace_id or None,
        "blockedByIssueIds": [resolve(b) for b in (item.get("blockedBy") or [])],
        "createdAt": ts,
        "updatedAt": ts,
    })

if dry:
    print("DRY RUN — no issues were created. Would create:")
    for c in created:
        blockers = ", ".join(c["blockedByIssueIds"]) or "none"
        print(f"  {c['id']}  [{c['priority']:<6}] {c['title']}")
        print(f"      assignee: {c['assigneeId'] or 'UNASSIGNED'}   blockedBy: {blockers}")
    print(f"\n  {len(created)} issue(s) would be created.")
    sys.exit(0)

issues.extend(created)
tmp = issues_path + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, issues_path)

print("CREATED ISSUES:")
for c in created:
    blockers = ", ".join(c["blockedByIssueIds"]) or "none"
    print(f"  {c['id']}  [{c['priority']:<6}] {c['title']}")
    print(f"      assignee: {c['assigneeId'] or 'UNASSIGNED'}   blockedBy: {blockers}")
print(f"\n  {len(created)} issue(s) created in {issues_path}")

roots = [c for c in created if not c["blockedByIssueIds"]]
print(f"  {len(roots)} issue(s) are unblocked and can start in parallel.")
PYEOF

rm -f "$decompFile"
```

> **These issues are not auto-consumed by the org runtime.** `OrgDaemon` builds its `TaskDag`
> fresh in memory on every start and never reads `<org>-issues.json` (verified: zero references
> in `packages/@monomind/cli/src/orgrt/`). Issues created here are tracked by the
> `mastermind-issues` / `mastermind-my-issues` / `mastermind-liveness` skills and shown in the
> dashboard, but running `monomind org run <org>` will not pick them up. Drive execution from
> this file with `mastermind-execute`, or pass work explicitly via `org run --task`.

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

If `caller` is not "command", follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `ops`.
