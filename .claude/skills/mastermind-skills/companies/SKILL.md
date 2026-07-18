---
name: mastermind-companies
description: Mastermind companies — multi-org management. List all orgs with agent/issue stats, switch the active org, rename an org, delete an org (with confirmation), and view per-org summary. Mirrors Companies.tsx.
type: domain-skill
default_mode: confirm
---

# Mastermind Companies

This skill is invoked by `mastermind:companies` or directly via `/mastermind:companies`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `action`: list | select | rename | delete | stats | create
- `org_name`: org name to target (required for select/rename/delete/stats)
- `new_name`: new org name (required for rename)
- `confirm`: yes (required second step for delete)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Locate All Orgs

```bash
orgsDir=".monomind/orgs"
[ ! -d "$orgsDir" ] && { echo "No orgs directory found. Run /mastermind:createorg to create your first org."; exit 0; }

# Collect all org names from .json files (not -members, -issues, etc.)
orgNames=$(ls "$orgsDir"/*.json 2>/dev/null | grep -vE -- '-approvals|-state|-activity|-goals|-routines|-projects|-members|-issues|-workspaces|-worktrees|-environments|-plugins|-adapters|-bootstrap|-threads|-budgets|-project-workspaces|-approval-comments' | xargs -I{} basename {} .json | sort)

# Track active org
activeFile=".monomind/active-org"
activeOrg=$([ -f "$activeFile" ] && cat "$activeFile" || echo "")
```

---

## Step 2 — Execute Action

### list (default)

```bash
echo "ORGS"
echo "────────────────────────────────────────────────────────"
printf "%-22s %-8s %-8s %-8s %s\n" "NAME" "AGENTS" "ISSUES" "MEMBERS" "STATUS"
echo "────────────────────────────────────────────────────────"

[ -z "$orgNames" ] && { echo "  No orgs found. Create one: /mastermind:createorg"; exit 0; }

echo "$orgNames" | while read -r name; do
  orgFile="$orgsDir/${name}.json"
  [ ! -f "$orgFile" ] && continue

  agents=$(jq -r '(.roles // []) | length' "$orgFile" 2>/dev/null || echo 0)
  issues=$([ -f "$orgsDir/${name}-issues.json" ] && jq '[(.issues // [])[] | select(.status == "open" or .status == "in_progress")] | length' "$orgsDir/${name}-issues.json" 2>/dev/null || echo 0)
  members=$([ -f "$orgsDir/${name}-members.json" ] && jq '.members | length' "$orgsDir/${name}-members.json" 2>/dev/null || echo 0)
  status=$([ "$name" = "$activeOrg" ] && echo "● ACTIVE" || echo "")

  printf "%-22s %-8s %-8s %-8s %s\n" "$name" "$agents" "$issues" "$members" "$status"
done

echo ""
total=$(echo "$orgNames" | wc -w | tr -d ' ')
echo "  Total orgs: $total"
[ -n "$activeOrg" ] && echo "  Active org: $activeOrg"
echo ""
echo "  Select:  --action select --org-name <name>"
echo "  Rename:  --action rename --org-name <name> --new-name <new>"
echo "  Delete:  --action delete --org-name <name>"
```

### select

```bash
[ -z "$org_name" ] && { echo "ERROR: --org-name required."; exit 1; }

orgFile="$orgsDir/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '$org_name' not found."; exit 1; }

echo "$org_name" > "$activeFile"
echo "Active org set to: $org_name"
echo "  All mastermind commands will default to this org."
echo "  To use a different org, pass --org-name explicitly."
```

### rename

```bash
[ -z "$org_name" ] && { echo "ERROR: --org-name required."; exit 1; }
[ -z "$new_name" ] && { echo "ERROR: --new-name required."; exit 1; }

# Validate new name
echo "$new_name" | grep -qE '^[a-z0-9][a-z0-9_-]*$' || {
  echo "ERROR: --new-name must be lowercase alphanumeric with hyphens/underscores (e.g. my-org)."
  exit 1
}

orgFile="$orgsDir/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '$org_name' not found."; exit 1; }

[ -f "$orgsDir/${new_name}.json" ] && { echo "ERROR: Org '$new_name' already exists."; exit 1; }

# Rename main config file
mv "$orgFile" "$orgsDir/${new_name}.json"

# Rename all associated files
for suffix in state members issues goals projects routines approvals adapters plugins environments workspaces worktrees activity threads budgets project-workspaces approval-comments bootstrap secrets; do
  f="$orgsDir/${org_name}-${suffix}.json"
  [ -f "$f" ] && mv "$f" "$orgsDir/${new_name}-${suffix}.json"
  f2="$orgsDir/${org_name}-${suffix}.jsonl"
  [ -f "$f2" ] && mv "$f2" "$orgsDir/${new_name}-${suffix}.jsonl"
done

# Update name field inside config
tmp="$orgsDir/${new_name}.json.tmp"
jq --arg n "$new_name" '.name = $n' "$orgsDir/${new_name}.json" > "$tmp" && mv "$tmp" "$orgsDir/${new_name}.json"

# Update active org pointer if needed
[ "$(cat "$activeFile" 2>/dev/null)" = "$org_name" ] && echo "$new_name" > "$activeFile"

echo "Org renamed: $org_name → $new_name"
```

### delete

```bash
[ -z "$org_name" ] && { echo "ERROR: --org-name required."; exit 1; }

orgFile="$orgsDir/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '$org_name' not found."; exit 1; }

if [ "${confirm:-}" != "yes" ]; then
  agentCount=$(jq '(.roles // []) | length' "$orgFile" 2>/dev/null || echo "?")
  echo "DELETE CONFIRMATION REQUIRED"
  echo "────────────────────────────────────────────────────────"
  echo "  Org:    $org_name"
  echo "  Agents: $agentCount"
  echo ""
  echo "  This will permanently delete the org and ALL associated data."
  echo "  To confirm: --action delete --org-name $org_name --confirm yes"
  exit 0
fi

# Delete all org files
rm -f "$orgsDir/${org_name}.json"
for suffix in state members issues goals projects routines approvals adapters plugins environments workspaces worktrees activity threads budgets project-workspaces approval-comments bootstrap secrets; do
  rm -f "$orgsDir/${org_name}-${suffix}.json"
  rm -f "$orgsDir/${org_name}-${suffix}.jsonl"
done

# Clear active org if it was this org
[ "$(cat "$activeFile" 2>/dev/null)" = "$org_name" ] && rm -f "$activeFile"

echo "Org '$org_name' deleted permanently."
echo "  All associated data removed."
```

### stats

```bash
[ -z "$org_name" ] && { echo "ERROR: --org-name required."; exit 1; }

orgFile="$orgsDir/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '$org_name' not found."; exit 1; }

echo "ORG STATS — $org_name"
echo "────────────────────────────────────────────────────────"

# Agent stats
agents=$(jq '(.roles // []) | length' "$orgFile")
gov=$(jq -r '.governance // "(not set)"' "$orgFile")
echo "  Agents:        $agents"
echo "  Governance:    $gov"

# Issues
if [ -f "$orgsDir/${org_name}-issues.json" ]; then
  total=$(jq '.issues | length' "$orgsDir/${org_name}-issues.json")
  open=$(jq '[(.issues // [])[] | select(.status == "open" or .status == "in_progress")] | length' "$orgsDir/${org_name}-issues.json")
  done=$(jq '[(.issues // [])[] | select(.status == "done")] | length' "$orgsDir/${org_name}-issues.json")
  echo "  Issues:        $total total  ($open open, $done done)"
fi

# Goals
[ -f "$orgsDir/${org_name}-goals.json" ] && echo "  Goals:         $(jq '.goals | length' "$orgsDir/${org_name}-goals.json")"

# Projects
[ -f "$orgsDir/${org_name}-projects.json" ] && echo "  Projects:      $(jq '.projects | length' "$orgsDir/${org_name}-projects.json")"

# Members
[ -f "$orgsDir/${org_name}-members.json" ] && echo "  Members:       $(jq '.members | length' "$orgsDir/${org_name}-members.json")"

# Routines
[ -f "$orgsDir/${org_name}-routines.json" ] && echo "  Routines:      $(jq '.routines | length' "$orgsDir/${org_name}-routines.json")"

# Pending approvals
if [ -f "$orgsDir/${org_name}-approvals.json" ]; then
  pending=$(jq '[(.approvals // [])[] | select(.status == "pending")] | length' "$orgsDir/${org_name}-approvals.json")
  echo "  Pending approvals: $pending"
fi
```

### create

```bash
[ -z "$org_name" ] && { echo "ERROR: --org-name required."; exit 1; }

echo "$org_name" | grep -qE '^[a-z0-9][a-z0-9_-]*$' || {
  echo "ERROR: --org-name must be lowercase alphanumeric with hyphens/underscores."
  exit 1
}

orgFile="$orgsDir/${org_name}.json"
[ -f "$orgFile" ] && { echo "ERROR: Org '$org_name' already exists."; exit 1; }

mkdir -p "$orgsDir"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$orgFile" <<EOF
{
  "name": "$org_name",
  "governance": "auto",
  "roles": [],
  "created_at": "$ts"
}
EOF

echo "Org '$org_name' created."
echo "  Add agents: /mastermind:new-agent --org $org_name --title 'My Agent'"
echo "  Run:        /mastermind:runorg --org $org_name"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org_name: <org_name>
active_org: <active_org>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
