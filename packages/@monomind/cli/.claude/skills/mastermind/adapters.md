---
name: mastermind-adapters
description: Mastermind adapters — install, enable, disable, reload, and remove LLM adapter plugins per org. Supports claude-local, gemini-local, codex-local, cursor, hermes, http, and custom adapters.
type: domain-skill
default_mode: confirm
---

# Mastermind Adapters

This skill is invoked by `mastermind:adapters` or directly via `/mastermind:adapters`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to manage adapters for (required)
- `action`: list | enable | disable | install | remove | reload | set-default
- `adapter_type`: adapter slug (e.g. `claude-local`, `gemini-local`, `http`) — required for most actions
- `package_name`: npm package name or local path (required for `install`)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Built-in Adapter Registry

| Type | Label | Source | Notes |
|------|-------|--------|-------|
| `claude-local` | Claude (local CLI) | built-in | Uses `claude` CLI |
| `claude-opus-4-7` | Claude Opus 4.7 | built-in | High capability |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | built-in | Balanced (default) |
| `claude-haiku-4-5` | Claude Haiku 4.5 | built-in | Fast, low cost |
| `gemini-local` | Gemini (local) | built-in | Uses `gemini` CLI |
| `codex-local` | Codex (local) | built-in | Uses `codex` CLI |
| `cursor` | Cursor | built-in | Uses Cursor agent |
| `hermes-local` | Hermes (local) | built-in | Local Hermes LLM |
| `http` | HTTP Adapter | built-in | Generic HTTP endpoint |
| `acpx-local` | ACPX (local) | built-in | ACPX protocol |

---

## Step 1 — Load Adapter Registry

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

adaptersFile=".monomind/orgs/${org_name}-adapters.json"
if [ ! -f "$adaptersFile" ]; then
  # Bootstrap from org config adapter_config if present
  defaultModel=$(jq -r '.run_config.ceo_adapter // "claude-sonnet-4-6"' "$orgFile")
  cat > "$adaptersFile" <<EOF
{
  "org": "${org_name}",
  "default_adapter": "${defaultModel}",
  "adapters": [
    {"type":"claude-local","label":"Claude (local CLI)","source":"built-in","disabled":false,"modelsCount":3},
    {"type":"gemini-local","label":"Gemini (local)","source":"built-in","disabled":false,"modelsCount":1},
    {"type":"http","label":"HTTP Adapter","source":"built-in","disabled":true,"modelsCount":0}
  ]
}
EOF
fi
```

---

## Step 2 — Execute Action

### list (default)

```bash
echo "ADAPTERS — org: $org_name"
echo "──────────────────────────────────────────────────────"
printf "%-22s %-28s %-10s %-8s %s\n" "TYPE" "LABEL" "SOURCE" "MODELS" "STATUS"
echo "──────────────────────────────────────────────────────"

defaultAdap=$(jq -r '.default_adapter // "claude-sonnet-4-6"' "$adaptersFile")

jq -r --arg def "$defaultAdap" '
  (.adapters // [])[] |
  [.type, (.label // .type), (.source // "built-in"), (.modelsCount // 0 | tostring),
   (if .disabled then "DISABLED" else "ACTIVE" end),
   (if .type == $def then " ← default" else "" end)]
  | @tsv
' "$adaptersFile" | while IFS=$'\t' read -r type label source models status def; do
  printf "%-22s %-28s %-10s %-8s %s%s\n" "$type" "$label" "$source" "$models" "$status" "$def"
done

echo ""
echo "Default adapter: $defaultAdap"
echo "External adapters: $(jq '[(.adapters // [])[] | select(.source == "external")] | length' "$adaptersFile")"
```

### enable / disable

```bash
action_status=$([ "$action" = "enable" ] && echo "false" || echo "true")
tmp="${adaptersFile}.tmp"
jq --arg type "$adapter_type" --argjson dis "$action_status" \
  '.adapters = [(.adapters // [])[] | if .type == $type then .disabled = $dis else . end]' \
  "$adaptersFile" > "$tmp" && mv "$tmp" "$adaptersFile"

# If re-enabling, also check org config adapter_config for matching roles
echo "Adapter '$adapter_type' → $([ "$action" = "enable" ] && echo 'ACTIVE' || echo 'DISABLED')"
```

### install

Add an external adapter (npm package or local path):

```bash
[ -z "$package_name" ] && { echo "ERROR: --package-name required."; exit 1; }
[ -z "$adapter_type" ] && adapter_type=$(echo "$package_name" | sed 's/[@/].*$//' | tr '-' '_')

isLocal=false
[[ "$package_name" == /* || "$package_name" == "./"* ]] && isLocal=true

tmp="${adaptersFile}.tmp"
jq --arg type "$adapter_type" \
   --arg pkg "$package_name" \
   --argjson local "$isLocal" \
   '.adapters = [(.adapters // [])[] | select(.type != $type)] +
    [{"type":$type,"label":$pkg,"source":"external","packageName":$pkg,"isLocalPath":$local,
      "disabled":false,"modelsCount":0,"installedAt":(now|todate)}]' \
  "$adaptersFile" > "$tmp" && mv "$tmp" "$adaptersFile"
echo "Installed: $package_name as adapter type '$adapter_type'"
echo "NOTE: Restart the org run to activate the new adapter."
```

Emit `org:adapter:installed` event:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg org "$org_name" --arg type "$adapter_type" --arg pkg "$package_name" \
    '{type:"org:adapter:installed",org:$org,adapter:$type,package:$pkg,ts:(now*1000|floor)}')" || true
```

### remove

```bash
[ -z "$adapter_type" ] && { echo "ERROR: --adapter-type required."; exit 1; }

# Verify it's external
src=$(jq -r --arg t "$adapter_type" '(.adapters // [])[] | select(.type == $t) | .source' "$adaptersFile" 2>/dev/null)
[ "$src" = "built-in" ] && { echo "ERROR: Cannot remove built-in adapters. Use 'disable' instead."; exit 1; }
[ -z "$src" ] && { echo "ERROR: Adapter '$adapter_type' not found."; exit 1; }

tmp="${adaptersFile}.tmp"
jq --arg type "$adapter_type" '.adapters = [(.adapters // [])[] | select(.type != $type)]' \
  "$adaptersFile" > "$tmp" && mv "$tmp" "$adaptersFile"
echo "Removed adapter: $adapter_type"
```

### set-default

```bash
[ -z "$adapter_type" ] && { echo "ERROR: --adapter-type required."; exit 1; }
tmp="${adaptersFile}.tmp"
jq --arg type "$adapter_type" '.default_adapter = $type' "$adaptersFile" > "$tmp" && mv "$tmp" "$adaptersFile"
# Sync to org run_config as well
orgTmp="${orgFile}.tmp"
jq --arg model "$adapter_type" '.run_config.ceo_adapter = $model' "$orgFile" > "$orgTmp" && mv "$orgTmp" "$orgFile"
echo "Default adapter set to: $adapter_type"
```

### reload

Force a reload hint (marks adapter as needing restart):

```bash
tmp="${adaptersFile}.tmp"
jq --arg type "$adapter_type" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '.adapters = [(.adapters // [])[] | if .type == $type then .last_reload = $ts else . end]' \
  "$adaptersFile" > "$tmp" && mv "$tmp" "$adaptersFile"
echo "Marked adapter '$adapter_type' for reload. Restart the org run to apply."
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
adapter_type: <adapter_type if applicable>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
