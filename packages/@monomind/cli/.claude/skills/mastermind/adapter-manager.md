---
name: mastermind-adapter-manager
description: Mastermind adapter-manager — global instance-level adapter catalog. Lists all built-in and npm-installed adapters, enables/disables them in menus, reinstalls from npm to pick up updates, adds custom HTTP adapters, and removes custom ones. Complements mastermind:adapters (per-org) with the global registry. Mirrors AdapterManager.tsx.
type: domain-skill
default_mode: confirm
---

# Mastermind Adapter Manager

This skill is invoked by `mastermind:adapter-manager` or directly via `/mastermind:adapter-manager`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `action`: list | enable | disable | reinstall | add-http | remove | check-update
- `adapter_type`: adapter type slug (required for enable/disable/reinstall/remove)
- `http_url`: base URL for the HTTP adapter endpoint (for add-http)
- `http_name`: display name for the HTTP adapter (for add-http)
- `http_label`: short label (for add-http; default: http_name)
- `caller`: command | master

---

## Adapter Registry Fields

```json
{
  "type": "adapter-slug",
  "label": "Display Name",
  "source": "built-in | npm | http",
  "packageName": "@paperclipai/adapter-name",
  "version": "1.2.0",
  "modelsCount": 3,
  "disabled": false,
  "isBuiltIn": true,
  "installedAt": "2026-01-01T00:00:00Z"
}
```

---

## Built-in Adapter Types

| Type | Label | Notes |
|------|-------|-------|
| `claude-local` | Claude (local CLI) | Default |
| `gemini-local` | Gemini (local) | |
| `codex-local` | Codex (OpenAI Codex CLI) | |
| `cursor` | Cursor IDE | |
| `opencode-local` | OpenCode | |
| `hermes-local` | Hermes (Ollama) | |
| `http` | Custom HTTP | Configurable endpoint |
| `acpx` | ACPX Protocol | |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Global Adapter Registry

```bash
adapterFile=".monomind/adapters/registry.json"
mkdir -p ".monomind/adapters"
if [ ! -f "$adapterFile" ]; then
  cat > "$adapterFile" <<'EOF'
{
  "adapters": [
    {"type":"claude-local","label":"Claude (local CLI)","source":"built-in","isBuiltIn":true,"disabled":false,"modelsCount":3},
    {"type":"gemini-local","label":"Gemini (local)","source":"built-in","isBuiltIn":true,"disabled":false,"modelsCount":2},
    {"type":"codex-local","label":"Codex (OpenAI)","source":"built-in","isBuiltIn":true,"disabled":false,"modelsCount":3},
    {"type":"cursor","label":"Cursor IDE","source":"built-in","isBuiltIn":true,"disabled":false,"modelsCount":1},
    {"type":"opencode-local","label":"OpenCode","source":"built-in","isBuiltIn":true,"disabled":false,"modelsCount":1},
    {"type":"hermes-local","label":"Hermes (Ollama)","source":"built-in","isBuiltIn":true,"disabled":false,"modelsCount":1},
    {"type":"http","label":"Custom HTTP","source":"built-in","isBuiltIn":true,"disabled":true,"modelsCount":0},
    {"type":"acpx","label":"ACPX Protocol","source":"built-in","isBuiltIn":true,"disabled":true,"modelsCount":0}
  ]
}
EOF
fi
```

---

## Step 2 — Execute Action

### list (default)

```bash
echo "GLOBAL ADAPTER REGISTRY"
echo "────────────────────────────────────────────────────────"
printf "%-20s %-22s %-10s %-8s %-8s %s\n" "TYPE" "LABEL" "SOURCE" "MODELS" "STATUS" "VERSION"
echo "────────────────────────────────────────────────────────"

jq -r '(.adapters // [])[] |
  [.type, (.label // .type), (.source // "built-in"),
   ((.modelsCount // 0) | tostring),
   (if .disabled then "disabled" else "enabled" end),
   (.version // "-")] | @tsv' \
  "$adapterFile" | while IFS=$'\t' read -r type label src models status ver; do
  printf "%-20s %-22s %-10s %-8s %-8s %s\n" "$type" "$label" "$src" "$models" "$status" "$ver"
done

total=$(jq '.adapters | length' "$adapterFile")
enabled=$(jq '[(.adapters // [])[] | select(.disabled == false or .disabled == null)] | length' "$adapterFile")
echo ""
echo "  Total: $total  |  Enabled: $enabled  |  Disabled: $((total - enabled))"
echo ""
echo "  To add a custom HTTP adapter: --action add-http --http-url http://localhost:8080 --http-name 'My Model'"
```

### enable

```bash
[ -z "$adapter_type" ] && { echo "ERROR: --adapter-type required."; exit 1; }

exists=$(jq -r --arg t "$adapter_type" '[(.adapters // [])[] | select(.type == $t)] | length' "$adapterFile")
[ "$exists" -eq 0 ] && { echo "ERROR: Adapter '$adapter_type' not found. Use --action list to see available adapters."; exit 1; }

tmp="${adapterFile}.tmp"
jq --arg t "$adapter_type" \
  '.adapters = [(.adapters // [])[] | if .type == $t then .disabled = false else . end]' \
  "$adapterFile" > "$tmp" && mv "$tmp" "$adapterFile"

echo "Adapter '$adapter_type' ENABLED — will appear in agent model menus."
```

### disable

```bash
[ -z "$adapter_type" ] && { echo "ERROR: --adapter-type required."; exit 1; }

isBuiltIn=$(jq -r --arg t "$adapter_type" '(.adapters // [])[] | select(.type == $t) | .isBuiltIn // false' "$adapterFile")

tmp="${adapterFile}.tmp"
jq --arg t "$adapter_type" \
  '.adapters = [(.adapters // [])[] | if .type == $t then .disabled = true else . end]' \
  "$adapterFile" > "$tmp" && mv "$tmp" "$adapterFile"

echo "Adapter '$adapter_type' DISABLED — hidden from model menus."
[ "$isBuiltIn" = "true" ] && echo "  NOTE: Built-in adapter disabled but not removed. Re-enable with --action enable."
```

### reinstall

```bash
[ -z "$adapter_type" ] && { echo "ERROR: --adapter-type required."; exit 1; }

pkg=$(jq -r --arg t "$adapter_type" '(.adapters // [])[] | select(.type == $t) | .packageName // ""' "$adapterFile")
[ -z "$pkg" ] && { echo "ERROR: Adapter '$adapter_type' has no packageName — cannot reinstall. Only npm-installed adapters support reinstall."; exit 1; }

echo "REINSTALL — $adapter_type from $pkg"
echo "────────────────────────────────────────────────────────"
echo "  Running: npm install $pkg"

if npm install "$pkg" 2>&1 | tail -5; then
  newVer=$(node -e "try{console.log(require('$pkg/package.json').version)}catch(e){console.log('unknown')}" 2>/dev/null)
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  tmp="${adapterFile}.tmp"
  jq --arg t "$adapter_type" --arg v "$newVer" --arg ts "$ts" \
    '.adapters = [(.adapters // [])[] | if .type == $t then .version = $v | .reinstalledAt = $ts else . end]' \
    "$adapterFile" > "$tmp" && mv "$tmp" "$adapterFile"
  echo "  Reinstalled: $adapter_type @ $newVer"
else
  echo "  ERROR: npm install failed. Check your network and package name."
fi
```

### add-http

```bash
[ -z "$http_url" ] && { echo "ERROR: --http-url required (e.g. http://localhost:8080)."; exit 1; }
[ -z "$http_name" ] && { echo "ERROR: --http-name required (display name for this adapter)."; exit 1; }

# Validate URL
echo "$http_url" | grep -qE '^https?://' || { echo "ERROR: --http-url must start with http:// or https://"; exit 1; }

# Generate slug from name
slug=$(echo "${http_name}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')
slug="http-${slug}"

# Check for duplicate
dup=$(jq -r --arg t "$slug" '[(.adapters // [])[] | select(.type == $t)] | length' "$adapterFile")
[ "$dup" -gt 0 ] && { echo "ERROR: Adapter slug '$slug' already exists. Remove first: --action remove --adapter-type $slug"; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${adapterFile}.tmp"
jq --arg type "$slug" \
   --arg label "${http_label:-$http_name}" \
   --arg url "$http_url" \
   --arg ts "$ts" \
  '.adapters += [{"type":$type,"label":$label,"source":"http","isBuiltIn":false,"disabled":false,"modelsCount":0,"httpUrl":$url,"installedAt":$ts}]' \
  "$adapterFile" > "$tmp" && mv "$tmp" "$adapterFile"

echo "HTTP adapter added: $slug"
echo "  Label:   ${http_label:-$http_name}"
echo "  URL:     $http_url"
echo "  Slug:    $slug"
echo "  Status:  enabled"
```

### remove

```bash
[ -z "$adapter_type" ] && { echo "ERROR: --adapter-type required."; exit 1; }

isBuiltIn=$(jq -r --arg t "$adapter_type" '(.adapters // [])[] | select(.type == $t) | .isBuiltIn // false' "$adapterFile")
[ "$isBuiltIn" = "true" ] && { echo "ERROR: Cannot remove built-in adapter '$adapter_type'. Use --action disable instead."; exit 1; }

tmp="${adapterFile}.tmp"
jq --arg t "$adapter_type" \
  '.adapters = [(.adapters // [])[] | select(.type != $t)]' \
  "$adapterFile" > "$tmp" && mv "$tmp" "$adapterFile"

echo "Adapter '$adapter_type' removed from registry."
```

### check-update

```bash
echo "CHECKING FOR ADAPTER UPDATES"
echo "────────────────────────────────────────────────────────"

jq -r '(.adapters // [])[] | select(.packageName != null and .packageName != "") |
  [.type, .packageName, (.version // "unknown")] | @tsv' \
  "$adapterFile" | while IFS=$'\t' read -r type pkg ver; do
  latest=$(curl -sf "https://registry.npmjs.org/${pkg}/latest" 2>/dev/null | jq -r '.version // "?"' 2>/dev/null || echo "?")
  if [ "$latest" != "?" ] && [ "$latest" != "$ver" ]; then
    echo "  [$type]  $ver  →  $latest  (update available: npm install $pkg)"
  else
    echo "  [$type]  $ver  (up to date)"
  fi
done

npmCount=$(jq '[(.adapters // [])[] | select(.packageName != null)] | length' "$adapterFile")
[ "$npmCount" -eq 0 ] && echo "  No npm-installed adapters to check."
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
adapter_type: <type>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
