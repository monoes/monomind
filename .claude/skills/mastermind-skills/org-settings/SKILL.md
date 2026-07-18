---
name: mastermind-org-settings
description: Mastermind org-settings — edit Org Runtime v2 configuration (name, goal, schedule, budget_tokens, memory_namespace, max_turns_per_message), export org as portable JSON, and import an org from a previously exported file.
type: domain-skill
default_mode: confirm
---

# Mastermind Org Settings

This skill is invoked by `mastermind:org-settings` or directly via `/mastermind:org-settings`.

It edits `.monomind/orgs/<org_name>.json` in place, and only ever touches fields that `OrgDefSchema` (`packages/@monomind/cli/src/orgrt/types.ts`) actually defines — every field listed below is read by the daemon (`org.ts`/`daemon.ts`/`session.ts`) at `monomind org run`/`serve` time. Its primary edit flow targets v2 fields only: `name`, `goal`, `schedule`, and `run_config` (`budget_tokens`, `memory_namespace`, `max_turns_per_message`). Role edits are not yet supported by this skill's `edit` action — `roles` is shown read-only via `show`.

<!-- LEGACY-ORG-V1: remove this note when v1 orgs are gone -->
There is no `topology`, `governance`, `alert_threshold`, or `ceo_adapter` in Org Runtime v2 — those were v1 board/prompt-orchestration fields with no runtime effect and have been removed from this skill's edit surface. Use `/mastermind:org-settings` only for v2-shaped orgs; v1 orgs must go through `monomind org migrate` first.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to configure (required)
- `action`: show | edit | export | import
- `field`: field to edit (name, goal, schedule, budget_tokens, memory_namespace, max_turns_per_message)
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
  "  Name:              \(.name // "-")",
  "  Goal:              \(.goal // "-")",
  "  Status:            \(.status // "stopped")",
  "  Schedule:          \(.schedule // "manual (no auto-schedule)")",
  "  Budget:            \(.run_config.budget_tokens // 1000000) tokens",
  "  Memory namespace:  \(.run_config.memory_namespace // ("org:" + (.name // "-")))",
  "  Max turns/message: \(.run_config.max_turns_per_message // 30)",
  "  Roles:             \(.roles | length) agents"
' "$orgFile"
echo ""
echo "  Run /mastermind:org-settings --org ${org_name} --action edit --field <field> --value <value>"
echo "  Fields: name | goal | schedule | budget_tokens | memory_namespace | max_turns_per_message"
```

### edit

Update a single field in the org config:

```bash
field="${field}"
value="${value}"
tmp="${orgFile}.tmp"

case "$field" in
  name)
    # Validate new name slug
    echo "$value" | grep -qE '^[a-z0-9][a-z0-9-]{0,63}$' || { echo "ERROR: name must match ^[a-z0-9][a-z0-9-]{0,63}$"; exit 1; }
    newOrgFile=".monomind/orgs/${value}.json"
    [ -f "$newOrgFile" ] && { echo "ERROR: An org named '${value}' already exists."; exit 1; }
    # Refuse to rename while the daemon has this org running — it holds the old
    # name's paths (defPath, cwd, runtime.json) in memory; a rename mid-run would
    # orphan that live state instead of moving it. A runtime.json left by a
    # crashed daemon (dead pid) does NOT count as running — same semantics as
    # isOrgRunning in packages/@monomind/cli/src/commands/org.ts.
    runtime_status=$(jq -r '.status // "stopped"' ".monomind/orgs/${org_name}/runtime.json" 2>/dev/null || echo "stopped")
    runtime_pid=$(jq -r '.pid // 0' ".monomind/orgs/${org_name}/runtime.json" 2>/dev/null || echo 0)
    if [ "$runtime_status" = "running" ] && [ "$runtime_pid" -gt 0 ] && kill -0 "$runtime_pid" 2>/dev/null; then
      echo "ERROR: org '${org_name}' is running (pid ${runtime_pid}) — stop it first: monomind org stop ${org_name}"; exit 1
    fi
    # Update the name field inside the JSON
    jq --arg v "$value" '.name = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
    # Rename the main config file
    mv "$orgFile" "$newOrgFile"
    # Rename all side-car artifact files — same suffix list as ORG_ARTIFACT_SUFFIXES
    # in packages/@monomind/cli/src/commands/org.ts (single source of truth for what
    # counts as an org-internal artifact vs. the org's own config file).
    for suffix in -state -goals -threads -activity -approvals -members -secrets -budgets \
                  -routines -issues -projects -workspaces -worktrees -environments \
                  -plugins -adapters -join-requests -bootstrap -project-workspaces \
                  -approval-comments -skills; do
      old_file=".monomind/orgs/${org_name}${suffix}.json"
      [ -f "$old_file" ] && mv "$old_file" ".monomind/orgs/${value}${suffix}.json" || true
      old_jsonl=".monomind/orgs/${org_name}${suffix}.jsonl"
      [ -f "$old_jsonl" ] && mv "$old_jsonl" ".monomind/orgs/${value}${suffix}.jsonl" || true
    done
    # Rename the org's runtime subdirectory (runs/, workspace/, stop file) if present
    old_dir=".monomind/orgs/${org_name}"
    [ -d "$old_dir" ] && mv "$old_dir" ".monomind/orgs/${value}" || true
    echo "Renamed org '${org_name}' → '${value}'"
    org_name="$value"
    orgFile="$newOrgFile"
    ;;
  goal)
    jq --arg v "$value" '.goal = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
    echo "Updated: goal → $value"
    ;;
  schedule)
    # daemon format (parseSchedule in orgrt/scheduler.ts): "<N>s" | "<N>m" | "<N>h", or "none"/"" to clear
    if [ "$value" = "none" ] || [ -z "$value" ]; then
      jq '.schedule = null' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
      echo "Updated: schedule → none (manual — run with monomind org run ${org_name})"
    else
      echo "$value" | grep -qE '^[0-9]+(s|m|h)$' || { echo "ERROR: schedule must match ^[0-9]+(s|m|h)$ (e.g. 30m, 2h) or 'none'"; exit 1; }
      jq --arg v "$value" '.schedule = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
      echo "Updated: schedule → $value (pick up with: monomind org serve)"
    fi
    ;;
  budget_tokens)
    [[ "$value" =~ ^[0-9]+$ ]] || { echo "ERROR: budget_tokens must be a positive integer"; exit 1; }
    jq --argjson v "$value" '.run_config.budget_tokens = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
    echo "Updated: budget_tokens → $value"
    ;;
  memory_namespace)
    jq --arg v "$value" '.run_config.memory_namespace = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
    echo "Updated: memory_namespace → $value"
    ;;
  max_turns_per_message)
    [[ "$value" =~ ^[0-9]+$ ]] || { echo "ERROR: max_turns_per_message must be a positive integer"; exit 1; }
    jq --argjson v "$value" '.run_config.max_turns_per_message = $v' "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
    echo "Updated: max_turns_per_message → $value"
    ;;
  *)
    echo "ERROR: Unknown field '$field'. Valid fields: name, goal, schedule, budget_tokens, memory_namespace, max_turns_per_message"
    exit 1
    ;;
esac
```

After any edit, re-validate the config the same way createorg does (non-fatal — the file is already written; this tells the user immediately if the org can no longer start):

```bash
npx -y monomind@latest org validate "$org_name" \
  || echo "WARNING: '${org_name}' no longer passes validation — fix it before 'monomind org run ${org_name}'"
```

Emit `org:settings:updated` event:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" -H "x-monomind-token: $(cat "${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.monomind/dashboard-token" 2>/dev/null || true)" \
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

# Pre-read optional side-car files (--slurpfile aborts jq when the file is missing)
goals_json=$([ -f ".monomind/orgs/${org_name}-goals.json" ]    && jq -c '.' ".monomind/orgs/${org_name}-goals.json"    || echo 'null')
routines_json=$([ -f ".monomind/orgs/${org_name}-routines.json" ] && jq -c '.' ".monomind/orgs/${org_name}-routines.json" || echo 'null')
projects_json=$([ -f ".monomind/orgs/${org_name}-projects.json" ] && jq -c '.' ".monomind/orgs/${org_name}-projects.json" || echo 'null')

# Merge all org data files into one export bundle
jq -n \
  --slurpfile config "$orgFile" \
  --argjson goals     "$goals_json" \
  --argjson routines  "$routines_json" \
  --argjson projects  "$projects_json" \
  '{
    exported_at: (now|todate),
    format_version: "1.0",
    config: ($config[0] // {}),
    goals: ($goals.goals // []),
    routines: ($routines.routines // []),
    projects: ($projects.projects // [])
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

# Write config — update the name field to match targetOrg (in case file was exported under a different name)
tmpConfig=".monomind/orgs/${targetOrg}.json.tmp"
jq --arg n "$targetOrg" '.config | .name = $n' "$import_path" > "$tmpConfig" && mv "$tmpConfig" ".monomind/orgs/${targetOrg}.json" || { rm -f "$tmpConfig"; echo "ERROR: Failed to write org config from import."; exit 1; }

# Write goals if present (atomic write)
goalsData=$(jq -c '.goals // []' "$import_path" 2>/dev/null || echo '[]')
if [ "$goalsData" != "[]" ]; then
  tmp=".monomind/orgs/${targetOrg}-goals.json.tmp"
  jq -n --argjson data "$goalsData" '{"goals":$data}' > "$tmp" && mv "$tmp" ".monomind/orgs/${targetOrg}-goals.json" || rm -f "$tmp"
fi

# Write routines if present (atomic write)
routinesData=$(jq -c '.routines // []' "$import_path" 2>/dev/null || echo '[]')
if [ "$routinesData" != "[]" ]; then
  tmp=".monomind/orgs/${targetOrg}-routines.json.tmp"
  jq -n --argjson data "$routinesData" '{"routines":$data}' > "$tmp" && mv "$tmp" ".monomind/orgs/${targetOrg}-routines.json" || rm -f "$tmp"
fi

# Write projects if present (atomic write)
projectsData=$(jq -c '.projects // []' "$import_path" 2>/dev/null || echo '[]')
if [ "$projectsData" != "[]" ]; then
  tmp=".monomind/orgs/${targetOrg}-projects.json.tmp"
  jq -n --argjson data "$projectsData" '{"projects":$data}' > "$tmp" && mv "$tmp" ".monomind/orgs/${targetOrg}-projects.json" || rm -f "$tmp"
fi

echo "Imported org '${targetOrg}' from ${import_path}"
echo "Agents: $(jq '.config.roles | length' "$import_path")"

# An imported bundle is untrusted input — validate before declaring success
# (schema + single root role + resolvable reports_to + parseable schedule).
npx -y monomind@latest org validate "$targetOrg" \
  || { echo "ERROR: imported org failed validation — fix .monomind/orgs/${targetOrg}.json before running it."; exit 1; }

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
