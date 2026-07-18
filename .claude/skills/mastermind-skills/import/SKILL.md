---
name: mastermind-import
description: Mastermind import — import an org from a portable ZIP archive exported by mastermind:export. Previews the archive contents, shows agent plans (create/update/skip), lets you choose a collision strategy, and applies the import to the local .monomind/orgs/ directory. Mirrors CompanyImport.tsx.
type: domain-skill
default_mode: confirm
---

# Mastermind Import

This skill is invoked by `mastermind:import` or directly via `/mastermind:import`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `action`: preview | apply | list-archive
- `archive_path`: absolute or relative path to the ZIP archive file (required)
- `org_name`: override org name from archive (default: use name in archive)
- `collision`: skip | merge | overwrite (what to do if org already exists; default: skip)
- `adapter_override`: optional; adapter type to replace all agents' adapters (e.g. `claude-local`)
- `caller`: command | master

---

## Collision Strategy Reference

| Strategy | Behavior |
|----------|----------|
| `skip` | If org already exists, abort. Safe default. |
| `merge` | Merge: add agents/goals/etc from archive, skip duplicates by id. |
| `overwrite` | Delete existing org files and replace with archive contents. |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Validate Archive

```bash
[ -z "$archive_path" ] && { echo "ERROR: --archive-path required (path to the exported .zip file)."; exit 1; }
[ ! -f "$archive_path" ] && { echo "ERROR: Archive not found: $archive_path"; exit 1; }

# Detect format
case "$archive_path" in
  *.zip) fmt="zip" ;;
  *.tar.gz|*.tgz) fmt="tgz" ;;
  *.json) fmt="json" ;;
  *) echo "ERROR: Unsupported archive format. Expected .zip, .tar.gz, or .json"; exit 1 ;;
esac

echo "Archive: $archive_path  (format: $fmt)"
```

---

## Step 2 — Execute Action

### list-archive

List files in the archive without extracting:

```bash
if [ "$fmt" = "zip" ]; then
  unzip -l "$archive_path" 2>/dev/null | grep -v "^Archive\|^--\|files$" | awk '{print $NF}' | grep -v "^$"
elif [ "$fmt" = "tgz" ]; then
  tar -tzf "$archive_path"
elif [ "$fmt" = "json" ]; then
  echo "(JSON format — single file, no archive listing needed)"
fi
```

### preview

Extract and preview the org configuration without writing:

```bash
tmpDir=$(mktemp -d /tmp/mastermind-import-XXXXXX)
trap 'rm -rf "$tmpDir"' EXIT

if [ "$fmt" = "zip" ]; then
  unzip -q "$archive_path" -d "$tmpDir" 2>/dev/null
elif [ "$fmt" = "tgz" ]; then
  tar -xzf "$archive_path" -C "$tmpDir" 2>/dev/null
elif [ "$fmt" = "json" ]; then
  cp "$archive_path" "$tmpDir/org.json"
fi

# Find the main org config file (exclude sidecar files and manifest)
orgConfigFile=$(find "$tmpDir" -name "*.json" | grep -vE -- '-approvals|-state|-activity|-goals|-routines|-projects|-members|-issues|-workspaces|-worktrees|-environments|-plugins|-adapters|-bootstrap|-threads|-budgets|-project-workspaces|-approval-comments|-secrets|/manifest\.json' | head -1)
[ -z "$orgConfigFile" ] && orgConfigFile=$(find "$tmpDir" -name "org.json" -o -name "export.json" | head -1)

if [ -z "$orgConfigFile" ]; then
  echo "ERROR: Could not find org config file in archive."
  exit 1
fi

importedOrgName="${org_name:-$(jq -r '.name // "unknown"' "$orgConfigFile")}"
agentCount=$(jq '(.roles // []) | length' "$orgConfigFile")
createdAt=$(jq -r '.created_at // "-"' "$orgConfigFile")
gov=$(jq -r '.governance // "-"' "$orgConfigFile")

echo "IMPORT PREVIEW"
echo "────────────────────────────────────────────────────────"
echo "  Archive:    $archive_path"
echo "  Org name:   $importedOrgName"
echo "  Agents:     $agentCount"
echo "  Governance: $gov"
echo "  Created:    $createdAt"
echo ""

# Check if org already exists
targetOrgFile=".monomind/orgs/${importedOrgName}.json"
if [ -f "$targetOrgFile" ]; then
  existingAgents=$(jq '(.roles // []) | length' "$targetOrgFile")
  echo "  WARNING: Org '${importedOrgName}' already exists ($existingAgents agents)."
  echo "  Collision strategy: ${collision:-skip}"
  echo ""
fi

# Preview agent plans
echo "AGENT PLANS"
echo "────────────────────────────────────────────────────────"
jq -r --arg target "$targetOrgFile" '(.roles // [])[] |
  [.id, (.title // "-"), (.adapter.type // "?"), (.adapter.model // "-")] | @tsv' \
  "$orgConfigFile" | while IFS=$'\t' read -r id title adapter model; do
  if [ -f "$targetOrgFile" ]; then
    exists=$(jq -r --arg id "$id" '[(.roles // [])[] | select(.id == $id)] | length' "$targetOrgFile")
    action=$([ "$exists" -gt 0 ] && echo "UPDATE" || echo "CREATE")
  else
    action="CREATE"
  fi
  printf "  %-8s %-24s %-20s %-16s %s\n" "$action" "$id" "$title" "$adapter" "$model"
done

echo ""
echo "  To apply: --action apply --archive-path $archive_path --collision ${collision:-skip}"
```

### apply

Apply the import (write org files):

```bash
tmpDir=$(mktemp -d /tmp/mastermind-import-XXXXXX)
trap 'rm -rf "$tmpDir"' EXIT

if [ "$fmt" = "zip" ]; then
  unzip -q "$archive_path" -d "$tmpDir" 2>/dev/null
elif [ "$fmt" = "tgz" ]; then
  tar -xzf "$archive_path" -C "$tmpDir" 2>/dev/null
elif [ "$fmt" = "json" ]; then
  cp "$archive_path" "$tmpDir/org.json"
fi

orgConfigFile=$(find "$tmpDir" -name "*.json" | grep -vE -- '-approvals|-state|-activity|-goals|-routines|-projects|-members|-issues|-workspaces|-worktrees|-environments|-plugins|-adapters|-bootstrap|-threads|-budgets|-project-workspaces|-approval-comments|-secrets|/manifest\.json' | head -1)
[ -z "$orgConfigFile" ] && orgConfigFile=$(find "$tmpDir" -name "org.json" -o -name "export.json" | head -1)
[ -z "$orgConfigFile" ] && { echo "ERROR: Could not find org config file in archive."; exit 1; }

importedOrgName="${org_name:-$(jq -r '.name // "unnamed"' "$orgConfigFile")}"
targetOrgFile=".monomind/orgs/${importedOrgName}.json"

mkdir -p ".monomind/orgs"

# Handle collision
if [ -f "$targetOrgFile" ]; then
  collisionStrategy="${collision:-skip}"
  case "$collisionStrategy" in
    skip)
      echo "ERROR: Org '${importedOrgName}' already exists. Use --collision merge or --collision overwrite to proceed."
      exit 1
      ;;
    overwrite)
      echo "  Overwriting existing org '${importedOrgName}'..."
      rm -f ".monomind/orgs/${importedOrgName}"*.json ".monomind/orgs/${importedOrgName}"*.jsonl
      ;;
    merge)
      echo "  Merging into existing org '${importedOrgName}'..."
      # Merge will be handled per-file below
      ;;
  esac
fi

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Apply adapter override if specified
if [ -n "$adapter_override" ]; then
  tmp="${orgConfigFile}.ovr"
  jq --arg a "$adapter_override" \
    '.roles = [(.roles // [])[] | .adapter.type = $a]' \
    "$orgConfigFile" > "$tmp" && mv "$tmp" "$orgConfigFile"
  echo "  Applied adapter override: $adapter_override to all agents"
fi

# Copy main config (or merge if merge strategy)
if [ -f "$targetOrgFile" ] && [ "${collision:-skip}" = "merge" ]; then
  tmp="$targetOrgFile.tmp"
  python3 - "$targetOrgFile" "$orgConfigFile" > "$tmp" << 'PYEOF'
import json, sys
existing = json.load(open(sys.argv[1]))
incoming = json.load(open(sys.argv[2]))
existing_ids = {r['id'] for r in existing.get('roles', [])}
new_roles = [r for r in incoming.get('roles', []) if r['id'] not in existing_ids]
existing['roles'] = existing.get('roles', []) + new_roles
print(json.dumps(existing, indent=2))
PYEOF
  mv "$tmp" "$targetOrgFile"
  mergedCount=$(python3 -c "import json; d=json.load(open('$targetOrgFile')); print(len(d.get('roles',[])))")
  echo "  Merged: $mergedCount total agents"
else
  cp "$orgConfigFile" "$targetOrgFile"
fi

# Copy associated files (goals, routines, issues, etc.) from archive
for suffix in members issues goals projects routines approvals adapters plugins environments workspaces worktrees activity threads budgets project-workspaces approval-comments bootstrap; do
  src=$(find "$tmpDir" -name "*-${suffix}.json" | head -1)
  [ -z "$src" ] && src=$(find "$tmpDir" -name "*-${suffix}.jsonl" | head -1)
  if [ -n "$src" ]; then
    ext="${src##*.}"
    dest=".monomind/orgs/${importedOrgName}-${suffix}.${ext}"
    if [ -f "$dest" ] && [ "${collision:-skip}" = "merge" ]; then
      # Merge arrays
      python3 - "$dest" "$src" "$suffix" > "${dest}.tmp" << 'PYEOF'
import json, sys, os
dest_path, src_path, suffix = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    dest_data = json.load(open(dest_path))
    src_data = json.load(open(src_path))
    arr_key = suffix if suffix in dest_data else list(dest_data.keys())[0] if dest_data else suffix
    existing_ids = {item.get('id') for item in dest_data.get(arr_key, []) if 'id' in item}
    new_items = [item for item in src_data.get(arr_key, []) if item.get('id') not in existing_ids]
    dest_data[arr_key] = dest_data.get(arr_key, []) + new_items
    print(json.dumps(dest_data, indent=2))
except Exception as e:
    print(json.dumps(json.load(open(dest_path))), file=__import__('sys').stdout)
PYEOF
      [ $? -eq 0 ] && mv "${dest}.tmp" "$dest" || rm -f "${dest}.tmp"
    else
      cp "$src" "$dest"
    fi
    echo "  Imported: ${importedOrgName}-${suffix}.${ext}"
  fi
done

agentCount=$(jq '(.roles // []) | length' "$targetOrgFile")

echo ""
echo "IMPORT COMPLETE"
echo "────────────────────────────────────────────────────────"
echo "  Org:        $importedOrgName"
echo "  Agents:     $agentCount"
echo "  Location:   $targetOrgFile"
echo "  Collision:  ${collision:-skip}"
echo "  Applied at: $ts"
echo ""
echo "  Run org:    /mastermind:runorg --org $importedOrgName"
echo "  View chart: /mastermind:org-chart --org $importedOrgName"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org_name: <importedOrgName>
agent_count: <N>
collision: <strategy>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
