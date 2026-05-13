---
name: mastermind-worktree
description: Mastermind worktree — create isolated git worktrees for org agents. Each agent gets its own branch and working directory, preventing conflicts when multiple agents edit code simultaneously.
type: domain-skill
default_mode: confirm
---

# Mastermind Worktree

This skill is invoked by `mastermind:worktree` or directly via `/mastermind:worktree`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block
- `org_name`: org whose agents need worktrees
- `action`: list | create | assign | merge | cleanup | status
- `agent_id`: role id of the agent to create a worktree for
- `base_branch`: branch to create worktree from (default: current HEAD)
- `branch_name`: explicit branch name (default: `org/<org_name>/<agent_id>/<YYYYMMDD-HHMMSS>`)
- `worktree_path`: explicit path (default: `.monomind/worktrees/<org_name>/<agent_id>`)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Concept

When multiple agents in an org need to edit files concurrently (e.g. a content writer, designer, and developer all working on different parts of a codebase), git worktrees give each agent its own checkout of the repo on a dedicated branch. Changes are isolated until the org's boss (or a human) merges them.

Worktree registry is stored in `.monomind/orgs/<org_name>-worktrees.json`.

---

## Step 1 — Load Worktree Registry

```bash
orgFile=".monomind/orgs/${org_name}.json"
worktreesFile=".monomind/orgs/${org_name}-worktrees.json"
[ ! -f "$worktreesFile" ] && echo '{"worktrees":[]}' > "$worktreesFile"
```

---

## Step 2 — Execute Action

### list (default)

```bash
echo "WORKTREES — org: $org_name"
echo "──────────────────────────────────────────────"
git worktree list 2>/dev/null | head -20

echo ""
echo "REGISTRY:"
jq -r '.worktrees[] | "[\(.agent_id)] branch=\(.branch)  path=\(.path)  created=\(.created_at)"' \
   "$worktreesFile" 2>/dev/null || echo "No registered worktrees."
```

### create

Create a worktree for a specific agent:

```bash
agentConfig=$(jq --arg id "$agent_id" '.roles[] | select(.id == $id)' "$orgFile")
[ -z "$agentConfig" ] && { echo "ERROR: Agent '$agent_id' not found in org."; exit 1; }

# Resolve branch name
timestamp=$(date +%Y%m%d-%H%M%S)
branch="${branch_name:-org/${org_name}/${agent_id}/${timestamp}}"
wtPath="${worktree_path:-.monomind/worktrees/${org_name}/${agent_id}}"

# Create the worktree
git worktree add -b "$branch" "$wtPath" "${base_branch:-HEAD}" 2>&1
if [ $? -ne 0 ]; then
  echo "ERROR: Failed to create worktree. Check that git is initialized and the base branch exists."
  exit 1
fi

echo "Created worktree: $wtPath (branch: $branch)"

# Register in worktrees file
tmp="${worktreesFile}.tmp"
jq --arg agent "$agent_id" \
   --arg branch "$branch" \
   --arg path "$wtPath" \
   --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.worktrees = [.worktrees[] | select(.agent_id != $agent)] +
    [{"agent_id":$agent,"branch":$branch,"path":$path,"status":"active","created_at":$ts}]' \
   "$worktreesFile" > "$tmp" && mv "$tmp" "$worktreesFile"
```

Include worktree path in agent prompt when spawning:

```
WORKTREE: Your isolated working directory is ${wtPath}
All file edits should happen inside this directory.
Branch: ${branch}
To view your changes: git -C "${wtPath}" diff
```

### merge

Merge a completed agent's worktree branch back to the base:

```bash
wt=$(jq --arg id "$agent_id" '.worktrees[] | select(.agent_id == $id)' "$worktreesFile")
branch=$(echo "$wt" | jq -r '.branch')
wtPath=$(echo "$wt" | jq -r '.path')

echo "Merging branch $branch..."
git merge "$branch" --no-ff -m "org($org_name): merge $agent_id work from $branch"
if [ $? -eq 0 ]; then
  echo "Merge successful. Removing worktree..."
  git worktree remove "$wtPath" --force 2>/dev/null || true
  git branch -d "$branch" 2>/dev/null || true
  # Update registry
  tmp="${worktreesFile}.tmp"
  jq --arg id "$agent_id" \
     '.worktrees = [.worktrees[] | if .agent_id == $id then .status = "merged" | .merged_at = (now|todate) else . end]' \
     "$worktreesFile" > "$tmp" && mv "$tmp" "$worktreesFile"
  echo "Worktree merged and removed."
else
  echo "ERROR: Merge conflict on $branch. Resolve manually then run cleanup."
fi
```

### status

Show diff summary for all active agent worktrees:

```bash
jq -r '.worktrees[] | select(.status == "active") | "\(.agent_id) \(.path) \(.branch)"' \
  "$worktreesFile" | while read -r agent path branch; do
  echo "[$agent] branch=$branch"
  git -C "$path" diff --stat 2>/dev/null | tail -3
  echo ""
done
```

### cleanup

Remove all merged or abandoned worktrees:

```bash
git worktree prune 2>/dev/null
jq -r '.worktrees[] | select(.status != "active") | .path' "$worktreesFile" | while read -r path; do
  [ -d "$path" ] && git worktree remove "$path" --force 2>/dev/null || true
done
echo "Pruned stale worktrees."
```

---

## Integration with runorg / heartbeat

When a boss agent assigns code-editing work to an agent, it should:

1. Call `/mastermind:worktree --action create --agent-id <role_id>`
2. Include the worktree path in the agent's task prompt
3. When the agent marks the task Done, call `/mastermind:worktree --action merge --agent-id <role_id>`

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
agent_id: <agent_id if applicable>
branch: <branch if applicable>
worktree_path: <path if applicable>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
