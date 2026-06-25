---
name: mastermind-workspaces
description: Mastermind workspaces — manage isolated git worktree workspaces per project. List, attach, detach, stop, and prune workspaces. Grouped by project with running service counts and agent assignments.
type: domain-skill
default_mode: confirm
---

# Mastermind Workspaces

This skill is invoked by `mastermind:workspaces` or directly via `/mastermind:workspaces`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to manage workspaces for (required)
- `action`: list | status | attach | detach | stop | prune
- `workspace_id`: workspace id (required for status/detach/stop)
- `project_id`: project to filter by (optional for list)
- `agent_id`: agent to assign to workspace (required for attach)
- `worktree_path`: filesystem path of the worktree (required for attach)
- `caller`: command | master

---

## Workspace Model

A workspace is a git worktree assigned to a project, optionally running services and assigned to an agent.

```json
{
  "id": "ws-abc123",
  "project_id": "project-slug",
  "agent_id": "backend-dev",
  "worktree_path": "/tmp/monomind/worktrees/project-slug-abc123",
  "branch": "feat/my-feature",
  "status": "active",
  "services": ["dev-server", "db-watcher"],
  "createdAt": "2026-01-01T00:00:00Z",
  "lastActiveAt": "2026-01-02T00:00:00Z"
}
```

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Workspace Data

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

wsFile=".monomind/orgs/${org_name}-workspaces.json"
[ ! -f "$wsFile" ] && echo '{"workspaces":[]}' > "$wsFile"

projectsFile=".monomind/orgs/${org_name}-projects.json"
worktreeRegistry=".monomind/orgs/${org_name}-worktrees.json"
```

---

## Step 2 — Execute Action

### list (default)

```bash
echo "WORKSPACES — org: $org_name"
[ -n "$project_id" ] && echo "(filtered by project: $project_id)"
echo "────────────────────────────────────────────────────────"

total=$(jq '.workspaces | length' "$wsFile")

if [ "$total" -eq 0 ]; then
  echo "  No workspaces. Use --action attach to register one."
else
  # Group by project
  projects=$(jq -r --arg pid "${project_id:-}" '
    .workspaces |
    if $pid != "" then map(select(.project_id == $pid)) else . end |
    [.[].project_id] | unique[]
  ' "$wsFile")

  while IFS= read -r proj; do
    [ -z "$proj" ] && continue
    projName=$([ -f "$projectsFile" ] && jq -r --arg pid "$proj" '(.projects // [])[] | select(.id == $pid) | .name // $pid' "$projectsFile" || echo "$proj")
    echo ""
    echo "  PROJECT: $projName"
    echo "  ──────────────────────────────────────────────────"
    printf "  %-18s %-14s %-18s %-12s %-6s %s\n" "ID" "STATUS" "AGENT" "BRANCH" "SVCS" "PATH"

    jq -r --arg pid "$proj" '(.workspaces // [])[] | select(.project_id == $pid) |
      [.id, (.status // "unknown"), (.agent_id // "(none)"),
       (.branch // "?"), ((.services // []) | length | tostring),
       (.worktree_path // "-")]
      | @tsv' "$wsFile" | while IFS=$'\t' read -r id st ag br svc path; do
      printf "  %-18s %-14s %-18s %-12s %-6s %s\n" "$id" "$st" "$ag" "$br" "$svc" "$path"
    done
  done <<< "$projects"
fi

echo ""
echo "Total: $total workspace(s)"
```

### status

```bash
[ -z "$workspace_id" ] && { echo "ERROR: --workspace-id required."; exit 1; }
wsDef=$(jq -r --arg id "$workspace_id" '(.workspaces // [])[] | select(.id == $id)' "$wsFile")
[ -z "$wsDef" ] && { echo "ERROR: Workspace '$workspace_id' not found."; exit 1; }

echo "WORKSPACE STATUS — $workspace_id"
echo "────────────────────────────────────────────────────────"
echo "$wsDef" | jq -r '
  "  ID:           \(.id)",
  "  Project:      \(.project_id // "-")",
  "  Agent:        \(.agent_id // "(unassigned)")",
  "  Branch:       \(.branch // "?")",
  "  Status:       \(.status // "unknown")",
  "  Created:      \(.createdAt // "-")",
  "  Last active:  \(.lastActiveAt // "-")",
  "  Path:         \(.worktree_path // "-")"
'

# Check if worktree path exists
path=$(echo "$wsDef" | jq -r '.worktree_path // ""')
if [ -n "$path" ]; then
  if [ -d "$path" ]; then
    echo ""
    echo "  Worktree: EXISTS at $path"
    branch=$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
    echo "  Git branch: $branch"
    dirty=$(git -C "$path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    [ "$dirty" -gt 0 ] && echo "  Uncommitted changes: $dirty file(s)"
  else
    echo "  WARNING: Worktree path does not exist: $path"
  fi
fi

echo ""
echo "Services:"
echo "$wsDef" | jq -r '(.services // [])[] | "  · \(.)"' || echo "  (none)"
```

### attach

```bash
[ -z "$project_id" ] && { echo "ERROR: --project-id required."; exit 1; }
[ -z "$worktree_path" ] && { echo "ERROR: --worktree-path required."; exit 1; }

[ ! -d "$worktree_path" ] && { echo "ERROR: Path does not exist: $worktree_path"; exit 1; }

wsId="ws-$(openssl rand -hex 4 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(4))')"
branch=$(git -C "$worktree_path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

tmp="${wsFile}.tmp"
jq --arg id "$wsId" \
   --arg pid "$project_id" \
   --arg ag "${agent_id:-}" \
   --arg path "$worktree_path" \
   --arg branch "$branch" \
   --arg ts "$ts" \
  '.workspaces += [{"id":$id,"project_id":$pid,
    "agent_id":(if $ag != "" then $ag else null end),
    "worktree_path":$path,"branch":$branch,
    "status":"active","services":[],"createdAt":$ts,"lastActiveAt":$ts}]' \
  "$wsFile" > "$tmp" && mv "$tmp" "$wsFile"

echo "Workspace attached: $wsId"
echo "  Project:  $project_id"
echo "  Agent:    ${agent_id:-(unassigned)}"
echo "  Branch:   $branch"
echo "  Path:     $worktree_path"
```

### detach

```bash
[ -z "$workspace_id" ] && { echo "ERROR: --workspace-id required."; exit 1; }
tmp="${wsFile}.tmp"
jq --arg id "$workspace_id" \
  '.workspaces = [(.workspaces // [])[] | if .id == $id then .status = "detached" else . end]' \
  "$wsFile" > "$tmp" && mv "$tmp" "$wsFile"
echo "Workspace '$workspace_id' → detached. The worktree is preserved on disk."
```

### stop

```bash
[ -z "$workspace_id" ] && { echo "ERROR: --workspace-id required."; exit 1; }
wsDef=$(jq -r --arg id "$workspace_id" '(.workspaces // [])[] | select(.id == $id)' "$wsFile")
[ -z "$wsDef" ] && { echo "ERROR: Workspace '$workspace_id' not found."; exit 1; }

services=$(echo "$wsDef" | jq -r '(.services // [])[]')
if [ -n "$services" ]; then
  echo "Stopping services for workspace $workspace_id…"
  while IFS= read -r svc; do
    echo "  Stopping: $svc"
  done <<< "$services"
fi

tmp="${wsFile}.tmp"
jq --arg id "$workspace_id" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '.workspaces = [(.workspaces // [])[] | if .id == $id then .status = "stopped" | .services = [] | .lastActiveAt = $ts else . end]' \
  "$wsFile" > "$tmp" && mv "$tmp" "$wsFile"

echo "Workspace '$workspace_id' stopped."
```

### prune

```bash
echo "Pruning stopped/detached workspaces for org '$org_name'…"

before=$(jq '.workspaces | length' "$wsFile")
removed=0
orphaned=0

tmp="${wsFile}.tmp"
jq '.workspaces = [(.workspaces // [])[] | select(.status != "stopped" and .status != "detached")]' \
  "$wsFile" > "$tmp" && mv "$tmp" "$wsFile"

after=$(jq '.workspaces | length' "$wsFile")
removed=$((before - after))

# Find orphaned worktrees (path gone)
while IFS= read -r path; do
  { [ -z "$path" ] || [ "$path" = "null" ]; } && continue
  [ ! -d "$path" ] && orphaned=$((orphaned + 1))
done < <(jq -r '(.workspaces // [])[].worktree_path // ""' "$wsFile")

echo "  Removed $removed stopped/detached workspace record(s)."
[ "$orphaned" -gt 0 ] && echo "  WARNING: $orphaned workspace(s) have missing worktree paths. Run --action status to investigate."
echo "Done. Active workspaces: $(jq '.workspaces | length' "$wsFile")"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
workspace_id: <id if applicable>
workspaces_total: <N>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
