---
name: mastermind-goal-detail
description: Mastermind goal-detail — deep per-goal inspection and management. Show sub-goal tree, linked projects, edit title/status/description/priority, add child goals, and close or reopen a single goal within an org.
type: domain-skill
default_mode: auto
---

# Mastermind Goal Detail

This skill is invoked by `mastermind:goal-detail` or directly via `/mastermind:goal-detail`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org the goal belongs to (required)
- `goal_id`: goal id/slug (required)
- `action`: show | tree | projects | edit | add-child | close | reopen
- `field`: field to edit (title | description | status | priority | parent_id)
- `value`: new field value (required for edit)
- `child_title`: title for the new child goal (required for add-child)
- `child_description`: description for the new child goal (optional)
- `caller`: command | master

---

## Goal Status Flow

```
open → in_progress → done
  └──────────────────┘  (can reopen)
```

## Priority Levels

`critical` | `high` | `medium` | `low`

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Goal Data

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

goalsFile=".monomind/orgs/${org_name}-goals.json"
[ ! -f "$goalsFile" ] && { echo "ERROR: No goals file for org '$org_name'. Create goals via /mastermind:goals."; exit 1; }

goalDef=$(jq -r --arg id "$goal_id" '(.goals // [])[] | select(.id == $id or .slug == $id)' "$goalsFile")
[ -z "$goalDef" ] && { echo "ERROR: Goal '$goal_id' not found in org '$org_name'."; exit 1; }

resolvedId=$(echo "$goalDef" | jq -r '.id')
projectsFile=".monomind/orgs/${org_name}-projects.json"
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "GOAL DETAIL — $goal_id @ $org_name"
echo "────────────────────────────────────────────────────────"

echo "$goalDef" | jq -r '
  "  ID:           \(.id)",
  "  Title:        \(.title // "(no title)")",
  "  Status:       \(.status // "open")",
  "  Priority:     \(.priority // "medium")",
  "  Parent:       \(.parent_id // "(root goal)")",
  "  Created:      \(.created_at // "-")",
  "  Updated:      \(.updated_at // "-")"
'

# Sub-goals count
subCount=$(jq --arg pid "$resolvedId" '[(.goals // [])[] | select(.parent_id == $pid)] | length' "$goalsFile" 2>/dev/null || echo 0)
doneCount=$(jq --arg pid "$resolvedId" '[(.goals // [])[] | select(.parent_id == $pid and .status == "done")] | length' "$goalsFile" 2>/dev/null || echo 0)
echo "  Sub-goals:    $subCount total, $doneCount done"

# Linked projects
projCount=$(echo "$goalDef" | jq -r '(.linked_projects // []) | length')
echo "  Projects:     $projCount linked"

# Description
desc=$(echo "$goalDef" | jq -r '.description // ""')
if [ -n "$desc" ]; then
  echo ""
  echo "DESCRIPTION"
  echo "────────────────────────────────────────────────────────"
  echo "$desc"
fi
```

### tree

```bash
echo "SUB-GOAL TREE — $goal_id"
echo "────────────────────────────────────────────────────────"

function print_tree() {
  local pid="$1"
  local indent="$2"
  local children
  children=$(jq -r --arg pid "$pid" '(.goals // [])[] | select(.parent_id == $pid) |
    [.id, (.status // "open"), (.title // "(no title)")] | @tsv' "$goalsFile" 2>/dev/null)
  while IFS=$'\t' read -r cid cst ctitle; do
    [ -z "$cid" ] && continue
    echo "${indent}[${cst}] ${ctitle} (${cid})"
    print_tree "$cid" "  ${indent}"
  done <<< "$children"
}

# Print root goal
rootTitle=$(echo "$goalDef" | jq -r '.title // "(no title)"')
rootStatus=$(echo "$goalDef" | jq -r '.status // "open"')
echo "[${rootStatus}] ${rootTitle} (${resolvedId})"
print_tree "$resolvedId" "  "
```

### projects

```bash
echo "LINKED PROJECTS — $goal_id"
echo "────────────────────────────────────────────────────────"

linkedIds=$(echo "$goalDef" | jq -r '(.linked_projects // [])[]')
if [ -z "$linkedIds" ]; then
  echo "  No linked projects."
else
  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    if [ -f "$projectsFile" ]; then
      projInfo=$(jq -r --arg id "$pid" '(.projects // [])[] | select(.id == $id) |
        "  [\(.status // "active")] \(.name // $id) — \(.description // "")"' "$projectsFile" 2>/dev/null)
      [ -n "$projInfo" ] && echo "$projInfo" || echo "  [$pid] (project not found in projects file)"
    else
      echo "  $pid"
    fi
  done <<< "$linkedIds"
fi

echo ""
echo "Issues referencing this goal:"
issuesFile=".monomind/orgs/${org_name}-issues.json"
if [ -f "$issuesFile" ]; then
  count=$(jq --arg gid "$resolvedId" '[(.issues // [])[] | select(.goal_id == $gid)] | length' "$issuesFile" 2>/dev/null || echo 0)
  echo "  $count issue(s) linked to this goal."
fi
```

### edit

```bash
[ -z "$field" ] && { echo "ERROR: --field required (title|description|status|priority|parent_id)."; exit 1; }
[ -z "$value" ] && { echo "ERROR: --value required."; exit 1; }

validFields="title description status priority parent_id"
echo "$validFields" | tr ' ' '\n' | grep -qx "$field" || {
  echo "ERROR: Unknown field '$field'. Valid: $validFields"; exit 1
}

if [ "$field" = "status" ]; then
  case "$value" in open|in_progress|done|cancelled) : ;; *)
    echo "ERROR: status must be one of: open, in_progress, done, cancelled"; exit 1 ;;
  esac
fi
if [ "$field" = "priority" ]; then
  case "$value" in critical|high|medium|low) : ;; *)
    echo "ERROR: priority must be one of: critical, high, medium, low"; exit 1 ;;
  esac
fi

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${goalsFile}.tmp"
jq --arg id "$resolvedId" --arg field "$field" --arg val "$value" --arg ts "$ts" \
  '.goals = [(.goals // [])[] | if .id == $id then .[$field] = $val | .updated_at = $ts else . end]' \
  "$goalsFile" > "$tmp" && mv "$tmp" "$goalsFile"

echo "Goal '$goal_id' updated: $field = $value"
```

### add-child

```bash
[ -z "$child_title" ] && { echo "ERROR: --child-title required."; exit 1; }

childId="goal-$(openssl rand -hex 4 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(4))')"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

tmp="${goalsFile}.tmp"
jq --arg id "$childId" \
   --arg title "$child_title" \
   --arg desc "${child_description:-}" \
   --arg pid "$resolvedId" \
   --arg ts "$ts" \
  '.goals += [{"id":$id,"title":$title,
    "description":(if $desc != "" then $desc else null end),
    "parent_id":$pid,"status":"open","priority":"medium",
    "linked_projects":[],"created_at":$ts,"updated_at":$ts}]' \
  "$goalsFile" > "$tmp" && mv "$tmp" "$goalsFile"

echo "Sub-goal created: $childId"
echo "  Title:  $child_title"
echo "  Parent: $goal_id"
```

### close

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${goalsFile}.tmp"
jq --arg id "$resolvedId" --arg ts "$ts" \
  '.goals = [(.goals // [])[] | if .id == $id then .status = "done" | .updated_at = $ts | .closed_at = $ts else . end]' \
  "$goalsFile" > "$tmp" && mv "$tmp" "$goalsFile"
echo "Goal '$goal_id' → done."
```

### reopen

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${goalsFile}.tmp"
jq --arg id "$resolvedId" --arg ts "$ts" \
  '.goals = [(.goals // [])[] | if .id == $id then .status = "open" | .updated_at = $ts | .closed_at = null else . end]' \
  "$goalsFile" > "$tmp" && mv "$tmp" "$goalsFile"
echo "Goal '$goal_id' → reopened."
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
goal_id: <goal_id>
goal_status: <status>
sub_goals: <N>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
