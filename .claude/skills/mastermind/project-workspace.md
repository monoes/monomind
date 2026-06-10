---
name: mastermind-project-workspace
description: Mastermind project-workspace — configure a project-level workspace (not an execution workspace). Manages source type, visibility, repo URL/ref, branch, cwd, setup/cleanup commands, remote provider, remote workspace ref, runtime config JSON, and shared workspace key. Mirrors ProjectWorkspaceDetail.tsx.
type: domain-skill
default_mode: confirm
---

# Mastermind Project Workspace

This skill is invoked by `mastermind:project-workspace` or directly via `/mastermind:project-workspace`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org the project belongs to (required)
- `project_id`: project id (required)
- `workspace_id`: workspace id within the project (required)
- `action`: show | config | runtime | provision | teardown
- `name`: display name for workspace (for config)
- `source_type`: local_path | non_git_path | git_repo | remote_managed (for config)
- `visibility`: default | advanced (for config)
- `cwd`: absolute local path (for config; required if source_type is local_path/non_git_path)
- `repo_url`: remote repository URL (for config)
- `repo_ref`: git ref/commit (for config)
- `default_ref`: default branch name (for config)
- `setup_command`: command to run after workspace creation (for config)
- `cleanup_command`: command to run before workspace teardown (for config)
- `remote_provider`: remote provider identifier (for config; use with remote_managed)
- `remote_workspace_ref`: remote workspace reference ID (for config; use with remote_managed)
- `shared_workspace_key`: key to share this workspace across agents (for config)
- `runtime_config`: JSON string with workspaceRuntime config overrides (for runtime)
- `caller`: command | master

---

## Source Types

| Type | Label | Required fields |
|------|-------|----------------|
| `local_path` | Local git checkout | `cwd` (absolute path) |
| `non_git_path` | Local non-git path | `cwd` (absolute path) |
| `git_repo` | Remote git repo | `repo_url` |
| `remote_managed` | Remote-managed workspace | `remote_workspace_ref` or `repo_url` |

## Visibility

| Value | Description |
|-------|-------------|
| `default` | Shown to all agents in the project |
| `advanced` | Hidden by default; shown only when explicitly selected |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Workspace

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

projectsFile=".monomind/orgs/${org_name}-projects.json"
[ ! -f "$projectsFile" ] && { echo "ERROR: No projects file for org '${org_name}'."; exit 1; }

# Find project
projDef=$(jq -r --arg pid "$project_id" '(.projects // [])[] | select(.id == $pid or .name == $pid)' "$projectsFile")
[ -z "$projDef" ] && { echo "ERROR: Project '$project_id' not found."; exit 1; }

# Load project workspaces file
pwsFile=".monomind/orgs/${org_name}-project-workspaces.json"
[ ! -f "$pwsFile" ] && echo '{"workspaces":[]}' > "$pwsFile"

wsDef=$(jq -r --arg wid "$workspace_id" --arg pid "$project_id" \
  '(.workspaces // [])[] | select(.id == $wid and (.project_id == $pid or .projectId == $pid))' \
  "$pwsFile")
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "PROJECT WORKSPACE — $workspace_id @ $project_id ($org_name)"
echo "────────────────────────────────────────────────────────"

if [ -z "$wsDef" ]; then
  echo "  Workspace '$workspace_id' not found in project '$project_id'."
  echo "  List workspaces: /mastermind:workspaces --org $org_name"
  exit 0
fi

echo "$wsDef" | jq -r '
  "  ID:                \(.id)",
  "  Name:              \(.name // "(unnamed)")",
  "  Source type:       \(.sourceType // .source_type // "local_path")",
  "  Visibility:        \(.visibility // "default")",
  "  CWD:               \(.cwd // "(none)")",
  "  Repo URL:          \(.repoUrl // .repo_url // "(none)")",
  "  Repo ref:          \(.repoRef // .repo_ref // "(default)")",
  "  Default ref:       \(.defaultRef // .default_ref // "(default branch)")",
  "  Setup command:     \(.setupCommand // .setup_command // "(none)")",
  "  Cleanup command:   \(.cleanupCommand // .cleanup_command // "(none)")",
  "  Remote provider:   \(.remoteProvider // .remote_provider // "(none)")",
  "  Remote ws ref:     \(.remoteWorkspaceRef // .remote_workspace_ref // "(none)")",
  "  Shared key:        \(.sharedWorkspaceKey // .shared_workspace_key // "(none)")"
'

rtConfig=$(echo "$wsDef" | jq -r '.runtimeConfig.workspaceRuntime // null')
echo ""
echo "RUNTIME CONFIG: $([ "$rtConfig" = "null" ] && echo '(none)' || echo "$rtConfig" | jq -c .)"
```

### config

```bash
if [ -z "$wsDef" ]; then
  echo "ERROR: Workspace '$workspace_id' not found."
  exit 1
fi

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${pwsFile}.tmp"
jq \
  --arg wid "$workspace_id" \
  --arg pid "$project_id" \
  --arg name "${name:-}" \
  --arg st "${source_type:-}" \
  --arg vis "${visibility:-}" \
  --arg cwd_ "${cwd:-}" \
  --arg repoUrl "${repo_url:-}" \
  --arg repoRef "${repo_ref:-}" \
  --arg defaultRef "${default_ref:-}" \
  --arg setupCmd "${setup_command:-}" \
  --arg cleanupCmd "${cleanup_command:-}" \
  --arg remoteProvider "${remote_provider:-}" \
  --arg remoteRef "${remote_workspace_ref:-}" \
  --arg sharedKey "${shared_workspace_key:-}" \
  --arg ts "$ts" \
  '.workspaces = [(.workspaces // [])[] | if (.id == $wid and (.project_id == $pid or .projectId == $pid)) then
    (if $name != "" then .name = $name else . end) |
    (if $st != "" then .sourceType = $st else . end) |
    (if $vis != "" then .visibility = $vis else . end) |
    (if $cwd_ != "" then .cwd = $cwd_ else . end) |
    (if $repoUrl != "" then .repoUrl = $repoUrl else . end) |
    (if $repoRef != "" then .repoRef = $repoRef else . end) |
    (if $defaultRef != "" then .defaultRef = $defaultRef else . end) |
    (if $setupCmd != "" then .setupCommand = $setupCmd else . end) |
    (if $cleanupCmd != "" then .cleanupCommand = $cleanupCmd else . end) |
    (if $remoteProvider != "" then .remoteProvider = $remoteProvider else . end) |
    (if $remoteRef != "" then .remoteWorkspaceRef = $remoteRef else . end) |
    (if $sharedKey != "" then .sharedWorkspaceKey = $sharedKey else . end) |
    .updatedAt = $ts
  else . end]' \
  "$pwsFile" > "$tmp" && mv "$tmp" "$pwsFile"

echo "Project workspace '$workspace_id' config updated."
```

### runtime

```bash
[ -z "$runtime_config" ] && { echo "ERROR: --runtime-config (JSON string) required."; exit 1; }

# Validate JSON
parsed=$(echo "$runtime_config" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d))" 2>&1) || {
  echo "ERROR: --runtime-config must be valid JSON: $parsed"
  exit 1
}

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${pwsFile}.tmp"
jq --arg wid "$workspace_id" --arg pid "$project_id" --argjson rt "$parsed" --arg ts "$ts" \
  '.workspaces = [(.workspaces // [])[] | if (.id == $wid and (.project_id == $pid or .projectId == $pid)) then
    .runtimeConfig = {"workspaceRuntime": $rt} | .updatedAt = $ts
  else . end]' \
  "$pwsFile" > "$tmp" && mv "$tmp" "$pwsFile"

echo "Runtime config updated for workspace '$workspace_id'."
echo "  Keys: $(echo "$parsed" | python3 -c "import json,sys; d=json.load(sys.stdin); print(', '.join(d.keys()))")"
```

### provision

```bash
setupCmd=$(echo "$wsDef" | jq -r '.setupCommand // .setup_command // ""')
wsPath=$(echo "$wsDef" | jq -r '.cwd // ""')

echo "PROVISION — $workspace_id"
echo "────────────────────────────────────────────────────────"
if [ -z "$setupCmd" ]; then
  echo "  No setup command configured."
  echo "  Set one: --action config --setup-command 'npm install'"
else
  echo "  Command: $setupCmd"
  echo "  CWD:     ${wsPath:-(none)}"
  if [ -d "$wsPath" ] && [ -n "$setupCmd" ]; then
    echo "  Executing…"
    (cd "$wsPath" && eval "$setupCmd") && echo "  Provision complete." || echo "  Provision command exited with error."
  fi
fi
```

### teardown

```bash
cleanupCmd=$(echo "$wsDef" | jq -r '.cleanupCommand // .cleanup_command // ""')
wsPath=$(echo "$wsDef" | jq -r '.cwd // ""')

echo "TEARDOWN — $workspace_id"
echo "────────────────────────────────────────────────────────"
if [ -z "$cleanupCmd" ]; then
  echo "  No cleanup command configured."
else
  echo "  Command: $cleanupCmd"
  [ -d "$wsPath" ] && (cd "$wsPath" && eval "$cleanupCmd") && echo "  Teardown complete." || echo "  No path or teardown error."
fi
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
project_id: <project_id>
workspace_id: <workspace_id>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
