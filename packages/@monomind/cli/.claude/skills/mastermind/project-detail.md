---
name: mastermind-project-detail
description: Mastermind project-detail — deep per-project inspection and management. Tabs mirror Paperclip's ProjectDetail page: overview (metrics/issues), configuration (color/visibility/description), budget policy, workspaces, and linked issues list.
type: domain-skill
default_mode: auto
---

# Mastermind Project Detail

This skill is invoked by `mastermind:project-detail` or directly via `/mastermind:project-detail`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org the project belongs to (required)
- `project_id`: project id/slug (required)
- `action`: show | overview | issues | config | budget | workspaces
- `field`: config field to edit (name|description|color|visibility)
- `value`: new field value (for config --field)
- `budget_policy`: none | soft_limit | hard_limit (for budget action)
- `budget_limit`: token limit (integer, required if policy != none)
- `budget_period`: daily | weekly | monthly (default: daily)
- `caller`: command | master

---

## Project Colors

`red` | `orange` | `yellow` | `green` | `teal` | `blue` | `purple` | `pink` | `gray`

## Visibility

`private` — visible only to org members with access
`internal` — visible to all org members
`public` — visible to anyone with the link

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Project Data

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

projectsFile=".monomind/orgs/${org_name}-projects.json"
[ ! -f "$projectsFile" ] && { echo "ERROR: No projects file for org '$org_name'. Create via /mastermind:projects."; exit 1; }

projectDef=$(jq -r --arg id "$project_id" '(.projects // [])[] | select(.id == $id or .slug == $id)' "$projectsFile")
[ -z "$projectDef" ] && { echo "ERROR: Project '$project_id' not found in org '$org_name'."; exit 1; }

resolvedId=$(echo "$projectDef" | jq -r '.id')
issuesFile=".monomind/orgs/${org_name}-issues.json"
wsFile=".monomind/orgs/${org_name}-workspaces.json"
budgetFile=".monomind/orgs/${org_name}-budgets.json"
```

---

## Step 2 — Execute Action

### show (default) — same as overview

```bash
echo "PROJECT — $project_id @ $org_name"
echo "────────────────────────────────────────────────────────"

echo "$projectDef" | jq -r '
  "  ID:           \(.id)",
  "  Name:         \(.name // "(unnamed)")",
  "  Status:       \(.status // "active")",
  "  Color:        \(.color // "gray")",
  "  Visibility:   \(.visibility // "internal")",
  "  Description:  \(.description // "(none)")",
  "  Created:      \(.created_at // "-")"
'

# Issues summary
if [ -f "$issuesFile" ]; then
  totalIssues=$(jq --arg pid "$resolvedId" '[(.issues // [])[] | select(.project_id == $pid)] | length' "$issuesFile")
  openIssues=$(jq --arg pid "$resolvedId" '[(.issues // [])[] | select(.project_id == $pid and .status == "open")] | length' "$issuesFile")
  inProgIssues=$(jq --arg pid "$resolvedId" '[(.issues // [])[] | select(.project_id == $pid and .status == "in_progress")] | length' "$issuesFile")
  doneIssues=$(jq --arg pid "$resolvedId" '[(.issues // [])[] | select(.project_id == $pid and .status == "done")] | length' "$issuesFile")
  echo ""
  echo "ISSUES"
  echo "  Total:       $totalIssues"
  echo "  Open:        $openIssues"
  echo "  In progress: $inProgIssues"
  echo "  Done:        $doneIssues"
fi

# Workspaces summary
if [ -f "$wsFile" ]; then
  wsCount=$(jq --arg pid "$resolvedId" '[(.workspaces // [])[] | select(.project_id == $pid)] | length' "$wsFile")
  activeWs=$(jq --arg pid "$resolvedId" '[(.workspaces // [])[] | select(.project_id == $pid and .status == "active")] | length' "$wsFile")
  echo ""
  echo "WORKSPACES"
  echo "  Total:  $wsCount  |  Active: $activeWs"
fi
```

### overview

Alias for `show` — print the overview section above.

### issues

```bash
echo "ISSUES — project: $project_id"
echo "────────────────────────────────────────────────────────"
printf "%-24s %-12s %-10s %s\n" "ID" "STATUS" "PRIORITY" "TITLE"
echo "────────────────────────────────────────────────────────"

if [ ! -f "$issuesFile" ]; then
  echo "  No issues file found."
else
  count=0
  jq -r --arg pid "$resolvedId" '(.issues // [])[] | select(.project_id == $pid) |
    [.id, (.status // "open"), (.priority // "medium"), (.title // "(no title)")] | @tsv' \
    "$issuesFile" | while IFS=$'\t' read -r id st pri title; do
    printf "%-24s %-12s %-10s %s\n" "$id" "$st" "$pri" "$title"
    count=$((count + 1))
  done
fi
```

### config

```bash
echo "PROJECT CONFIG — $project_id"
echo "────────────────────────────────────────────────────────"

if [ -n "$field" ]; then
  [ -z "$value" ] && { echo "ERROR: --value required when --field is set."; exit 1; }
  validFields="name description color visibility status"
  echo "$validFields" | tr ' ' '\n' | grep -qx "$field" || {
    echo "ERROR: Unknown field '$field'. Valid: $validFields"; exit 1
  }
  if [ "$field" = "color" ]; then
    case "$value" in red|orange|yellow|green|teal|blue|purple|pink|gray) : ;; *)
      echo "ERROR: color must be one of: red orange yellow green teal blue purple pink gray"; exit 1 ;;
    esac
  fi
  if [ "$field" = "visibility" ]; then
    case "$value" in private|internal|public) : ;; *)
      echo "ERROR: visibility must be one of: private, internal, public"; exit 1 ;;
    esac
  fi
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  tmp="${projectsFile}.tmp"
  jq --arg id "$resolvedId" --arg f "$field" --arg v "$value" --arg ts "$ts" \
    '.projects = [(.projects // [])[] | if .id == $id then .[$f] = $v | .updated_at = $ts else . end]' \
    "$projectsFile" > "$tmp" && mv "$tmp" "$projectsFile"
  echo "Updated: $field = $value"
else
  echo "$projectDef" | jq '{name, description, color, visibility, status}'
fi
```

### budget

```bash
echo "BUDGET POLICY — $project_id"
echo "────────────────────────────────────────────────────────"

[ ! -f "$budgetFile" ] && echo '{"budgets":[]}' > "$budgetFile"

existing=$(jq -r --arg pid "$resolvedId" '(.budgets // [])[] | select(.project_id == $pid)' "$budgetFile")
if [ -z "$existing" ]; then
  echo "  No budget policy set."
else
  echo "$existing" | jq -r '
    "  Policy:  \(.policy // "none")",
    "  Limit:   \(.limit_tokens // "unlimited") tokens",
    "  Period:  \(.period // "daily")"
  '
fi

if [ -n "$budget_policy" ]; then
  case "$budget_policy" in none|soft_limit|hard_limit) : ;; *)
    echo "ERROR: --budget-policy must be none, soft_limit, or hard_limit"; exit 1 ;;
  esac
  [ "$budget_policy" != "none" ] && [ -z "$budget_limit" ] && {
    echo "ERROR: --budget-limit required for '$budget_policy' policy."; exit 1
  }
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  tmp="${budgetFile}.tmp"
  jq --arg pid "$resolvedId" \
     --arg policy "$budget_policy" \
     --argjson limit "${budget_limit:-0}" \
     --arg period "${budget_period:-daily}" \
     --arg ts "$ts" \
    '.budgets = [(.budgets // [])[] | select(.project_id != $pid)] +
     [{"project_id":$pid,"policy":$policy,
       "limit_tokens":(if $policy != "none" then $limit else null end),
       "period":$period,"updatedAt":$ts}]' \
    "$budgetFile" > "$tmp" && mv "$tmp" "$budgetFile"
  echo ""
  echo "Budget policy updated: $budget_policy"
  [ "$budget_policy" != "none" ] && echo "  Limit: $budget_limit tokens / ${budget_period:-daily}"
fi
```

### workspaces

```bash
echo "WORKSPACES — project: $project_id"
echo "────────────────────────────────────────────────────────"

if [ ! -f "$wsFile" ]; then
  echo "  No workspaces file."
else
  printf "%-20s %-12s %-18s %-8s %s\n" "ID" "STATUS" "AGENT" "BRANCH" "PATH"
  echo "────────────────────────────────────────────────────────"
  count=0
  jq -r --arg pid "$resolvedId" '(.workspaces // [])[] | select(.project_id == $pid) |
    [.id, (.status // "unknown"), (.agent_id // "(none)"), (.branch // "?"), (.worktree_path // "-")] | @tsv' \
    "$wsFile" | while IFS=$'\t' read -r id st ag br path; do
    printf "%-20s %-12s %-18s %-8s %s\n" "$id" "$st" "$ag" "$br" "$path"
    count=$((count + 1))
  done
fi
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
project_id: <project_id>
project_status: <status>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
