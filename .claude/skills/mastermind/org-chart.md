---
name: mastermind-org-chart
description: Mastermind org-chart — generates a text-based ASCII org chart for an org showing the agent hierarchy, adapter types, heartbeat status, and reports-to relationships. Supports tree view, flat list, and JSON export. Mirrors OrgChart.tsx canvas view as a CLI-friendly format.
type: domain-skill
default_mode: auto
---

# Mastermind Org Chart

This skill is invoked by `mastermind:org-chart` or directly via `/mastermind:org-chart`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to chart (required)
- `action`: show | flat | export | search
- `query`: search term to filter agents in the chart (for search)
- `output_file`: file path for JSON export (for export; default: stdout)
- `depth`: max depth to render (default: unlimited)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Org Roles

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

roles=$(jq -r '.roles // []' "$orgFile")
roleCount=$(echo "$roles" | jq 'length')

# Load heartbeat state if available
stateFile=".monomind/orgs/${org_name}-state.json"
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "ORG CHART — $org_name"
echo "════════════════════════════════════════════════════════"

[ "$roleCount" -eq 0 ] && {
  echo "  No agents in org '$org_name'."
  echo "  Add one: /mastermind:new-agent --org $org_name --title 'My Agent'"
  exit 0
}

# Build parent→children map using Python for recursive ASCII tree
python3 - "$orgFile" "$stateFile" "${depth:-99}" <<'PYEOF'
import json, sys, os

orgFile = sys.argv[1]
stateFile = sys.argv[2] if len(sys.argv) > 2 else None
maxDepth = int(sys.argv[3]) if len(sys.argv) > 3 else 99

with open(orgFile) as f:
    org = json.load(f)

roles = org.get("roles", [])

# Load heartbeat state
hb = {}
if stateFile and os.path.exists(stateFile):
    try:
        with open(stateFile) as f:
            state = json.load(f)
        for r in state.get("roles", []):
            hb[r.get("id", "")] = r.get("last_heartbeat")
    except Exception:
        pass

# Build child map
children = {}
for r in roles:
    pid = r.get("reports_to") or "__root__"
    children.setdefault(pid, []).append(r)

def render(nodes, prefix="", depth=0):
    if depth > maxDepth:
        return
    for i, r in enumerate(nodes):
        is_last = (i == len(nodes) - 1)
        connector = "└── " if is_last else "├── "
        child_prefix = prefix + ("    " if is_last else "│   ")
        rid = r.get("id", "?")
        title = r.get("title", rid)
        adapter = r.get("adapter", {})
        atype = adapter.get("type", "?") if isinstance(adapter, dict) else str(adapter)
        model = adapter.get("model", "") if isinstance(adapter, dict) else ""
        hb_status = "♡" if rid not in hb or not hb[rid] else "♥"
        gov = r.get("governance") or ""
        gov_str = f" [{gov}]" if gov else ""
        model_str = f"/{model}" if model else ""
        print(f"{prefix}{connector}{title}  ({atype}{model_str}){gov_str}  {hb_status}")
        kids = children.get(rid, [])
        if kids:
            render(kids, child_prefix, depth + 1)

roots = children.get("__root__", [])
# Include agents whose reports_to points to a non-existent id
all_ids = {r.get("id") for r in roles}
for r in roles:
    pid = r.get("reports_to")
    if pid and pid not in all_ids and r not in roots:
        roots.append(r)

render(roots)
PYEOF

echo ""
echo "  $roleCount agent(s)  ·  ♥ heartbeat active  ♡ no heartbeat"
echo "  Add agent:    /mastermind:new-agent --org $org_name --title 'Role Name'"
echo "  Agent detail: /mastermind:agent-detail --org $org_name --agent-id <id>"
```

### flat

```bash
echo "AGENTS — $org_name (flat list)"
echo "────────────────────────────────────────────────────────"
printf "%-24s %-20s %-16s %-20s %s\n" "ID" "TITLE" "ADAPTER" "MODEL" "REPORTS TO"
echo "────────────────────────────────────────────────────────"

echo "$roles" | jq -r '.[] |
  [.id, (.title // "-"), (.adapter.type // "?"), (.adapter.model // "-"),
   (.reports_to // "(root)")] | @tsv' | \
while IFS=$'\t' read -r id title adapter model rt; do
  printf "%-24s %-20s %-16s %-20s %s\n" "$id" "$title" "$adapter" "$model" "$rt"
done

echo ""
echo "Total: $roleCount"
```

### search

```bash
[ -z "$query" ] && { echo "ERROR: --query required."; exit 1; }

echo "AGENT SEARCH — $org_name  query: '$query'"
echo "────────────────────────────────────────────────────────"
printf "%-24s %-20s %-16s %s\n" "ID" "TITLE" "ADAPTER" "REPORTS TO"
echo "────────────────────────────────────────────────────────"

ql=$(echo "$query" | tr '[:upper:]' '[:lower:]')
echo "$roles" | jq -r --arg q "$ql" '.[] |
  select(
    (.id | ascii_downcase | contains($q)) or
    (.title // "" | ascii_downcase | contains($q)) or
    (.adapter.type // "" | ascii_downcase | contains($q)) or
    (.adapter.model // "" | ascii_downcase | contains($q))
  ) |
  [.id, (.title // "-"), (.adapter.type // "?"), (.reports_to // "(root)")] | @tsv' | \
while IFS=$'\t' read -r id title adapter rt; do
  printf "%-24s %-20s %-16s %s\n" "$id" "$title" "$adapter" "$rt"
done
```

### export

```bash
outFile="${output_file:-}"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

payload=$(jq --arg org "$org_name" --arg ts "$ts" \
  '{org: $org, exportedAt: $ts, roles: (.roles // [])}' \
  "$orgFile")

if [ -n "$outFile" ]; then
  mkdir -p "$(dirname "$outFile")"
  echo "$payload" > "$outFile"
  echo "Org chart exported: $outFile  ($roleCount agents)"
else
  echo "$payload" | jq .
fi
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
agent_count: <N>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
