---
name: mastermind-tasks
description: Mastermind tasks — view, create, assign, and move tasks on an org's task board. Supports parent-child chains, goal linkage, and status filtering.
type: domain-skill
default_mode: auto
---

# Mastermind Tasks

This skill is invoked by `mastermind:tasks` or directly via `/mastermind:tasks`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block
- `org_name`: org whose board to manage
- `action`: list | create | assign | move | close | chain
- `task_title`: title for create
- `task_id`: card id for assign/move/close
- `role_id`: role to assign the task to
- `parent_id`: parent task id (for hierarchical task chains)
- `goal_ref`: goal slug this task contributes to (links task to goal)
- `status`: todo | doing | done (for move)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Org Config

```bash
orgFile=".monomind/orgs/${org_name}.json"
board_id=$(jq -r '.board_id // empty' "$orgFile")
todo_col=$(jq -r '.todo_col_id // empty' "$orgFile")
doing_col=$(jq -r '.doing_col_id // empty' "$orgFile")
done_col=$(jq -r '.done_col_id // empty' "$orgFile")

[ -z "$board_id" ] && { echo "ERROR: org config missing board_id — run /mastermind:createorg to rebuild."; exit 1; }
```

---

## Step 2 — Execute Action

### list (default)

Show all tasks grouped by column with role labels and parent chains:

```bash
echo "=== TODO ==="
monotask card list $board_id --col $todo_col --json | jq -r '.[] | "[\(.id)] \(.title)  role=\(.labels // [] | map(select(startswith("role:"))) | .[0] // "unassigned")"'

echo "=== DOING ==="
monotask card list $board_id --col $doing_col --json | jq -r '.[] | "[\(.id)] \(.title)  role=\(.labels // [] | map(select(startswith("role:"))) | .[0] // "unassigned")"'

echo "=== DONE ==="
monotask card list $board_id --col $done_col --json | jq -r '.[] | "[\(.id)] \(.title)"'
```

Render as:
```
TASKS — org: <org_name>
──────────────────────────────────────────────
TODO (N)
  [abc123] Write homepage copy          → role:content-writer
  [def456]   └─ Draft hero section      → role:content-writer  (child of abc123)

DOING (N)
  [ghi789] Review brand guidelines      → role:reviewer

DONE (N)
  [jkl012] Research competitor sites
```

### create

Create a task card and optionally link it to a parent or goal:

```bash
CARD_ID=$(monotask card create $board_id $todo_col "$task_title" --json | jq -r .id)
[ -n "$role_id" ] && monotask card label add $board_id $CARD_ID "role:${role_id}"
[ -n "$parent_id" ] && monotask card subtask add $board_id $CARD_ID $board_id $todo_col "$task_title" --json
[ -n "$goal_ref" ] && monotask card label add $board_id $CARD_ID "goal:${goal_ref}"
echo "Created task: $CARD_ID"
```

Emit `org:task:created` event to dashboard.

### assign

```bash
[ -n "$role_id" ] && monotask card label add $board_id $task_id "role:${role_id}"
echo "Assigned task $task_id to role $role_id"
```

### move

```bash
case "$status" in
  todo)  col_target=$todo_col ;;
  doing) col_target=$doing_col ;;
  done)  col_target=$done_col ;;
esac
monotask card move $board_id $task_id $col_target
echo "Moved task $task_id to $status"
```

Emit `org:task:moved` event.

### chain

Build a task chain (parent → child sequence) from a list of task titles:

Parse `task_title` as newline-separated titles. Create each card in order, linking each as a prerequisite of the next:

```bash
prev_id=""
while IFS= read -r title; do
  CARD_ID=$(monotask card create $board_id $todo_col "$title" --json | jq -r .id)
  [ -n "$role_id" ] && monotask card label add $board_id $CARD_ID "role:${role_id}"
  [ -n "$prev_id" ] && monotask card prerequisite add $board_id $CARD_ID $board_id $prev_id
  prev_id=$CARD_ID
  echo "  Created: [$CARD_ID] $title"
done <<< "$task_title"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
task_id: <task_id if applicable>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
