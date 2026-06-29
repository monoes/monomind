---
name: mastermind-plugin-manager
description: Mastermind plugin-manager — install plugins from npm, uninstall with two-step confirmation, enable/disable installed plugins. Extends mastermind:plugins (listing) and mastermind:plugin-settings (per-plugin config) with the install/uninstall lifecycle. Mirrors PluginManager.tsx.
type: domain-skill
default_mode: confirm
---

# Mastermind Plugin Manager

This skill is invoked by `mastermind:plugin-manager` or directly via `/mastermind:plugin-manager`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `action`: list | install | uninstall | enable | disable | check-updates
- `package_name`: npm package name to install (for install; e.g. `@monomind/plugin-github`)
- `plugin_id`: plugin id slug (required for uninstall/enable/disable)
- `confirm`: yes (required second step for uninstall — prevents accidental removal)
- `caller`: command | master

---

## Plugin Record Schema

```json
{
  "id": "plugin-slug",
  "packageName": "@monomind/plugin-name",
  "status": "installed",
  "version": "1.2.0",
  "category": "monitoring",
  "description": "One-line plugin description",
  "installedAt": "2026-01-01T00:00:00Z",
  "config": {},
  "grants": [],
  "health": {"status": "ok", "lastCheck": null}
}
```

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Plugin Registry

```bash
registryFile=".monomind/plugins/registry.json"
mkdir -p ".monomind/plugins"
[ ! -f "$registryFile" ] && echo '{"plugins":[]}' > "$registryFile"
```

---

## Step 2 — Execute Action

### list (default)

```bash
echo "INSTALLED PLUGINS"
echo "────────────────────────────────────────────────────────"
printf "%-24s %-10s %-10s %-14s %s\n" "ID" "STATUS" "VERSION" "CATEGORY" "PACKAGE"
echo "────────────────────────────────────────────────────────"

count=$(jq '.plugins | length' "$registryFile")
if [ "$count" -eq 0 ]; then
  echo "  No plugins installed."
  echo "  Install one: --action install --package-name @monomind/plugin-github"
else
  jq -r '(.plugins // [])[] |
    [.id, (.status // "installed"), (.version // "-"), (.category // "general"),
     (.packageName // "-")] | @tsv' \
    "$registryFile" | while IFS=$'\t' read -r id st ver cat pkg; do
    printf "%-24s %-10s %-10s %-14s %s\n" "$id" "$st" "$ver" "$cat" "$pkg"
  done

  errCount=$(jq '[(.plugins // [])[] | select(.status == "error")] | length' "$registryFile")
  [ "$errCount" -gt 0 ] && echo "" && echo "  WARNING: $errCount plugin(s) in error state. Run: --action list to inspect."
fi

echo ""
echo "  Install:    --action install --package-name <npm-package>"
echo "  Uninstall:  --action uninstall --plugin-id <id>"
echo "  Settings:   /mastermind:plugin-settings --plugin-id <id>"
```

### install

```bash
[ -z "$package_name" ] && { echo "ERROR: --package-name required (e.g. @monomind/plugin-github)."; exit 1; }

echo "INSTALLING PLUGIN — $package_name"
echo "────────────────────────────────────────────────────────"
echo "  Running: npm install $package_name"

# Check if already installed
alreadyId=$(jq -r --arg pkg "$package_name" '(.plugins // [])[] | select(.packageName == $pkg) | .id' "$registryFile" | head -1)
[ -n "$alreadyId" ] && {
  echo "  Plugin already installed as '$alreadyId'. Use --action enable/disable or reinstall via npm."
  exit 0
}

if npm install "$package_name" 2>&1 | tail -5; then
  # Derive plugin metadata from npm package
  pkgVer=$(node -e "try{console.log(require('${package_name}/package.json').version)}catch(e){console.log('0.0.0')}" 2>/dev/null || echo "0.0.0")
  pkgDesc=$(node -e "try{console.log(require('${package_name}/package.json').description||'')}catch(e){console.log('')}" 2>/dev/null || echo "")
  pluginId=$(echo "$package_name" | sed 's|@[^/]*/||' | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  tmp="${registryFile}.tmp"
  jq --arg id "$pluginId" \
     --arg pkg "$package_name" \
     --arg ver "$pkgVer" \
     --arg desc "$pkgDesc" \
     --arg ts "$ts" \
    '.plugins += [{"id":$id,"packageName":$pkg,"status":"installed","version":$ver,
      "description":$desc,"category":"general","config":{},"grants":[],
      "health":{"status":"ok","lastCheck":null},"installedAt":$ts}]' \
    "$registryFile" > "$tmp" && mv "$tmp" "$registryFile"

  echo ""
  echo "Plugin installed: $pluginId @ $pkgVer"
  echo "  Configure: /mastermind:plugin-settings --plugin-id $pluginId"
else
  echo "  ERROR: npm install failed. Check the package name and network connectivity."
  exit 1
fi
```

### uninstall

```bash
[ -z "$plugin_id" ] && { echo "ERROR: --plugin-id required."; exit 1; }

exists=$(jq -r --arg id "$plugin_id" '[(.plugins // [])[] | select(.id == $id)] | length' "$registryFile")
[ "$exists" -eq 0 ] && { echo "ERROR: Plugin '$plugin_id' not found."; exit 1; }

# Two-step confirmation
if [ "${confirm:-}" != "yes" ]; then
  pkg=$(jq -r --arg id "$plugin_id" '(.plugins // [])[] | select(.id == $id) | .packageName // $id' "$registryFile")
  echo "UNINSTALL CONFIRMATION REQUIRED"
  echo "────────────────────────────────────────────────────────"
  echo "  Plugin:  $plugin_id  ($pkg)"
  echo "  This will remove the plugin and all its configuration."
  echo ""
  echo "  To confirm: --action uninstall --plugin-id $plugin_id --confirm yes"
  exit 0
fi

pkg=$(jq -r --arg id "$plugin_id" '(.plugins // [])[] | select(.id == $id) | .packageName // ""' "$registryFile")

# Remove from registry
tmp="${registryFile}.tmp"
jq --arg id "$plugin_id" \
  '.plugins = [(.plugins // [])[] | select(.id != $id)]' \
  "$registryFile" > "$tmp" && mv "$tmp" "$registryFile"

echo "Plugin '$plugin_id' removed from registry."

# Attempt npm uninstall if packageName known
if [ -n "$pkg" ]; then
  echo "  Running: npm uninstall $pkg"
  npm uninstall "$pkg" 2>&1 | tail -3 || echo "  WARNING: npm uninstall had errors — registry entry removed anyway."
fi
```

### enable

```bash
[ -z "$plugin_id" ] && { echo "ERROR: --plugin-id required."; exit 1; }

exists=$(jq -r --arg id "$plugin_id" '[(.plugins // [])[] | select(.id == $id)] | length' "$registryFile")
[ "$exists" -eq 0 ] && { echo "ERROR: Plugin '$plugin_id' not found."; exit 1; }

tmp="${registryFile}.tmp"
jq --arg id "$plugin_id" \
  '.plugins = [(.plugins // [])[] | if .id == $id then .status = "installed" | .disabledAt = null else . end]' \
  "$registryFile" > "$tmp" && mv "$tmp" "$registryFile"

echo "Plugin '$plugin_id' ENABLED."
```

### disable

```bash
[ -z "$plugin_id" ] && { echo "ERROR: --plugin-id required."; exit 1; }

exists=$(jq -r --arg id "$plugin_id" '[(.plugins // [])[] | select(.id == $id)] | length' "$registryFile")
[ "$exists" -eq 0 ] && { echo "ERROR: Plugin '$plugin_id' not found."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${registryFile}.tmp"
jq --arg id "$plugin_id" --arg ts "$ts" \
  '.plugins = [(.plugins // [])[] | if .id == $id then .status = "disabled" | .disabledAt = $ts else . end]' \
  "$registryFile" > "$tmp" && mv "$tmp" "$registryFile"

echo "Plugin '$plugin_id' DISABLED — will not load on next startup."
```

### check-updates

```bash
echo "CHECKING PLUGIN UPDATES"
echo "────────────────────────────────────────────────────────"

count=$(jq '.plugins | length' "$registryFile")
[ "$count" -eq 0 ] && { echo "  No plugins installed."; exit 0; }

jq -r '(.plugins // [])[] | select(.packageName != null) |
  [.id, .packageName, (.version // "unknown")] | @tsv' \
  "$registryFile" | while IFS=$'\t' read -r id pkg ver; do
  latest=$(curl -sf "https://registry.npmjs.org/${pkg}/latest" 2>/dev/null | jq -r '.version // "?"' 2>/dev/null || echo "?")
  if [ "$latest" != "?" ] && [ "$latest" != "$ver" ]; then
    echo "  [$id]  $ver  →  $latest  — run: npm install $pkg"
  else
    echo "  [$id]  $ver  (up to date)"
  fi
done
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
plugin_id: <plugin_id>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
