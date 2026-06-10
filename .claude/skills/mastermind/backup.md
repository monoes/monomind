---
name: mastermind-backup
description: Mastermind backup — create, list, and restore compressed org backups. Archives all org data files (config, goals, routines, approvals, projects, members, issues, workspaces, worktrees, environments, plugins, adapters, threads, budgets, bootstrap, and activity log) into a timestamped tarball.
type: domain-skill
default_mode: confirm
---

# Mastermind Backup

This skill is invoked by `mastermind:backup` or directly via `/mastermind:backup`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to back up or restore (optional for `list`; required for `create`/`restore`)
- `action`: create | list | restore | delete
- `backup_file`: path to backup archive (required for `restore`/`delete`; auto-selected for `restore` if omitted → latest)
- `backup_dir`: directory to store backups (default: `.monomind/backups`)
- `include_state`: whether to include runtime state file (default: false — state is ephemeral)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Ensure Backup Directory

```bash
backupDir="${backup_dir:-.monomind/backups}"
mkdir -p "$backupDir"
```

---

## Step 2 — Execute Action

### create

Create a compressed backup of all org data files:

```bash
[ -z "$org_name" ] && { echo "ERROR: --org required for create."; exit 1; }
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

timestamp=$(date +%Y%m%d-%H%M%S)
archiveName="${org_name}-${timestamp}.tar.gz"
archivePath="${backupDir}/${archiveName}"

# Collect files to back up
filesToBackup=""
for suffix in "" "-goals" "-routines" "-approvals" "-projects" "-members" "-issues" "-workspaces" "-worktrees" "-environments" "-plugins" "-adapters" "-threads" "-budgets" "-project-workspaces" "-approval-comments" "-bootstrap" "-secrets"; do
  f=".monomind/orgs/${org_name}${suffix}.json"
  [ -f "$f" ] && filesToBackup="$filesToBackup $f"
done

# Optionally include runtime state
if [ "${include_state:-false}" = "true" ]; then
  stateFile=".monomind/orgs/${org_name}-state.json"
  [ -f "$stateFile" ] && filesToBackup="$filesToBackup $stateFile"
fi

# Include recent activity (last 500 lines filtered by org)
eventsFile="data/mastermind-events.jsonl"
if [ -f "$eventsFile" ]; then
  tmpEvents=$(mktemp /tmp/backup-events-XXXXXX.jsonl)
  grep "\"org\":\"${org_name}\"" "$eventsFile" | tail -500 > "$tmpEvents" || true
  filesToBackup="$filesToBackup $tmpEvents"
fi

# Create archive
tar -czf "$archivePath" $filesToBackup 2>/dev/null
[ -n "$tmpEvents" ] && rm -f "$tmpEvents"

if [ -f "$archivePath" ]; then
  sizeKb=$(du -k "$archivePath" | awk '{print $1}')
  echo "Backup created: $archivePath (${sizeKb}KB)"
  echo "Files included: $(echo $filesToBackup | wc -w | tr -d ' ')"
else
  echo "ERROR: Failed to create backup archive."
  exit 1
fi
```

Emit `org:backup:created` event:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg org "$org_name" --arg file "$archiveName" \
    '{type:"org:backup:created",org:$org,file:$file,ts:(now*1000|floor)}')" || true
```

### list

Show all available backups:

```bash
echo "BACKUPS — ${backup_dir:-.monomind/backups}"
echo "──────────────────────────────────────────────"
printf "%-45s %-12s %s\n" "FILE" "SIZE" "ORG"
echo "──────────────────────────────────────────────"

found=0
for f in "${backupDir}"/*.tar.gz; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  sizeKb=$(du -k "$f" | awk '{print $1}')
  orgPart=$(echo "$name" | sed 's/-[0-9]\{8\}-[0-9]\{6\}\.tar\.gz$//')
  if [ -z "$org_name" ] || [ "$orgPart" = "$org_name" ]; then
    printf "%-45s %-12s %s\n" "$name" "${sizeKb}KB" "$orgPart"
    found=$((found + 1))
  fi
done

[ "$found" -eq 0 ] && echo "  No backups found."
echo ""
echo "Total: $found backup(s)"
```

### restore

Restore org data from a backup archive:

```bash
# Auto-select latest backup if not specified
if [ -z "$backup_file" ]; then
  if [ -n "$org_name" ]; then
    backup_file=$(ls "${backupDir}/${org_name}-"*.tar.gz 2>/dev/null | sort | tail -1)
  fi
  [ -z "$backup_file" ] && { echo "ERROR: No backup file found. Pass --backup-file <path>."; exit 1; }
fi

[ ! -f "$backup_file" ] && { echo "ERROR: Backup file not found: $backup_file"; exit 1; }

echo "Restoring from: $backup_file"
echo "This will overwrite existing org data. Confirm? (skipped in auto mode)"

# Extract to a temp dir first, then copy
tmpDir=$(mktemp -d /tmp/mastermind-restore-XXXXXX)
tar -xzf "$backup_file" -C "$tmpDir" 2>/dev/null

# Move restored files to correct locations
find "$tmpDir" -name "*.json" | while read -r f; do
  dest=$(echo "$f" | sed "s|$tmpDir||")
  destDir=$(dirname "$dest")
  mkdir -p "$destDir" 2>/dev/null || true
  cp "$f" "$dest" && echo "  Restored: $dest"
done

# Handle events file
find "$tmpDir" -name "*.jsonl" | while read -r f; do
  dest=$(echo "$f" | sed "s|$tmpDir||")
  mkdir -p "$(dirname "$dest")" 2>/dev/null || true
  cat "$f" >> "$dest" && echo "  Appended events from backup"
done

rm -rf "$tmpDir"
echo "Restore complete."
```

### delete

Remove a specific backup archive:

```bash
[ -z "$backup_file" ] && { echo "ERROR: --backup-file required for delete."; exit 1; }
[ ! -f "$backup_file" ] && { echo "ERROR: File not found: $backup_file"; exit 1; }
rm "$backup_file"
echo "Deleted: $backup_file"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
backup_file: <path if created>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
