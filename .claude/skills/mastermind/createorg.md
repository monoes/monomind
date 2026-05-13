---
name: mastermind-createorg
description: Mastermind createorg — design, configure, and persist an autonomous agent organization with named roles, hierarchy, and communication topology. Suggests org structure from a goal description and saves the definition for later use with runorg.
type: domain-skill
default_mode: confirm
---

# Mastermind Create Org

This skill is invoked by `mastermind:createorg` or directly via `/mastermind:createorg`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `prompt`: goal and/or role description for this org
- `org_name`: desired name for the org (slug, e.g. `content-team`); constrained to `[a-z0-9-]`
- `roles_desc`: optional explicit role list from user (e.g. "boss, content writer, reviewer, marketer, designer, middle manager")
- `mode`: auto | confirm
- `session_id`: session ID passed by command wrapper (snake_case input)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command" (i.e. invoked directly, not by the command wrapper), load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

If `caller` is "command", use the `brain_context` already provided.

Run intake from `_intake.md` if `prompt` is vague (stop at Q3, domain is `ops`). Skip intake if `prompt` is a rich prompt per _intake.md criteria.

---

## Step 1 — Resolve Org Name

If `org_name` is not provided, extract the most prominent product/team noun from `prompt`, slugify it (lowercase, spaces → hyphens, strip non-`[a-z0-9-]` chars), and confirm with the user. Fallback: `org-<YYYYMMDD>`.

Reject any `org_name` that does not match `^[a-z0-9][a-z0-9-]{0,63}$`.

---

## Step 2 — Ingest Roles

Parse `roles_desc` (if provided) into a list of role titles. If not provided, derive a set of roles from `prompt` by identifying the human functions needed to achieve the goal.

**Required roles to always include** (if the prompt implies a team):
- A coordinator/boss role that owns the goal and makes final decisions
- At least one executor role that does the primary work
- A reviewer or QA role if quality output is implied
- A communication layer (middle manager) if team size ≥ 4

**Role → Agent Type mapping table** (use exact `subagent_type` slug for Task tool):

| User role keyword | Agent type slug | Specialty |
|---|---|---|
| boss / ceo / director / lead / chief | `coordinator` | Strategic oversight, final decisions |
| content writer / writer / copywriter | `Content Creator` | Blog posts, copy, articles |
| content reviewer / editor | `reviewer` | Review quality, accuracy, tone (use `reviewer`, not `Code Reviewer`) |
| marketer / marketing / growth | `Growth Hacker` | Campaigns, acquisition, channels |
| designer / ui / ux / visual | `Monodesign` | Visuals, UI, brand |
| middle manager / manager | `Project Shepherd` | Sprint planning, cross-team coordination |
| engineer / developer / coder / dev | `coder` | Code implementation |
| researcher / analyst | `researcher` | Research, data, insights |
| seo / search | `SEO Specialist` | SEO, search strategy |
| social media / social | `Social Media Strategist` | Social content and engagement |
| product / product manager | `Product Manager` | Roadmap, prioritization |
| qa / tester | `tester` | Quality assurance, testing |

If a role doesn't match any keyword, use `general-purpose` and note it in the org config.

---

## Step 3 — Suggest Communication Topology

Determine topology from team size:
- 1–3 roles → `mesh` (all communicate directly)
- 4–6 roles → `star` (boss at center, all report to boss)
- 7+ roles → `hierarchical` (boss → middle manager(s) → executors)

Build directed communication edges:

**Communication edge types:**
- `command`: top-down direction of work
- `report`: bottom-up status / output delivery
- `feedback`: peer review or critique
- `handoff`: one role passes output directly to next role in sequence

**Default edges for a 6-role org (boss, content writer, content reviewer, marketer, designer, middle manager):**
```
boss → middle_manager (command)
middle_manager → content_writer (command)
middle_manager → designer (command)
middle_manager → marketer (command)
content_writer → content_reviewer (handoff)
content_reviewer → middle_manager (report)
designer → middle_manager (report)
marketer → middle_manager (report)
middle_manager → boss (report)
boss → middle_manager (feedback)
```

Adjust for the actual roles in this run. Assign `reports_to` on each role using the derived topology.

---

## Step 4 — Build Org Config

Produce an org config object using the resolved topology (not hardcoded to `hierarchical`).

Ask the user (or infer from prompt) for the optional Paperclip-style fields:
- **Budget**: max token budget for this org run (e.g. 500000 tokens). Use `unlimited` if not specified.
- **Governance**: approval policy — `auto` (agents act freely) | `board` (sensitive actions require `/mastermind:approve`) | `strict` (all external actions need approval)
- **Adapter**: which AI model/adapter the CEO agent should use (e.g. `claude-sonnet-4-6`, `claude-opus-4-7`). Default: `claude-sonnet-4-6`.

```json
{
  "name": "<org_name>",
  "goal": "<the goal the org exists to achieve>",
  "created_at": "<ISO8601>",
  "mode": "daemon",
  "topology": "<mesh | star | hierarchical — from Step 3>",
  "roles": [
    {
      "id": "<slug>",
      "title": "<display title>",
      "agent_type": "<subagent_type slug from mapping table>",
      "responsibilities": ["<1-3 bullet responsibilities>"],
      "reports_to": "<role id or null>",
      "adapter_config": {
        "model": "<claude model id>",
        "max_tokens": 8192
      }
    }
  ],
  "communication": [
    {
      "from": "<role_id>",
      "to": "<role_id>",
      "type": "command | report | feedback | handoff",
      "protocol": "direct"
    }
  ],
  "governance": {
    "policy": "auto | board | strict",
    "approvals_file": ".monomind/orgs/<org_name>-approvals.json"
  },
  "board_id": "<uuid — filled in Step 6 after board creation>",
  "todo_col_id": "<uuid — filled in Step 6>",
  "doing_col_id": "<uuid — filled in Step 6>",
  "done_col_id": "<uuid — filled in Step 6>",
  "board_space": "<org_name>",
  "board_name": "org-tasks",
  "run_config": {
    "checkpoint_interval_min": 30,
    "max_concurrent_agents": 6,
    "memory_namespace": "org:<org_name>",
    "budget_tokens": "<number or 0 for unlimited>",
    "alert_threshold": 0.8,
    "ceo_adapter": "<model id>"
  }
}
```

---

## Step 5 — Show Plan and Confirm (confirm mode)

Render the org plan in a clear human-readable format:

```
╔══════════════════════════════════════════════════╗
║  ORG: <org_name>                                 ║
║  GOAL: <goal>                                    ║
╚══════════════════════════════════════════════════╝

ROLES
─────
• [boss] CEO / Boss
    Agent: coordinator
    Reports to: (none — top of hierarchy)
    Responsibilities: Strategic oversight, final approval

• [middle_manager] Middle Manager
    Agent: Project Shepherd
    Reports to: boss
    Responsibilities: Sprint planning, cross-team coordination

  ... (all roles)

COMMUNICATION TOPOLOGY
──────────────────────
boss → middle_manager  (command)
middle_manager → content_writer  (command)
content_writer → content_reviewer  (handoff)
content_reviewer → middle_manager  (report)
  ... (all edges)

SETTINGS
────────
Topology: <derived>  |  Mode: persistent daemon
Memory: org:<org_name>  |  Board: <org_name>/org-tasks
Checkpoint every: 30 min  |  Max agents: 6

Type "go" to save this org, or describe changes.
```

In **auto** mode, skip the confirmation prompt.

If the user requests changes, apply them and re-render. Repeat until confirmed.

---

## Step 6 — Save Org Config

Set shell variables from the resolved inputs (use the actual `org_name` value from Step 1 and `session_id` input):

```bash
org_name="<resolved org name from Step 1>"   # e.g. "content-team"
session_id="<session_id input>"               # passed by command wrapper
orgJson=".monomind/orgs/${org_name}.json"
mkdir -p .monomind/orgs
```

Write the confirmed org config as JSON using `jq` to guarantee valid encoding:

```bash
# Build the config JSON from the confirmed org plan and write atomically
# (Claude constructs the full jq expression from the confirmed roles/edges in Step 5)
jq -n \
  --arg name "$org_name" \
  --arg goal "$goal" \
  --arg topology "$topology" \
  --argjson roles "$roles_json" \
  --argjson communication "$communication_json" \
  '{name:$name,goal:$goal,mode:"daemon",topology:$topology,
    created_at:(now|todate),roles:$roles,communication:$communication,
    board_space:$name,board_name:"org-tasks",
    run_config:{checkpoint_interval_min:30,max_concurrent_agents:6,memory_namespace:("org:"+$name)}}' \
  > "${orgJson}.tmp" && mv "${orgJson}.tmp" "$orgJson"
```

Create the monotask space, board, and default columns (space is required — abort before creating board if space fails):
```bash
# Step 1 — Space (required first)
space_id=$(monotask space list 2>/dev/null | awk -F' \| ' -v n="$org_name" '$2==n{print $1}' | head -1)
[ -z "$space_id" ] && space_id=$(monotask space create "$org_name" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
[ -z "$space_id" ] && { echo "ERROR: Could not find or create space '$org_name' — verify monotask is installed (run: monotask --version)"; exit 1; }

# Step 2 — Board (created only after space is confirmed)
board_id=$(monotask board create "org-tasks" --json | jq -r '.id // empty')
[ -z "$board_id" ] && { echo "ERROR: Failed to create monotask board"; exit 1; }

# Step 3 — Link board to space immediately
monotask space boards add "$space_id" "$board_id" >/dev/null 2>&1 || true

# Step 4 — Columns
todo_col_id=$(monotask column create "$board_id" "Todo"  --json | jq -r '.id')
doing_col_id=$(monotask column create "$board_id" "Doing" --json | jq -r '.id')
done_col_id=$(monotask column create "$board_id" "Done"  --json | jq -r '.id')
```

Patch the saved org config with the board and column IDs:
```bash
tmp="${orgJson}.tmp"
jq --arg board_id "$board_id" \
   --arg todo_col_id "$todo_col_id" \
   --arg doing_col_id "$doing_col_id" \
   --arg done_col_id "$done_col_id" \
   '. + {board_id:$board_id,todo_col_id:$todo_col_id,doing_col_id:$doing_col_id,done_col_id:$done_col_id}' \
   "$orgJson" > "$tmp" && mv "$tmp" "$orgJson"
```

---

## Step 7 — Emit Dashboard Events

Read values from the saved JSON file and emit two events: `domain:complete` (for the session stream) and `org:create` (so the dashboard Orgs panel registers the new org immediately):

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
orgName=$(jq -r '.name' "$orgJson")
goal_val=$(jq -r '.goal' "$orgJson")
rolesCount=$(jq '.roles | length // 0' "$orgJson")

# domain:complete — for session correlation
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg orgName "$orgName" \
    --arg goal "$goal_val" \
    --argjson rolesCount "$rolesCount" \
    '{type:"domain:complete",session:$session,domain:"ops",status:"complete",
      org:$orgName,goal:$goal,roles_count:$rolesCount,ts:(now*1000|floor)}')" || true

# org:create — so handleOrgEvent routes it to the Orgs panel event log
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg org "$orgName" \
    --arg goal "$goal_val" \
    '{type:"org:create",session:$session,org:$org,goal:$goal,ts:(now*1000|floor)}')" || true
```

---

## Step 8 — Return Output

```yaml
domain: ops
status: complete
artifacts:
  - path: .monomind/orgs/<org_name>.json
    type: config
decisions:
  - what: "Org <org_name> created with N roles"
    why: "Role mapping derived from goal and user description"
    confidence: 0.85
    outcome: shipped
lessons:
  - what_worked: "Auto-suggested roles matched user intent"
  - what_didnt: ""
next_actions:
  - "Run /mastermind:runorg --org <org_name> to start the organization"
  - "Edit .monomind/orgs/<org_name>.json to customize roles or communication"
board_url: "monotask://<org_name>/org-tasks"
run_id: "<current UTC datetime as ISO8601, e.g. via $(date -u +%Y-%m-%dT%H:%M:%SZ)>"
```

Print confirmation:
```
✓ Org "<org_name>" saved to .monomind/orgs/<org_name>.json
  → Run: /mastermind:runorg --org <org_name>
```

---

## Step 9 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
