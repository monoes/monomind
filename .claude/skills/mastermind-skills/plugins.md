---
name: mastermind-plugins
description: Mastermind plugins — install, enable, disable, uninstall, and inspect plugins for an org. Plugins extend agent capabilities with workers, events, and custom tools. Supports npm packages and local paths.
type: domain-skill
default_mode: confirm
---

# Mastermind Plugins

This skill is invoked by `mastermind:plugins` or directly via `/mastermind:plugins`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to manage plugins for (optional — uses global plugin registry if omitted)
- `action`: list | install | uninstall | enable | disable | status | examples
- `plugin_id`: plugin id or package name (required for uninstall/enable/disable/status)
- `package_name`: npm package or local path (required for install)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Plugin Registry

```bash
pluginsDir=".monomind/plugins"
mkdir -p "$pluginsDir"
registryFile="${pluginsDir}/registry.json"
[ ! -f "$registryFile" ] && echo '{"plugins":[]}' > "$registryFile"

# If org scoped, also check org-level plugin overrides
if [ -n "$org_name" ]; then
  orgPluginsFile=".monomind/orgs/${org_name}-plugins.json"
  [ ! -f "$orgPluginsFile" ] && echo '{"plugins":[]}' > "$orgPluginsFile"
fi
```

---

## Step 2 — Execute Action

### list (default)

```bash
echo "PLUGINS"
echo "──────────────────────────────────────────────────────────"
printf "%-28s %-12s %-10s %-10s %s\n" "ID / PACKAGE" "VERSION" "STATUS" "CATEGORY" "ERROR"
echo "──────────────────────────────────────────────────────────"

count=$(jq '.plugins | length' "$registryFile")
if [ "$count" -eq 0 ]; then
  echo "  No plugins installed. Use --action install --package-name <pkg> to add one."
else
  jq -r '(.plugins // [])[] |
    [
      (.id // .packageName // "unknown"),
      (.version // "-"),
      (.status // "unknown"),
      (.category // "general"),
      (if .lastError then (.lastError | split("\n")[0] | .[0:40]) else "-" end)
    ] | @tsv' "$registryFile" | while IFS=$'\t' read -r id ver status cat err; do
    statusColor=""
    printf "%-28s %-12s %-10s %-10s %s\n" "$id" "$ver" "$status" "$cat" "$err"
  done
fi

echo ""
echo "Total: $count plugin(s)"
[ -n "$org_name" ] && echo "Org overrides: $(jq '.plugins | length' "$orgPluginsFile" 2>/dev/null || echo 0)"
```

### examples

Show example/available plugins from the monomind registry:

```bash
echo "AVAILABLE PLUGINS (monomind registry)"
echo "──────────────────────────────────────"
cat <<'EXAMPLES'
  @monomind/plugin-sentry      — Error tracking and alerting
  @monomind/plugin-github      — GitHub issue/PR sync
  @monomind/plugin-slack       — Slack notifications and commands
  @monomind/plugin-linear      — Linear issue sync
  @monomind/plugin-datadog     — Metrics and monitoring
  @monomind/plugin-vault       — HashiCorp Vault secrets integration
  @monomind/plugin-webhook     — Generic inbound/outbound webhooks
  @monomind/plugin-memory-ext  — Extended memory backend

Install: /mastermind:plugins --action install --package-name @monomind/plugin-<name>
EXAMPLES
```

### install

```bash
[ -z "$package_name" ] && { echo "ERROR: --package-name required."; exit 1; }

isLocal=false
[[ "$package_name" == /* || "$package_name" == "./"* ]] && isLocal=true

# Generate a stable id
pluginId=$(echo "$package_name" | sed 's|[/@]|_|g' | tr -cd 'a-z0-9_-')
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

tmp="${registryFile}.tmp"
jq --arg id "$pluginId" \
   --arg pkg "$package_name" \
   --argjson local "$isLocal" \
   --arg ts "$ts" \
   '.plugins = [(.plugins // [])[] | select(.id != $id)] +
    [{"id":$id,"packageName":$pkg,"isLocalPath":$local,
      "status":"installed","version":"latest","category":"general",
      "installedAt":$ts,"lastError":null}]' \
  "$registryFile" > "$tmp" && mv "$tmp" "$registryFile"

echo "Installed: $package_name (id: $pluginId)"
echo "NOTE: Agents must be restarted to load the new plugin."
```

Emit `org:plugin:installed` event:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg org "${org_name:-global}" --arg id "$pluginId" --arg pkg "$package_name" \
    '{type:"org:plugin:installed",org:$org,plugin:$id,package:$pkg,ts:(now*1000|floor)}')" || true
```

### uninstall

```bash
[ -z "$plugin_id" ] && { echo "ERROR: --plugin-id required."; exit 1; }
echo "Uninstalling plugin '$plugin_id'…"

tmp="${registryFile}.tmp"
jq --arg id "$plugin_id" '.plugins = [(.plugins // [])[] | select(.id != $id)]' \
  "$registryFile" > "$tmp" && mv "$tmp" "$registryFile"
echo "Uninstalled: $plugin_id"
```

### enable / disable

```bash
[ -z "$plugin_id" ] && { echo "ERROR: --plugin-id required."; exit 1; }
newStatus=$([ "$action" = "enable" ] && echo "installed" || echo "disabled")

tmp="${registryFile}.tmp"
jq --arg id "$plugin_id" --arg s "$newStatus" \
  '.plugins = [(.plugins // [])[] | if .id == $id then .status = $s else . end]' \
  "$registryFile" > "$tmp" && mv "$tmp" "$registryFile"
echo "Plugin '$plugin_id' → $newStatus"
```

### status

Show detailed status for a specific plugin:

```bash
[ -z "$plugin_id" ] && { echo "ERROR: --plugin-id required."; exit 1; }
jq --arg id "$plugin_id" '(.plugins // [])[] | select(.id == $id)' "$registryFile"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name or global>
plugin_id: <id if applicable>
plugins_total: <N>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
