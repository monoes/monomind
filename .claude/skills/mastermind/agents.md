---
name: mastermind-agents
description: Mastermind agents — list, inspect, hire, pause, and remove agents in a running org. Shows status, last heartbeat, adapter config, and burn rate per agent.
type: domain-skill
default_mode: confirm
---

# Mastermind Agents

This skill is invoked by `mastermind:agents` or directly via `/mastermind:agents`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to inspect (optional — lists all orgs if omitted)
- `action`: list | hire | pause | resume | remove | inspect
- `agent_id`: role id or agent slug (required for inspect/pause/resume/remove)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Resolve Org

If `org_name` is provided, load `.monomind/orgs/<org_name>.json`. Otherwise list all orgs:

```bash
ls .monomind/orgs/*.json 2>/dev/null | xargs -I{} basename {} .json
```

If no orgs exist, print: "No orgs found. Run /mastermind:createorg to define one."

---

## Step 2 — Execute Action

### list (default)

Display all agents in the org with status from state file:

```bash
orgFile=".monomind/orgs/${org_name}.json"
stateFile=".monomind/orgs/${org_name}-state.json"

jq -r '.roles[] | "• [\(.id)] \(.title)  agent=\(.agent_type)  reports_to=\(.reports_to // "none")"' "$orgFile"

# Overlay runtime status from state file if present
if [ -f "$stateFile" ]; then
  echo ""
  echo "RUNTIME STATUS:"
  jq -r '.agents // {} | to_entries[] | "  \(.key): \(.value.status // "unknown")  last_beat=\(.value.last_heartbeat // "never")"' "$stateFile" 2>/dev/null || true
fi
```

Render as table:

```
AGENTS — org: <org_name>
──────────────────────────────────────────────────────
ID              TITLE              AGENT TYPE          STATUS        LAST HEARTBEAT
boss            CEO / Boss         coordinator         running       2 min ago
content-writer  Content Writer     Content Creator     idle          8 min ago
reviewer        Content Reviewer   reviewer            waiting       8 min ago
...
```

### inspect

Show full config + responsibilities + communication edges for a single agent:

```bash
jq --arg id "$agent_id" '.roles[] | select(.id == $id)' "$orgFile"
jq --arg id "$agent_id" '.communication[] | select(.from == $id or .to == $id)' "$orgFile"
```

### hire

Add a new role to the org. Prompt the user for:
- `id` (slug, e.g. `seo-lead`), `title` (display name), `agent_type` (from mapping table in createorg.md), `responsibilities` (comma-separated), `reports_to` (role id or null)

**Adapter/model selection** — present this picker:

```
ADAPTER / MODEL
───────────────
Available Claude models:
  1. claude-sonnet-4-6    → balanced capability + speed (Recommended)
  2. claude-opus-4-7      → highest capability, slower
  3. claude-haiku-4-5     → fastest, lowest cost

Enter choice [1]:
```

Set `adapter_config.model` from selection. Default: `claude-sonnet-4-6`.

Append to `.monomind/orgs/<org_name>.json` roles array using jq:

```bash
# model from adapter picker (default: claude-sonnet-4-6)
adapter_model="${selected_model:-claude-sonnet-4-6}"

tmp="${orgFile}.tmp"
jq --arg id "$agent_id" \
   --arg title "$title" \
   --arg agent_type "$agent_type" \
   --arg reports_to "${reports_to:-}" \
   --arg model "$adapter_model" \
   --argjson resp "$(echo "$responsibilities" | jq -R 'split(",") | map(ltrimstr(" "))')" \
   '.roles += [{"id":$id,"title":$title,"agent_type":$agent_type,
     "responsibilities":$resp,
     "reports_to":($reports_to|if .=="" then null else . end),
     "adapter_config":{"model":$model,"max_tokens":8192}}]' \
   "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
echo "Hired: $title ($agent_type) → adapter: $adapter_model"
```

Then emit `org:agent:hired` event to dashboard:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg org "$org_name" --arg role "$agent_id" --arg title "$title" \
    '{type:"org:agent:hired",org:$org,role:$role,title:$title,ts:(now*1000|floor)}')" || true
```

### pause / resume

Update state file:

```bash
stateFile=".monomind/orgs/${org_name}-state.json"
[ ! -f "$stateFile" ] && echo '{"agents":{}}' > "$stateFile"
tmp="${stateFile}.tmp"
jq --arg id "$agent_id" --arg status "paused" \
  '.agents[$id].status = $status | .agents[$id].updated_at = (now|todate)' \
  "$stateFile" > "$tmp" && mv "$tmp" "$stateFile"
```

Emit `org:agent:paused` / `org:agent:resumed` event.

### remove

Confirm with user, then remove role from org config:

```bash
tmp="${orgFile}.tmp"
jq --arg id "$agent_id" '.roles = [.roles[] | select(.id != $id)] | .communication = [.communication[] | select(.from != $id and .to != $id)]' \
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

Print summary and any suggested next actions (e.g. "Run /mastermind:heartbeat to trigger a manual heartbeat for this agent").

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
