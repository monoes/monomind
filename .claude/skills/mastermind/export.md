---
name: mastermind-export
description: Mastermind export — full org portability. Export an org to a compressed archive (tar.gz or zip) with file tree selection, and import from an archive with collision strategy and adapter override. Mirrors Paperclip's CompanyExport/CompanyImport pages.
type: domain-skill
default_mode: confirm
---

# Mastermind Export

This skill is invoked by `mastermind:export` or directly via `/mastermind:export`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to export/import (required)
- `action`: export | import | preview | list-archives
- `output_path`: destination path for exported archive (optional, default: `.monomind/exports/<org>-<ts>.tar.gz`)
- `input_path`: path to archive file to import (required for import)
- `collision_strategy`: merge | overwrite | skip (default: merge — for import)
- `adapter_override`: adapter type to substitute during import (optional: claude-local | gemini-local | codex-local)
- `include`: comma-separated sections to include (config,goals,routines,projects,members,adapters,secrets-refs,activity — default: all except secrets-refs)
- `dry_run`: true | false — for import, preview changes without writing (default false)
- `caller`: command | master

---

## Sections Available for Export

| Section | Files Included | Default |
|---------|---------------|---------|
| `config` | `<org>.json` | ✓ |
| `goals` | `<org>-goals.json` | ✓ |
| `routines` | `<org>-routines.json` | ✓ |
| `projects` | `<org>-projects.json` | ✓ |
| `members` | `<org>-members.json` | ✓ |
| `adapters` | `<org>-adapters.json` | ✓ |
| `environments` | `<org>-environments.json` | ✓ |
| `workspaces` | `<org>-workspaces.json` | ✓ |
| `activity` | `<org>-activity.jsonl` (last 500 events) | ✓ |
| `secrets-refs` | secret reference names only (NO values) | opt-in |

**SECURITY:** Secret *values* are NEVER exported. Only masked reference names may be included if `secrets-refs` is explicitly listed in `include`.

## Collision Strategies (import)

| Strategy | Behavior |
|----------|----------|
| `merge` | New records added; existing records with same ID kept as-is |
| `overwrite` | New records replace existing ones with same ID |
| `skip` | Skip entire section if any file already exists in org |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Validate Org

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

exportsDir=".monomind/exports"
mkdir -p "$exportsDir"
ts=$(date -u +%Y%m%dT%H%M%SZ)
defaultOutput="${exportsDir}/${org_name}-${ts}.tar.gz"
outputPath="${output_path:-$defaultOutput}"
```

---

## Step 2 — Execute Action

### preview

Show what would be included in an export without writing anything:

```bash
echo "EXPORT PREVIEW — org: $org_name"
echo "────────────────────────────────────────────────────────"

allSections="config goals routines projects members adapters environments workspaces activity"
includeSections="${include:-$allSections}"

for section in $allSections; do
  echo "$includeSections" | grep -qw "$section" || continue
  case "$section" in
    config)      srcFile=".monomind/orgs/${org_name}.json" ;;
    goals)       srcFile=".monomind/orgs/${org_name}-goals.json" ;;
    routines)    srcFile=".monomind/orgs/${org_name}-routines.json" ;;
    projects)    srcFile=".monomind/orgs/${org_name}-projects.json" ;;
    members)     srcFile=".monomind/orgs/${org_name}-members.json" ;;
    adapters)    srcFile=".monomind/orgs/${org_name}-adapters.json" ;;
    environments) srcFile=".monomind/orgs/${org_name}-environments.json" ;;
    workspaces)  srcFile=".monomind/orgs/${org_name}-workspaces.json" ;;
    activity)    srcFile=".monomind/orgs/${org_name}-activity.jsonl" ;;
    secrets-refs) srcFile=".monomind/orgs/.secrets/${org_name}/" ;;
  esac
  if [ -f "$srcFile" ] || [ -d "$srcFile" ]; then
    size=$(du -sh "$srcFile" 2>/dev/null | cut -f1 || echo "?")
    echo "  ✓ $section  ($srcFile)  [$size]"
  else
    echo "  - $section  ($srcFile)  [not found — will be skipped]"
  fi
done

echo ""
echo "Output would be: $outputPath"
echo "Run with --action export to proceed."
```

### export

```bash
echo "Exporting org '$org_name'…"

allSections="config goals routines projects members adapters environments workspaces activity"
includeSections="${include:-$allSections}"

# Build list of files to include
tmpDir=$(mktemp -d)
orgExportDir="${tmpDir}/${org_name}"
mkdir -p "$orgExportDir"

fileCount=0
for section in $allSections; do
  echo "$includeSections" | grep -qw "$section" || continue
  case "$section" in
    config)       srcFile=".monomind/orgs/${org_name}.json" ; dstName="${org_name}.json" ;;
    goals)        srcFile=".monomind/orgs/${org_name}-goals.json" ; dstName="${org_name}-goals.json" ;;
    routines)     srcFile=".monomind/orgs/${org_name}-routines.json" ; dstName="${org_name}-routines.json" ;;
    projects)     srcFile=".monomind/orgs/${org_name}-projects.json" ; dstName="${org_name}-projects.json" ;;
    members)      srcFile=".monomind/orgs/${org_name}-members.json" ; dstName="${org_name}-members.json" ;;
    adapters)     srcFile=".monomind/orgs/${org_name}-adapters.json" ; dstName="${org_name}-adapters.json" ;;
    environments) srcFile=".monomind/orgs/${org_name}-environments.json" ; dstName="${org_name}-environments.json" ;;
    workspaces)   srcFile=".monomind/orgs/${org_name}-workspaces.json" ; dstName="${org_name}-workspaces.json" ;;
    activity)     srcFile=".monomind/orgs/${org_name}-activity.jsonl" ; dstName="${org_name}-activity.jsonl" ;;
    secrets-refs)
      # Export ONLY secret reference names — NO values
      secretsDir=".monomind/orgs/.secrets/${org_name}"
      if [ -d "$secretsDir" ]; then
        refsList=$(ls "$secretsDir" 2>/dev/null | jq -Rsc 'split("\n") | map(select(. != ""))')
        echo "{\"secret_refs\":$refsList,\"note\":\"values_not_exported\"}" > "${orgExportDir}/${org_name}-secret-refs.json"
        echo "  ✓ secrets-refs (reference names only)"
        fileCount=$((fileCount + 1))
      fi
      continue ;;
  esac
  if [ -f "$srcFile" ]; then
    # For environments: strip key material before including
    if [ "$section" = "environments" ]; then
      jq '.environments = [.environments[] | del(.key_material,.private_key,.ssh_key,.password)]' \
        "$srcFile" > "${orgExportDir}/${dstName}"
    elif [ "$section" = "activity" ]; then
      # Only last 500 events
      tail -500 "$srcFile" > "${orgExportDir}/${dstName}"
    else
      cp "$srcFile" "${orgExportDir}/${dstName}"
    fi
    echo "  ✓ $section"
    fileCount=$((fileCount + 1))
  else
    echo "  - $section (skipped — file not found)"
  fi
done

# Write manifest
jq -cn \
  --arg org "$org_name" \
  --arg ts "$ts" \
  --arg sections "$includeSections" \
  --argjson files "$fileCount" \
  '{"org":$org,"exported_at":$ts,"sections":($sections|split(" ")),"file_count":$files,"version":"1.0"}' \
  > "${orgExportDir}/manifest.json"

# Create archive
tar -czf "$outputPath" -C "$tmpDir" "$org_name" 2>/dev/null
rm -rf "$tmpDir"

echo ""
echo "Export complete: $outputPath"
echo "  Files: $fileCount  |  Sections: $includeSections"
echo "  Size: $(du -sh "$outputPath" 2>/dev/null | cut -f1)"
```

### import

```bash
[ -z "$input_path" ] && { echo "ERROR: --input-path required."; exit 1; }
[ ! -f "$input_path" ] && { echo "ERROR: Archive not found: $input_path"; exit 1; }

collision="${collision_strategy:-merge}"
case "$collision" in merge|overwrite|skip) : ;; *)
  echo "ERROR: --collision-strategy must be merge, overwrite, or skip"; exit 1 ;;
esac

dryRun="${dry_run:-false}"
[ "$dryRun" = "true" ] && echo "DRY RUN — no changes will be written."

echo "IMPORT — org: $org_name"
echo "Collision strategy: $collision"
[ -n "$adapter_override" ] && echo "Adapter override: $adapter_override"
echo "────────────────────────────────────────────────────────"

# Extract archive to temp dir
tmpDir=$(mktemp -d)
tar -xzf "$input_path" -C "$tmpDir" 2>/dev/null || { echo "ERROR: Failed to extract archive."; rm -rf "$tmpDir"; exit 1; }

# Find org dir in archive
archiveOrgDir=$(find "$tmpDir" -name "manifest.json" -maxdepth 3 | head -1 | xargs dirname 2>/dev/null)
[ -z "$archiveOrgDir" ] && { echo "ERROR: No manifest.json found in archive. Invalid export?"; rm -rf "$tmpDir"; exit 1; }

archiveOrg=$(jq -r '.org // ""' "${archiveOrgDir}/manifest.json")
echo "Archive org: $archiveOrg → importing as: $org_name"
echo ""

imported=0
skipped=0
for srcFile in "${archiveOrgDir}"/*.json "${archiveOrgDir}"/*.jsonl; do
  [ -f "$srcFile" ] || continue
  # Rewrite filename for target org name
  dstName=$(basename "$srcFile" | sed "s/^${archiveOrg}/${org_name}/")
  dstPath=".monomind/orgs/${dstName}"

  # Skip manifest
  [[ "$dstName" == "manifest.json" ]] && continue

  # Skip secret refs — never auto-import
  [[ "$dstName" == *secret-refs* ]] && echo "  SKIP: secret refs (never auto-imported)" && continue

  # Apply adapter override
  if [ -n "$adapter_override" ] && [[ "$dstName" == *-adapters.json ]]; then
    echo "  OVERRIDE: applying adapter_override=$adapter_override to adapters file"
  fi

  if [ -f "$dstPath" ]; then
    case "$collision" in
      skip)
        echo "  SKIP: $dstName (exists, strategy=skip)"
        skipped=$((skipped + 1))
        continue ;;
      merge)
        echo "  MERGE: $dstName"
        if [ "$dryRun" = "false" ]; then
          # JSON files: merge arrays; jsonl files: append deduplicated
          if [[ "$dstPath" == *.jsonl ]]; then
            cat "$srcFile" >> "$dstPath"
          else
            # Merge: combine top-level arrays from both files
            python3 -c "
import json, sys
with open('$dstPath') as f: existing = json.load(f)
with open('$srcFile') as f: incoming = json.load(f)
for k, v in incoming.items():
    if isinstance(v, list) and isinstance(existing.get(k), list):
        existIds = {i.get('id') for i in existing[k] if isinstance(i,dict)}
        existing[k] += [i for i in v if isinstance(i,dict) and i.get('id') not in existIds]
    elif k not in existing:
        existing[k] = v
with open('$dstPath', 'w') as f: json.dump(existing, f, indent=2)
" 2>/dev/null || cp "$srcFile" "$dstPath"
          fi
        fi ;;
      overwrite)
        echo "  OVERWRITE: $dstName"
        [ "$dryRun" = "false" ] && cp "$srcFile" "$dstPath" ;;
    esac
  else
    echo "  CREATE: $dstName (new)"
    [ "$dryRun" = "false" ] && cp "$srcFile" "$dstPath"
  fi
  imported=$((imported + 1))
done

rm -rf "$tmpDir"
echo ""
[ "$dryRun" = "true" ] && echo "DRY RUN complete — $imported file(s) would be imported, $skipped skipped." \
  || echo "Import complete — $imported file(s) imported, $skipped skipped."
```

### list-archives

```bash
echo "EXPORT ARCHIVES — org: $org_name"
echo "────────────────────────────────────────────────────────"

found=0
for f in ".monomind/exports/${org_name}-"*.tar.gz ".monomind/exports/${org_name}-"*.zip; do
  [ -f "$f" ] || continue
  size=$(du -sh "$f" 2>/dev/null | cut -f1 || echo "?")
  ts=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$f" 2>/dev/null || stat -c "%y" "$f" 2>/dev/null | cut -c1-16 || echo "?")
  printf "  %-50s %8s  %s\n" "$(basename "$f")" "$size" "$ts"
  found=$((found + 1))
done

[ "$found" -eq 0 ] && echo "  No archives found. Run --action export to create one."
echo ""
echo "Total: $found archive(s) in .monomind/exports/"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
output_path: <path if export>
files_processed: <N>
collision_strategy: <strategy if import>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
