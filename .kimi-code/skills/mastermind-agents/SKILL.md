---
name: mastermind-agents
description: Mastermind agents — list, inspect, hire, and remove agents in an org, and pause or resume the org. Shows each role, its adapter config, and the org's live runtime status.
type: domain-skill
default_mode: confirm
pick: low
---

# Mastermind Agents

This skill is invoked by `mastermind:agents` or directly via `/mastermind-agents`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to inspect (optional — lists all orgs if omitted)
- `action`: list | hire | pause | resume | remove | inspect
- `agent_id`: role id or agent slug (required for inspect/pause/resume/remove)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following mastermind-protocol/SKILL.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Resolve Org

If `org_name` is provided, load `.monomind/orgs/<org_name>.json`. Otherwise list all orgs:

```bash
ls .monomind/orgs/*.json 2>/dev/null | grep -vE -- '-approvals|-state|-activity|-goals|-routines|-projects|-members|-issues|-workspaces|-worktrees|-environments|-plugins|-adapters|-bootstrap|-threads|-budgets|-project-workspaces|-approval-comments' | xargs -I{} basename {} .json
```

If no orgs exist, print: "No orgs found. Run /mastermind:createorg to define one."

---

## Step 2 — Execute Action

### list (default)

Display all agents in the org, then the org's live runtime status:

```bash
orgFile=".monomind/orgs/${org_name}.json"

jq -r '(.roles // [])[] | "• [\(.id)] \(.title)  type=\(.type // "specialist")  reports_to=\(.reports_to // "none")"' "$orgFile"

# Live runtime status (running/stopped/crashed, current run) — per-role
# activity for a run is in `monomind org report <org>`.
echo ""
echo "RUNTIME STATUS:"
npx -y monomind@latest org status "$org_name" 2>/dev/null || echo "  (not available — is monomind installed?)"
```

Render as table:

```
AGENTS — org: <org_name>
──────────────────────────────────────────────────────
ID              TITLE              TYPE                REPORTS TO
boss            CEO / Boss         boss                none
content-writer  Content Writer     specialist          boss
reviewer        Content Reviewer   reviewer            boss
...
```

### inspect

Show the full role config (responsibilities, adapter config) and who it reports to / who reports to it:

```bash
jq --arg id "$agent_id" '(.roles // [])[] | select(.id == $id)' "$orgFile"
jq -r --arg id "$agent_id" '(.roles // [])[] | select(.reports_to == $id) | "  direct report: \(.id)"' "$orgFile"
```

### hire

Add a new role to the org. Prompt the user for:
- `id` (slug, e.g. `seo-lead`), `title` (display name), `role_type` → the role's `type` (`specialist`, or a domain synonym such as `reviewer` / `researcher` — free text; only `boss` is special, and an org has exactly one root), `responsibilities` (comma-separated), `reports_to` (an existing role id — a hired role is never the root)

Write the Org Runtime role shape (`RoleSchema` in `packages/@monomind/cli/src/orgrt/types.ts`): `type`, never the legacy `agent_type` key — a role carrying `agent_type` makes the whole config read as the retired v1 format.

**Adapter/model selection** — present this picker:

```
ADAPTER / MODEL
───────────────
Available Claude models:
  1. claude-sonnet-5            → balanced capability + speed (Recommended)
  2. claude-opus-5              → high capability, slower
  3. claude-fable-5-1           → most capable, highest cost
  4. claude-haiku-4-5-20251001  → fastest, lowest cost

Enter choice [1]:
```

Set `adapter_config.model` from selection. Default: `claude-sonnet-5` (the org runtime default, `DEFAULT_CLAUDE_MODEL`).

Append to `.monomind/orgs/<org_name>.json` roles array using jq:

```bash
# model from adapter picker (default: claude-sonnet-5)
adapter_model="${selected_model:-claude-sonnet-5}"

tmp="${orgFile}.tmp"
jq --arg id "$agent_id" \
   --arg title "$title" \
   --arg type "${role_type:-specialist}" \
   --arg reports_to "$reports_to" \
   --arg model "$adapter_model" \
   --argjson resp "$(echo "$responsibilities" | jq -R 'split(",") | map(ltrimstr(" "))')" \
   '.roles += [{"id":$id,"title":$title,"type":$type,
     "responsibilities":$resp,
     "reports_to":$reports_to,
     "adapter_config":{"model":$model,"max_tokens":8192}}]' \
   "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
echo "Hired: $title (${role_type:-specialist}) → adapter: $adapter_model"
npx -y monomind@latest org validate "$org_name"
```

### pause / resume

The Org Runtime pauses and resumes a whole org, not a single role — message
delivery is suspended while it is paused:

```bash
npx -y monomind@latest org pause "$org_name"    # or: org resume "$org_name"
```

To take one role out of the org, use `remove`.

### remove

Confirm with user, then remove role from org config:

```bash
tmp="${orgFile}.tmp"
jq --arg id "$agent_id" '.roles = [(.roles // [])[] | select(.id != $id)]' \
  "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
agents_count: <N>
```

Print summary and any suggested next actions (e.g. "Check live status with `monomind org status <org_name>`").

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `ops`.
