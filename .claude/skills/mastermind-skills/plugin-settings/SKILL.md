---
name: mastermind-plugin-settings
description: Mastermind plugin-settings — inspect and configure a single installed plugin. View configuration fields, manage file system access grants (read/write paths), check runtime health/status, and update plugin settings. Mirrors Paperclip's PluginSettings page with configuration and status tabs.
type: domain-skill
default_mode: confirm
---

# Mastermind Plugin Settings

This skill is invoked by `mastermind:plugin-settings` or directly via `/mastermind:plugin-settings`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `plugin_id`: plugin id to manage (required)
- `org_name`: org scope (optional — uses global registry if omitted)
- `action`: show | config | status | grants | set-config | add-grant | remove-grant
- `config_key`: config key to set (for set-config)
- `config_value`: config value (for set-config)
- `grant_path`: filesystem path to grant access to (for add-grant/remove-grant)
- `grant_access`: read | write | readwrite (for add-grant, default: read)
- `caller`: command | master

---

## Plugin Configuration Model

```json
{
  "id": "plugin-slug",
  "packageName": "@monomind/plugin-name",
  "status": "installed",
  "version": "1.2.0",
  "category": "monitoring",
  "config": {
    "apiKey": "***",
    "webhookUrl": "https://...",
    "customField": "value"
  },
  "grants": [
    { "path": "/tmp/plugin-data", "access": "readwrite" },
    { "path": "/project/logs", "access": "read" }
  ],
  "health": {
    "status": "ok",
    "lastCheck": "2026-01-01T00:00:00Z",
    "message": null
  }
}
```

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Plugin Registry

```bash
registryFile=".monomind/plugins/registry.json"
[ ! -f "$registryFile" ] && { echo "ERROR: No plugin registry found. Install plugins via /mastermind:plugins."; exit 1; }

pluginDef=$(jq -r --arg id "$plugin_id" '(.plugins // [])[] | select(.id == $id)' "$registryFile")
[ -z "$pluginDef" ] && { echo "ERROR: Plugin '$plugin_id' not found. List plugins via /mastermind:plugins --action list."; exit 1; }

# Load org-level overrides if org_name specified
orgPluginsFile=""
if [ -n "$org_name" ]; then
  orgPluginsFile=".monomind/orgs/${org_name}-plugins.json"
  orgOverride=$([ -f "$orgPluginsFile" ] && jq -r --arg id "$plugin_id" '(.plugins // [])[] | select(.id == $id)' "$orgPluginsFile" || echo "")
fi
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "PLUGIN — $plugin_id"
echo "────────────────────────────────────────────────────────"

echo "$pluginDef" | jq -r '
  "  ID:         \(.id)",
  "  Package:    \(.packageName // "-")",
  "  Version:    \(.version // "-")",
  "  Status:     \(.status // "unknown")",
  "  Category:   \(.category // "general")",
  "  Local path: \(if .isLocalPath then "yes" else "no" end)",
  "  Installed:  \(.installedAt // "-")"
'

if [ -n "$orgOverride" ] && [ "$orgOverride" != "null" ]; then
  echo ""
  echo "  ORG OVERRIDE ($org_name):"
  echo "$orgOverride" | jq -r '"  Status: \(.status // "inherited")"'
fi

# Config summary
configCount=$(echo "$pluginDef" | jq -r '(.config // {}) | length')
echo ""
echo "  Config fields:  $configCount"
echo "  Grants:         $(echo "$pluginDef" | jq -r '(.grants // []) | length')"

# Health
healthStatus=$(echo "$pluginDef" | jq -r '.health.status // "unknown"')
healthMsg=$(echo "$pluginDef" | jq -r '.health.message // ""')
echo "  Health:         $healthStatus${healthMsg:+ — $healthMsg}"

# Last error
lastErr=$(echo "$pluginDef" | jq -r '.lastError // ""')
[ -n "$lastErr" ] && echo "" && echo "  LAST ERROR: $lastErr"
```

### config

```bash
echo "CONFIG — $plugin_id"
echo "────────────────────────────────────────────────────────"

config=$(echo "$pluginDef" | jq -r '.config // {}')
count=$(echo "$config" | jq 'length')

if [ "$count" -eq 0 ]; then
  echo "  No configuration fields."
  echo "  Set a field: --action set-config --config-key <key> --config-value <value>"
else
  echo "$config" | jq -r 'to_entries[] |
    if (.value | type) == "string" and (.key | test("key|token|secret|password|api"; "i")) then
      "  \(.key) = ***"
    else
      "  \(.key) = \(.value)"
    end'
fi
```

### status

```bash
echo "PLUGIN STATUS — $plugin_id"
echo "────────────────────────────────────────────────────────"

echo "$pluginDef" | jq -r '
  "  Status:      \(.status // "unknown")",
  "  Version:     \(.version // "-")",
  "  Installed:   \(.installedAt // "-")"
'

health=$(echo "$pluginDef" | jq -r '.health // {}')
healthStatus=$(echo "$health" | jq -r '.status // "unknown"')
lastCheck=$(echo "$health" | jq -r '.lastCheck // "-"')
healthMsg=$(echo "$health" | jq -r '.message // ""')

echo ""
echo "HEALTH CHECK"
echo "  Status:    $healthStatus"
echo "  Last:      $lastCheck"
[ -n "$healthMsg" ] && echo "  Message:   $healthMsg"

# Error
lastErr=$(echo "$pluginDef" | jq -r '.lastError // ""')
if [ -n "$lastErr" ]; then
  echo ""
  echo "LAST ERROR"
  echo "  $lastErr"
fi

# Suggest reload
[ "$healthStatus" = "error" ] && echo "" && echo "  Run: /mastermind:plugins --action reload --plugin-id $plugin_id"
```

### grants

```bash
echo "FILE SYSTEM GRANTS — $plugin_id"
echo "────────────────────────────────────────────────────────"
printf "%-6s %s\n" "ACCESS" "PATH"
echo "────────────────────────────────────────────────────────"

grants=$(echo "$pluginDef" | jq -r '(.grants // [])[]' 2>/dev/null)
if [ -z "$grants" ]; then
  echo "  No file system grants."
  echo "  Add a grant: --action add-grant --grant-path /path/to/dir --grant-access read"
else
  echo "$pluginDef" | jq -r '(.grants // [])[] |
    "  \(.access // "read")\t\(.path)"' | while IFS=$'\t' read -r acc path; do
    printf "  %-10s %s\n" "$acc" "$path"
  done
fi
```

### set-config

```bash
[ -z "$config_key" ] && { echo "ERROR: --config-key required."; exit 1; }
[ -z "$config_value" ] && { echo "ERROR: --config-value required."; exit 1; }

tmp="${registryFile}.tmp"
jq --arg id "$plugin_id" --arg k "$config_key" --arg v "$config_value" \
  '.plugins = [(.plugins // [])[] | if .id == $id then
     if .config == null then .config = {} else . end |
     .config[$k] = $v
   else . end]' \
  "$registryFile" > "$tmp" && mv "$tmp" "$registryFile"

# Mask value in output if sensitive key
if echo "$config_key" | grep -qiE "key|token|secret|password|api"; then
  echo "Config set: $config_key = ***"
else
  echo "Config set: $config_key = $config_value"
fi
echo "NOTE: Restart agents or reload the plugin for changes to take effect."
```

### add-grant

```bash
[ -z "$grant_path" ] && { echo "ERROR: --grant-path required."; exit 1; }
access="${grant_access:-read}"
case "$access" in read|write|readwrite) : ;; *)
  echo "ERROR: --grant-access must be read, write, or readwrite"; exit 1 ;;
esac

tmp="${registryFile}.tmp"
jq --arg id "$plugin_id" --arg path "$grant_path" --arg access "$access" \
  '.plugins = [(.plugins // [])[] | if .id == $id then
     .grants = ((.grants // []) | map(select(.path != $path))) +
               [{"path":$path,"access":$access}]
   else . end]' \
  "$registryFile" > "$tmp" && mv "$tmp" "$registryFile"

echo "Grant added: $access → $grant_path"
```

### remove-grant

```bash
[ -z "$grant_path" ] && { echo "ERROR: --grant-path required."; exit 1; }

tmp="${registryFile}.tmp"
jq --arg id "$plugin_id" --arg path "$grant_path" \
  '.plugins = [(.plugins // [])[] | if .id == $id then
     .grants = [(.grants // [])[] | select(.path != $path)]
   else . end]' \
  "$registryFile" > "$tmp" && mv "$tmp" "$registryFile"

echo "Grant removed: $grant_path"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
plugin_id: <plugin_id>
plugin_status: <status>
health_status: <health>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
