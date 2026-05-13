---
name: mastermind-workspace-detail
description: Mastermind workspace-detail — deep per-execution-workspace inspection and runtime control. Manage services, provision/teardown/cleanup commands, linked issues and routines, runtime logs, and configuration for a single execution workspace.
type: domain-skill
default_mode: confirm
---

# Mastermind Workspace Detail

This skill is invoked by `mastermind:workspace-detail` or directly via `/mastermind:workspace-detail`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org the workspace belongs to (required)
- `workspace_id`: execution workspace id (required)
- `action`: show | services | provision | teardown | cleanup | runtime-logs | issues | routines | config
- `provision_command`: shell command to provision the workspace (for config action)
- `teardown_command`: shell command to tear down the workspace (for config action)
- `cleanup_command`: shell command for workspace cleanup (for config action)
- `cwd`: working directory override (for config action)
- `repo_url`: repository URL (for config action)
- `base_ref`: git base ref/branch (for config action)
- `branch_name`: branch name for the workspace (for config action)
- `log_lines`: number of runtime log lines to show (default 50)
- `caller`: command | master

---

## Workspace Tabs (mirrors ExecutionWorkspaceDetail.tsx)

| Tab | Description |
|-----|-------------|
| `services` | Running service processes in this workspace |
| `configuration` | Provision/teardown/cleanup commands, repo, branch, cwd |
| `runtime_logs` | Live or recent runtime logs from workspace processes |
| `issues` | Issues currently assigned to or running in this workspace |
| `routines` | Routines with workspace-specific variable bindings |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Workspace Data

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

wsFile=".monomind/orgs/${org_name}-workspaces.json"
[ ! -f "$wsFile" ] && { echo "ERROR: No workspaces file for org '$org_name'. Create workspaces via /mastermind:workspaces."; exit 1; }

wsDef=$(jq -r --arg id "$workspace_id" '.workspaces[] | select(.id == $id)' "$wsFile")
[ -z "$wsDef" ] && { echo "ERROR: Workspace '$workspace_id' not found in org '$org_name'."; exit 1; }

issuesFile=".monomind/orgs/${org_name}-issues.json"
routinesFile=".monomind/orgs/${org_name}-routines.json"
logFile=".monomind/orgs/${org_name}-workspace-logs/${workspace_id}.log"
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "EXECUTION WORKSPACE — $workspace_id @ $org_name"
echo "────────────────────────────────────────────────────────"

echo "$wsDef" | jq -r '
  "  ID:              \(.id)",
  "  Project:         \(.project_id // "(none)")",
  "  Agent:           \(.agent_id // "(unassigned)")",
  "  Status:          \(.status // "unknown")",
  "  Branch:          \(.branch // "?")",
  "  Base ref:        \(.base_ref // "?")",
  "  Repo URL:        \(.repo_url // "(local)")",
  "  CWD:             \(.cwd // .worktree_path // "(none)")",
  "  Created:         \(.createdAt // "-")",
  "  Last active:     \(.lastActiveAt // "-")"
'

# Services
svcCount=$(echo "$wsDef" | jq -r '(.services // []) | length')
echo ""
echo "  Services running:  $svcCount"
echo "$wsDef" | jq -r '(.services // [])[] | "    · \(.)"'

# Config summary
hasProvision=$(echo "$wsDef" | jq -r 'if .config.provisionCommand then "yes" else "no" end')
hasTeardown=$(echo "$wsDef" | jq -r 'if .config.teardownCommand then "yes" else "no" end')
echo ""
echo "  Provision cmd:     $hasProvision"
echo "  Teardown cmd:      $hasTeardown"
```

### services

```bash
echo "SERVICES — $workspace_id"
echo "────────────────────────────────────────────────────────"

services=$(echo "$wsDef" | jq -r '(.services // [])[]')
if [ -z "$services" ]; then
  echo "  No services running."
else
  echo "$wsDef" | jq -r '.services // [] | to_entries[] |
    "  [\(.key)] \(.value)"' 2>/dev/null || \
  echo "$wsDef" | jq -r '(.services // [])[] | "  · \(.)"'
fi

echo ""
echo "  Workspace path: $(echo "$wsDef" | jq -r '.worktree_path // "(none)"')"
echo "  Status:         $(echo "$wsDef" | jq -r '.status // "unknown"')"
```

### provision

```bash
echo "PROVISION — $workspace_id"
echo "────────────────────────────────────────────────────────"

provCmd=$(echo "$wsDef" | jq -r '.config.provisionCommand // ""')
wsPath=$(echo "$wsDef" | jq -r '.worktree_path // .cwd // ""')

if [ -z "$provCmd" ]; then
  echo "  No provision command configured."
  echo "  Set one: --action config --provision-command 'npm install && npm run build'"
else
  echo "  Command: $provCmd"
  echo "  CWD:     $wsPath"
  echo ""
  echo "  To run: cd '$wsPath' && $provCmd"
  echo ""
  if [ -d "$wsPath" ] && [ -n "$provCmd" ]; then
    echo "  Executing provision command…"
    (cd "$wsPath" && eval "$provCmd") && {
      ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      tmp="${wsFile}.tmp"
      jq --arg id "$workspace_id" --arg ts "$ts" \
        '.workspaces = [.workspaces[] | if .id == $id then .last_provisioned = $ts else . end]' \
        "$wsFile" > "$tmp" && mv "$tmp" "$wsFile"
      echo "  Provision complete."
    } || echo "  Provision command exited with error."
  else
    [ -z "$wsPath" ] && echo "  ERROR: No worktree_path set — cannot execute provision command automatically."
  fi
fi
```

### teardown

```bash
echo "TEARDOWN — $workspace_id"
echo "────────────────────────────────────────────────────────"

tdCmd=$(echo "$wsDef" | jq -r '.config.teardownCommand // ""')
wsPath=$(echo "$wsDef" | jq -r '.worktree_path // .cwd // ""')

if [ -z "$tdCmd" ]; then
  echo "  No teardown command configured."
else
  echo "  Command: $tdCmd"
  echo "  CWD:     $wsPath"
  if [ -d "$wsPath" ]; then
    echo "  Executing teardown command…"
    (cd "$wsPath" && eval "$tdCmd") && echo "  Teardown complete." || echo "  Teardown command exited with error."
  fi
fi
```

### cleanup

```bash
echo "CLEANUP — $workspace_id"
echo "────────────────────────────────────────────────────────"

cleanCmd=$(echo "$wsDef" | jq -r '.config.cleanupCommand // ""')
wsPath=$(echo "$wsDef" | jq -r '.worktree_path // .cwd // ""')

if [ -z "$cleanCmd" ]; then
  echo "  No cleanup command configured."
else
  echo "  Command: $cleanCmd"
  if [ -d "$wsPath" ]; then
    (cd "$wsPath" && eval "$cleanCmd") && echo "  Cleanup complete." || echo "  Cleanup exited with error."
  fi
fi
```

### runtime-logs

```bash
lines=${log_lines:-50}
echo "RUNTIME LOGS — $workspace_id (last $lines lines)"
echo "────────────────────────────────────────────────────────"

if [ -f "$logFile" ]; then
  tail -${lines} "$logFile"
else
  # Try workspace path stderr/stdout logs
  wsPath=$(echo "$wsDef" | jq -r '.worktree_path // ""')
  found=false
  for logPath in "${wsPath}/.monomind/runtime.log" "${wsPath}/logs/runtime.log" "${wsPath}/output.log"; do
    if [ -f "$logPath" ]; then
      tail -${lines} "$logPath"
      found=true
      break
    fi
  done
  "$found" || echo "  No runtime logs found. Logs are written to .monomind/workspace-logs/$workspace_id.log during runs."
fi
```

### issues

```bash
echo "ISSUES — workspace: $workspace_id"
echo "────────────────────────────────────────────────────────"
printf "%-24s %-12s %-10s %s\n" "ID" "STATUS" "PRIORITY" "TITLE"
echo "────────────────────────────────────────────────────────"

if [ ! -f "$issuesFile" ]; then
  echo "  No issues file found."
else
  jq -r --arg wid "$workspace_id" '.issues[] |
    select(.workspace_id == $wid or (.assigned_workspace == $wid)) |
    [.id, (.status // "open"), (.priority // "medium"), (.title // "(no title)")] | @tsv' \
    "$issuesFile" | while IFS=$'\t' read -r id st pri title; do
    printf "%-24s %-12s %-10s %s\n" "$id" "$st" "$pri" "$title"
  done || echo "  No issues assigned to this workspace."
fi
```

### routines

```bash
echo "ROUTINES — workspace: $workspace_id"
echo "────────────────────────────────────────────────────────"

if [ ! -f "$routinesFile" ]; then
  echo "  No routines file found."
else
  # Show routines that have workspace-specific variable bindings
  jq -r --arg wid "$workspace_id" \
    '.routines[] | select((.variables // {}) | to_entries[] | .key | startswith("WS_") or contains("workspace")) |
    "\(.id)  \(.name // "(no name)")  vars: \((.variables // {}) | keys | join(", "))"' \
    "$routinesFile" 2>/dev/null || echo "  No routines with workspace-specific variables."
fi

echo ""
echo "To run a routine with workspace vars: /mastermind:routine-detail --org $org_name --routine-id <id> --action variables"
```

### config

```bash
echo "WORKSPACE CONFIG — $workspace_id"
echo "────────────────────────────────────────────────────────"

if [ -n "$provision_command" ] || [ -n "$teardown_command" ] || [ -n "$cleanup_command" ] || \
   [ -n "$cwd" ] || [ -n "$repo_url" ] || [ -n "$base_ref" ] || [ -n "$branch_name" ]; then

  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  tmp="${wsFile}.tmp"
  jq --arg id "$workspace_id" \
     --arg prov "${provision_command:-}" \
     --arg td "${teardown_command:-}" \
     --arg clean "${cleanup_command:-}" \
     --arg cwd_ "${cwd:-}" \
     --arg repo "${repo_url:-}" \
     --arg base "${base_ref:-}" \
     --arg branch "${branch_name:-}" \
     --arg ts "$ts" \
    '.workspaces = [.workspaces[] | if .id == $id then
       if .config == null then .config = {} else . end |
       (if $prov != "" then .config.provisionCommand = $prov else . end) |
       (if $td != "" then .config.teardownCommand = $td else . end) |
       (if $clean != "" then .config.cleanupCommand = $clean else . end) |
       (if $cwd_ != "" then .cwd = $cwd_ else . end) |
       (if $repo != "" then .repo_url = $repo else . end) |
       (if $base != "" then .base_ref = $base else . end) |
       (if $branch != "" then .branch = $branch else . end) |
       .lastActiveAt = $ts
     else . end]' \
    "$wsFile" > "$tmp" && mv "$tmp" "$wsFile"
  echo "Config updated for workspace '$workspace_id'."
else
  echo "$wsDef" | jq '{id, project_id, agent_id, status, branch, base_ref, repo_url, cwd, config}'
fi
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
workspace_id: <workspace_id>
workspace_status: <status>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
