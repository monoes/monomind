---
name: mastermind-projects
description: Mastermind projects — create and manage scoped project workspaces within an org. Group tasks under named projects, assign agents to projects, and track project-level status.
type: domain-skill
default_mode: confirm
---

# Mastermind Projects

This skill is invoked by `mastermind:projects` or directly via `/mastermind:projects`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block
- `org_name`: org to manage projects for
- `action`: list | add | archive | assign | status
- `project_name`: display name (for add)
- `project_id`: slug (for archive/assign/status)
- `agent_id`: role id to assign as project lead
- `description`: project description
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Projects State

Projects are stored in `.monomind/orgs/<org_name>-projects.json`:

```bash
projectsFile=".monomind/orgs/${org_name}-projects.json"
[ ! -f "$projectsFile" ] && echo '{"projects":[]}' > "$projectsFile"
```

---

## Step 2 — Execute Action

### list (default)

```bash
jq -r '
  .projects[] |
  "[\(.id)] \(.name)  lead=\(.lead_agent // "unassigned")  status=\(.status // "active")  tasks=\(.task_count // 0)\n  \(.description // "")"
' "$projectsFile" 2>/dev/null || echo "No projects yet."
```

Render as:
```
PROJECTS — org: <org_name>
──────────────────────────────────────────────────────
[homepage-redesign] Homepage Redesign
  Lead: content-writer  |  Status: active  |  Tasks: 7
  A full redesign of the company homepage with new copy and visuals.

[q2-seo-push] Q2 SEO Push
  Lead: seo-specialist  |  Status: active  |  Tasks: 12
  Target 10 high-volume keywords for Q2.
```

### add

```bash
project_id=$(echo "$project_name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | tr -s '-')
tmp="${projectsFile}.tmp"
jq --arg id "$project_id" \
   --arg name "$project_name" \
   --arg desc "${description:-}" \
   --arg lead "${agent_id:-}" \
   '.projects += [{"id":$id,"name":$name,"description":$desc,"lead_agent":($lead|if .=="" then null else . end),
     "status":"active","task_count":0,"created_at":(now|todate)}]' \
   "$projectsFile" > "$tmp" && mv "$tmp" "$projectsFile"
echo "Project created: $project_id"
```

Emit `org:project:created` event to dashboard.

### assign

Set the lead agent for a project:

```bash
tmp="${projectsFile}.tmp"
jq --arg id "$project_id" --arg agent "$agent_id" \
   '.projects = [.projects[] | if .id == $id then .lead_agent = $agent | .updated_at = (now|todate) else . end]' \
   "$projectsFile" > "$tmp" && mv "$tmp" "$projectsFile"
echo "Assigned $agent_id as lead for project $project_id"
```

### archive

```bash
tmp="${projectsFile}.tmp"
jq --arg id "$project_id" \
   '.projects = [.projects[] | if .id == $id then .status = "archived" | .archived_at = (now|todate) else . end]' \
   "$projectsFile" > "$tmp" && mv "$tmp" "$projectsFile"
echo "Project $project_id archived."
```

### status

Show project summary with linked tasks from the board:

```bash
project=$(jq --arg id "$project_id" '.projects[] | select(.id == $id)' "$projectsFile")
echo "$project" | jq .

# If board exists, count tasks tagged with this project
orgFile=".monomind/orgs/${org_name}.json"
board_id=$(jq -r '.board_id // empty' "$orgFile")
if [ -n "$board_id" ]; then
  todo_col=$(jq -r '.todo_col_id // empty' "$orgFile")
  doing_col=$(jq -r '.doing_col_id // empty' "$orgFile")
  done_col=$(jq -r '.done_col_id // empty' "$orgFile")
  echo "Tasks on board tagged project:$project_id:"
  for col in "$todo_col" "$doing_col" "$done_col"; do
    monotask card list $board_id --col $col --json 2>/dev/null | \
      jq -r --arg p "project:$project_id" '[.[] | select((.labels // []) | index($p))] | length' 2>/dev/null
  done
fi
```

---

## Using Projects in Task Management

When creating tasks with `/mastermind:tasks`, tag them to a project:

```bash
monotask card label add $board_id $CARD_ID "project:<project_id>"
```

When running org agents, include the project context in task prompts:

```
This task belongs to project "<project_name>": <description>
Report your output tagged with project_id: <project_id>
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
project_id: <project_id if applicable>
projects_file: .monomind/orgs/<org_name>-projects.json
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
