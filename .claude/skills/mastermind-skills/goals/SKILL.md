---
name: mastermind-goals
description: Mastermind goals — define, track, and visualize hierarchical goals for an org. Goals link to tasks, have progress metrics, and form a goal tree.
type: domain-skill
default_mode: confirm
---

# Mastermind Goals

This skill is invoked by `mastermind:goals` or directly via `/mastermind:goals`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block
- `org_name`: org whose goals to manage
- `action`: list | add | update | link | close
- `goal_title`: title for add
- `goal_id`: slug for update/link/close
- `parent_goal`: parent goal slug (for hierarchy)
- `status`: active | achieved | paused | cancelled
- `metric`: success metric description (e.g. "100 blog posts published")
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Goals State

Goals are stored in `.monomind/orgs/<org_name>-goals.json`. Create if missing:

```bash
goalsFile=".monomind/orgs/${org_name}-goals.json"
[ ! -f "$goalsFile" ] && echo '{"goals":[]}' > "$goalsFile"
```

---

## Step 2 — Execute Action

### list (default)

Render goal tree with progress metrics. Goals without a `parent` are root goals; child goals are indented:

```bash
jq -r '
  def tree(gs; pid):
    gs | map(select(.parent == pid)) | .[] |
    ("  " * (.depth // 0)) + "[\(.id)] \(.title)  [\(.status // "active")] \(.metric // "")" ,
    tree(gs; .id);
  .goals | tree(.; null)
' "$goalsFile" 2>/dev/null || jq -r '(.goals // [])[] | "[\(.id)] \(.title)  [\(.status // "active")]"' "$goalsFile"
```

Render as:
```
GOALS — org: <org_name>
──────────────────────────────────────
[grow-audience] Grow audience to 10k followers  [active]
  [content-output] Publish 3 posts/week         [active]  metric: 3 posts/week
    [blog-drafts] 5 draft articles in pipeline  [active]
[improve-seo] Rank top 10 for target keywords   [active]
```

### add

```bash
goal_slug=$(echo "$goal_title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | tr -s '-')
tmp="${goalsFile}.tmp"
jq --arg id "$goal_slug" \
   --arg title "$goal_title" \
   --arg parent "${parent_goal:-}" \
   --arg status "active" \
   --arg metric "${metric:-}" \
   --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.goals += [{"id":$id,"title":$title,"parent":($parent|if .=="" then null else . end),"status":$status,"metric":$metric,"created_at":$created_at,"tasks":[]}]' \
   "$goalsFile" > "$tmp" && mv "$tmp" "$goalsFile"
echo "Goal added: $goal_slug"
```

Emit `org:goal:created` event to dashboard.

### update

Update goal status or metric:

```bash
tmp="${goalsFile}.tmp"
jq --arg id "$goal_id" \
   --arg status "${status:-}" \
   --arg metric "${metric:-}" \
   '.goals = [(.goals // [])[] | if .id == $id then
     (if $status != "" then .status = $status else . end) |
     (if $metric != "" then .metric = $metric else . end) |
     (.updated_at = (now|todate))
   else . end]' \
   "$goalsFile" > "$tmp" && mv "$tmp" "$goalsFile"
```

### link

Link a task id to a goal (append to goal's tasks array):

```bash
tmp="${goalsFile}.tmp"
jq --arg id "$goal_id" --arg task "$task_id" \
   '.goals = [(.goals // [])[] | if .id == $id then .tasks += [$task] else . end]' \
   "$goalsFile" > "$tmp" && mv "$tmp" "$goalsFile"
```

### close

Mark goal as achieved and timestamp:

```bash
tmp="${goalsFile}.tmp"
jq --arg id "$goal_id" \
   '.goals = [(.goals // [])[] | if .id == $id then .status = "achieved" | .achieved_at = (now|todate) else . end]' \
   "$goalsFile" > "$tmp" && mv "$tmp" "$goalsFile"
```

Emit `org:goal:achieved` event.

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
goal_id: <goal_id if applicable>
goals_file: .monomind/orgs/<org_name>-goals.json
```

Suggest next: "Link tasks to this goal with /mastermind:tasks link or /mastermind:goals link --goal-id <id> --task-id <card_id>"

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
