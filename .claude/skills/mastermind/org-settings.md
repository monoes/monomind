---
name: mastermind-org-settings
description: Mastermind org-settings — edit org configuration (name, goal, topology, governance, budget), export org as portable JSON, and import an org from a previously exported file.
type: domain-skill
default_mode: confirm
---

# Mastermind Org Settings

This skill is invoked by `mastermind:org-settings` or directly via `/mastermind:org-settings`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to configure (required)
- `action`: show | edit | export | import
- `field`: field to edit (name, goal, topology, governance, budget_tokens, alert_threshold, ceo_adapter)
- `value`: new value for the field
- `export_path`: path to write exported JSON (default: `.monomind/exports/<org_name>-<timestamp>.json`)
- `import_path`: path to JSON file to import from
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Resolve Org

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found. Run /mastermind:createorg first."; exit 1; }
```

---

## Step 2 — Execute Action

### show (default)

Display current org config in a readable format:

```bash
echo "ORG SETTINGS — ${org_name}"
echo "──────────────────────────────────────────"
jq -r '
  "  Name:         \(.name // .org_name // "-")",
  "  Goal:         \(.goal // "-")",
  "  Topology:     \(.topology // "hierarchical")",
  "  Max Agents:   \(.max_agents // 8)",
  "  Governance:   \(.governance.policy // "auto")",
  "  Budget:       \(.run_config.budget_tokens // 0) tokens",
  "  Alert at:     \((.run_config.alert_threshold // 0.8) * 100 | floor)%",
  "  CEO Adapter:  \(.run_config.ceo_adapter // "claude-sonnet-4-6")",
  "  Roles:        \(.roles | length) agents"
' "$orgFile"
echo ""
echo "  Run /mastermind:org-settings --org ${org_name} --action edit --field <field> --value <value>"
echo "  Fields: name | goal | topology | governance | budget_tokens | alert_threshold | ceo_adapter"
```

### edit

Update a single field in the org config:

```bash
field="${field}"
value="${value}"
tmp="${orgFile}.tmp"

case "$field" in
  name)
    jq --arg v "$value" '.name = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
    echo "Updated: name → $value"
    ;;
  goal)
    jq --arg v "$value" '.goal = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
    echo "Updated: goal → $value"
    ;;
  topology)
    case "$value" in hierarchical|mesh|hierarchical-mesh|adaptive|star|ring) : ;; *)
      echo "ERROR: topology must be one of: hierarchical, mesh, hierarchical-mesh, adaptive, star, ring"; exit 1 ;;
    esac
    jq --arg v "$value" '.topology = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
    echo "Updated: topology → $value"
    ;;
  governance)
    case "$value" in auto|board|strict) : ;; *)
      echo "ERROR: governance must be one of: auto, board, strict"; exit 1 ;;
    esac
    jq --arg v "$value" '.governance.policy = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
    echo "Updated: governance → $value"
    ;;
  budget_tokens)
    [[ "$value" =~ ^[0-9]+$ ]] || { echo "ERROR: budget_tokens must be a positive integer"; exit 1; }
    jq --argjson v "$value" '.run_config.budget_tokens = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
    echo "Updated: budget_tokens → $value"
    ;;
  alert_threshold)
    # accept 0.0–1.0 or 0–100
    if [[ "$value" =~ ^[0-9]+$ ]] && [ "$value" -gt 1 ]; then
      value=$(awk "BEGIN{printf \"%.2f\",$value/100}")
    fi
    jq --argjson v "$value" '.run_config.alert_threshold = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
    echo "Updated: alert_threshold → $value"
    ;;
  ceo_adapter)
    case "$value" in claude-sonnet-4-6|claude-opus-4-7|claude-haiku-4-5) : ;; *)
      echo "ERROR: ceo_adapter must be one of: claude-sonnet-4-6, claude-opus-4-7, claude-haiku-4-5"; exit 1 ;;
    esac
    jq --arg v "$value" '.run_config.ceo_adapter = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
    echo "Updated: ceo_adapter → $value"
    ;;
  *)
    echo "ERROR: Unknown field '$field'. Valid fields: name, goal, topology, governance, budget_tokens, alert_threshold, ceo_adapter"
    exit 1
    ;;
esac
```

Emit `org:settings:updated` event:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg org "$org_name" --arg field "$field" --arg value "$value" \
    '{type:"org:settings:updated",org:$org,field:$field,value:$value,ts:(now*1000|floor)}')" || true
```

### export

Export the full org config (minus secrets) to a portable JSON:

```bash
mkdir -p ".monomind/exports"
timestamp=$(date +%Y%m%d-%H%M%S)
outPath="${export_path:-.monomind/exports/${org_name}-${timestamp}.json}"

# Merge all org data files into one export bundle
jq -n \
  --slurpfile config "$orgFile" \
  --slurpfile goals ".monomind/orgs/${org_name}-goals.json" 2>/dev/null \
  --slurpfile routines ".monomind/orgs/${org_name}-routines.json" 2>/dev/null \
  --slurpfile projects ".monomind/orgs/${org_name}-projects.json" 2>/dev/null \
  '{
    exported_at: (now|todate),
    format_version: "1.0",
    config: ($config[0] // {}),
    goals: ($goals[0].goals // []),
    routines: ($routines[0].routines // []),
    projects: ($projects[0].projects // [])
  }' > "$outPath"

echo "Exported: $outPath"
echo "$(wc -c < "$outPath") bytes — share this file to recreate the org on another machine."
echo "Import with: /mastermind:org-settings --action import --import-path $outPath"
```

### import

Import an org from a previously exported bundle:

```bash
[ ! -f "$import_path" ] && { echo "ERROR: Import file not found: $import_path"; exit 1; }

# Validate format
fmt=$(jq -r '.format_version // "unknown"' "$import_path" 2>/dev/null || echo "unknown")
[ "$fmt" != "1.0" ] && echo "Warning: format_version '$fmt' — attempting import anyway."

importedName=$(jq -r '.config.name // .config.org_name // "unnamed"' "$import_path")
targetOrg="${org_name:-$importedName}"
mkdir -p ".monomind/orgs"

# Write config
jq '.config' "$import_path" > ".monomind/orgs/${targetOrg}.json"

# Write goals if present
goalsData=$(jq '.goals // []' "$import_path")
[ "$goalsData" != "[]" ] && echo "{\"goals\":$goalsData}" > ".monomind/orgs/${targetOrg}-goals.json"

# Write routines if present
routinesData=$(jq '.routines // []' "$import_path")
[ "$routinesData" != "[]" ] && echo "{\"routines\":$routinesData}" > ".monomind/orgs/${targetOrg}-routines.json"

# Write projects if present
projectsData=$(jq '.projects // []' "$import_path")
[ "$projectsData" != "[]" ] && echo "{\"projects\":$projectsData}" > ".monomind/orgs/${targetOrg}-projects.json"

echo "Imported org '${targetOrg}' from ${import_path}"
echo "Agents: $(jq '.config.roles | length' "$import_path")"
echo "Run /mastermind:env --org ${targetOrg} --action validate to check provider keys."
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
field: <field if edit>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
