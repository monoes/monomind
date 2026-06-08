---
name: mastermind-createorg
description: Mastermind createorg — design, configure, and persist an autonomous agent organization with named roles, hierarchy, and communication topology. Supports optional --schedule flag for self-scheduling loop orgs.
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
- `schedule`: optional schedule string, e.g. `"every 30 minutes"`, `"every hour"`, `"every 2 hours"`, `"daily"`. When provided, generates a self-scheduling loop org.
- `mode`: auto | confirm
- `session_id`: session ID passed by command wrapper (snake_case input)
- `caller`: command | master

### Schedule parsing (when `--schedule` is present)

Convert the schedule string to `poll_interval_minutes`:

| Schedule string | Minutes |
|---|---|
| `every N minutes` | N |
| `every minute` | 1 |
| `every hour` | 60 |
| `every N hours` | N × 60 |
| `daily` / `every day` | 1440 |
| `every N days` | N × 1440 |

```bash
# Example: "every 30 minutes" → poll_interval_minutes=30
# "every 2 hours" → poll_interval_minutes=120
# "daily" → poll_interval_minutes=1440
```

Store the parsed value as `poll_interval_minutes` for use in Steps 4 and 6.7.

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

If a role doesn't match any keyword **and the org's domain is far from software** (legal, medical, finance, creative, etc.), do NOT force a mismatched generic type whose instructions are about the wrong domain (e.g. a court reporter mapped to the code `reviewer`). Instead coin a role-specific `agent_type` slug from the role title (slugify: `Court Reporter` → `court-reporter`, `Prosecutor` → `prosecutor`) and generate a fitting definition for it in Step 2.5. Only fall back to `general-purpose` when no sensible slug applies.

---

## Step 2.5 — Complete Every Agent's Specification (generate what's missing)

**This is the step that makes each created agent actually work.** A role is only usable if it has: skills, an instruction document (system prompt), an input contract, and an output contract. Most of these are missing from a bare role description — **generate them, tailored to the specific agent, rather than leaving them blank.**

For **each** role, do the following:

**1. Check whether a usable agent definition already exists.**
```bash
# Match by frontmatter `name:` first, then by filename slug, anywhere under .claude/agents
at="<agent_type>"
existing=$(grep -rils "^name:[[:space:]]*${at}\$" .claude/agents 2>/dev/null | head -1)
[ -z "$existing" ] && existing=$(find .claude/agents -iname "${at}.md" 2>/dev/null | head -1)
```
A definition is **usable** only if it exists AND its domain fits this role. A curated def whose instructions are about a different domain (e.g. `reviewer.md` = code review, applied to a "Court Reporter") does **not** count as usable — treat it as missing and coin a role-specific `agent_type` (see Step 2 note).

**2. If no usable definition exists, generate one** at `.claude/agents/generated/<agent_type>.md`. Author it specifically for this role and this org's goal — never a generic stub. Use this shape:

```markdown
---
name: <agent_type>
description: <one line — who this agent is and what it does>
capability:
  role: <agent_type>
  goal: <one sentence: the agent's standing objective in this org>
  version: "1.0.0"
  expertise:            # 4–6 concrete SKILLS this role needs to do its job well
    - <skill>
    - <skill>
  task_types:           # 3–5 kinds of work it performs
    - <task-type>
  input_type: <what this agent consumes — who/what it receives, derived from its inbound communication edges + responsibilities>
  output_type: <what this agent produces — the artifact it hands off or reports, derived from its outbound edges + responsibilities>
  model_preference: sonnet
  termination: <the condition under which this agent's job is done>
---

# <Role Title>

<1–2 sentences: the agent's identity and stance.>

## Core Responsibilities
<the role's responsibilities, expanded into numbered, actionable duties>

## Operating Guidelines
<3–6 concrete rules that keep this agent doing the right thing for its domain — what to always do, what never to do, how to handle missing inputs>

## Communication
- **Receives (input)**: <sources + what, from the inbound edges in Step 3>
- **Sends (output)**: <targets + what, from the outbound edges in Step 3>
- **Protocol**: <direct / via manager; who it reports to>

## Quality Bar
<one sentence defining "good output" for this role, so the agent can self-check>
```

Generate this content with real domain reasoning — the `expertise`, `input_type`, `output_type`, and instruction body must be specific to *this* agent (a prosecutor's skills are not a judge's). Reuse a generated def across roles of the same `agent_type` (don't regenerate if you just created it this run).

**3. Populate the org role.** Set the role's `skills` array to the def's `expertise` list (so the org config is self-describing), and keep `agent_type` pointing at the (possibly newly coined) type. Never leave `skills: []` when expertise was generated.

**4. Note generated files** for the Step 8 artifacts list.

The dashboard agent drawer and `runorg` both read these definitions (matched by `agent_type`), so generating them here is what makes the Roles/Skills/instructions show up *and* what gives each spawned agent its real instructions at run time.

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

**Completeness rules (every role must be properly wired — no orphans):**
- Every executor role has **≥1 inbound edge** (how work reaches it — usually a `command`) and **≥1 outbound edge** (how its output leaves — usually a `report` or `handoff`).
- Where one role's output is another's input, connect them with a `handoff` in that direction (e.g. clerk → counsel; writer → editor). Make sequential producer→consumer chains explicit.
- The coordinator/boss has an inbound `report` from each role it commands, so results flow back up.
- Peer roles that critique each other get `feedback` edges; adversarial pairs (e.g. prosecutor ↔ defender) get reciprocal `handoff` edges.
- After building edges, **derive each role's input/output contract from them**: a role's `input_type` summarizes who/what its inbound edges deliver; its `output_type` summarizes what its outbound edges carry. Feed these into the generated definition from Step 2.5 so the spec and the topology agree.

A role that ends up with no inbound or no outbound edge is a bug — re-examine the topology before saving.

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
  "status": "<'stopped' if --schedule provided; omit otherwise>",
  "roles": [
    {
      "id": "<slug>",
      "title": "<display title>",
      "agent_type": "<subagent_type slug from mapping table>",
      "responsibilities": ["<1-3 bullet responsibilities>"],
      "reports_to": "<role id or null>",
      "skills": ["<populated from the generated def's expertise in Step 2.5 — never left empty>"],
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
  },
  "loop": "<only included when --schedule was provided; see below>"
}
```

**If `--schedule` was provided**, include these two additional top-level fields in the org config:

```json
{
  "status": "stopped",
  "loop": {
    "poll_interval_minutes": "<parsed from schedule string>",
    "last_run": null,
    "next_run": null,
    "run_prompt_file": ".monomind/loops/<org_name>.md"
  }
}
```

`status` starts as `"stopped"`. The org does not run until `/mastermind:runorg --org <org_name>` is called (which transitions it to `"active"`).

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
Schedule: <"every <poll_interval_minutes> minutes" if --schedule; otherwise "manual (no auto-schedule)">
Status: <"stopped (run /mastermind:runorg --org <org_name> to activate)" if --schedule; otherwise "—">

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
# Build the config JSON from the confirmed org plan and write atomically.
# Set shell variables from the confirmed plan before running this block:
#   governance_policy     — "auto" | "board" | "strict"  (from Step 4)
#   budget_tokens_val     — integer or 0 for unlimited     (from Step 4)
#   ceo_adapter           — model id string                (from Step 4)
#   poll_interval_minutes — integer (from --schedule), or "" if no schedule
jq -n \
  --arg name "$org_name" \
  --arg goal "$goal" \
  --arg topology "$topology" \
  --argjson roles "$roles_json" \
  --argjson communication "$communication_json" \
  --arg gov_policy "${governance_policy:-auto}" \
  --argjson budget_tokens "${budget_tokens_val:-0}" \
  --arg ceo_adapter "${ceo_adapter:-claude-sonnet-4-6}" \
  '{name:$name,goal:$goal,mode:"daemon",topology:$topology,
    created_at:(now|todate),roles:$roles,communication:$communication,
    governance:{policy:$gov_policy,approvals_file:(".monomind/orgs/"+$name+"-approvals.json")},
    board_space:$name,board_name:"org-tasks",
    run_config:{
      checkpoint_interval_min:30,
      max_concurrent_agents:6,
      memory_namespace:("org:"+$name),
      budget_tokens:$budget_tokens,
      alert_threshold:0.8,
      ceo_adapter:$ceo_adapter
    }}' \
  > "${orgJson}.tmp" && mv "${orgJson}.tmp" "$orgJson"
```

**If `--schedule` was provided**, patch the saved config with `status` and `loop`:

```bash
# Only run this block when poll_interval_minutes is set (i.e. --schedule was used)
interval_seconds=$(( poll_interval_minutes * 60 ))
tmp="${orgJson}.tmp"
jq \
  --argjson interval "$poll_interval_minutes" \
  --argjson interval_s "$interval_seconds" \
  --arg run_prompt_file ".monomind/loops/${org_name}.md" \
  '. + {
    status: "stopped",
    loop: {
      poll_interval_minutes: $interval,
      last_run: null,
      next_run: null,
      run_prompt_file: $run_prompt_file
    }
  }' \
  "$orgJson" > "$tmp" && mv "$tmp" "$orgJson"
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

## Step 6.7 — Generate Loop Prompt File (scheduled orgs only)

**Skip this step if `--schedule` was NOT provided.**

If `poll_interval_minutes` is set, generate the self-scheduling loop prompt at `.monomind/loops/<org_name>.md`.

This file is the single source of truth for one scheduled iteration. It is passed verbatim as the `prompt` argument to `ScheduleWakeup` at the end of every iteration — the loop is self-perpetuating as long as `status == "active"`.

**Loop prompt structure:**

The file must follow this exact template (substitute actual values for all `<placeholders>`):

````markdown
# <org_name> — Loop Prompt

**Controlled by:** `.monomind/orgs/<org_name>.json` → `status` field
**Start:** `/mastermind:runorg --org <org_name>` (sets `status: "active"` and runs first iteration)
**Stop:** `/mastermind:stoporg --org <org_name>` (sets `status: "stopped"` — next wakeup exits without rescheduling)
**Pause (HIL):** set `status: "paused"` in `.monomind/orgs/<org_name>.json` — loop keeps waking up but skips work until status returns to `"active"`

---

## Step 0 — Status Gate (REQUIRED FIRST — do not skip)

```bash
ORG_FILE=".monomind/orgs/<org_name>.json"
LOOP_STATUS=$(jq -r '.status // "stopped"' "$ORG_FILE" 2>/dev/null || echo "stopped")
```

- If `LOOP_STATUS == "active"` → continue to Step 1.
- If `LOOP_STATUS == "paused"` → print "Org '<org_name>' is paused — skipping iteration. Jump directly to Schedule Next." Do NOT run Steps 1–N.
- If anything else (including `"stopped"`) → print "Org '<org_name>' status is '$LOOP_STATUS' — exiting loop. **Do NOT call ScheduleWakeup.**" and stop.

---

## Step 1 — Record Iteration Start

```bash
ORG_FILE=".monomind/orgs/<org_name>.json"
tmp="${ORG_FILE}.tmp"
jq '.loop.last_run = (now|todate)' "$ORG_FILE" > "$tmp" && mv "$tmp" "$ORG_FILE"
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg org "<org_name>" --arg proj "$REPO_ROOT" \
    '{type:"org:loop:start",org:$org,project:$proj,ts:(now*1000|floor)}')" || true
```

---

## [Org-specific iteration steps]

<IMPORTANT: Generate the actual work steps here from the org's goal and roles. These are NOT generic placeholders — write real, actionable steps derived from the org's goal, roles, and communication topology.>

<For a GitHub issue-resolver org, these would be: find next issue, claim it, implement, test, deploy, report.>
<For a content org, these would be: check content calendar, assign writers, review drafts, publish.>
<Derive from orgConfig.goal and orgConfig.roles[].responsibilities — be specific.>

---

## Schedule Next (ONLY if status is active or paused)

Re-check org status before rescheduling:

```bash
ORG_FILE=".monomind/orgs/<org_name>.json"
LOOP_STATUS=$(jq -r '.status // "stopped"' "$ORG_FILE" 2>/dev/null || echo "stopped")
```

If `LOOP_STATUS == "active"` or `LOOP_STATUS == "paused"`:

1. Read this loop prompt file verbatim:
   ```bash
   LOOP_PROMPT=$(cat .monomind/loops/<org_name>.md)
   ```

2. Call `ScheduleWakeup` with:
   - `delaySeconds`: `<poll_interval_minutes * 60>`
   - `reason`: `"<org_name>: next scheduled poll (every <poll_interval_minutes> min)"`
   - `prompt`: the full contents of `$LOOP_PROMPT`

3. Update `next_run` in the org JSON:
   ```bash
   ORG_FILE=".monomind/orgs/<org_name>.json"
   tmp="${ORG_FILE}.tmp"
   next_ts=$(( $(date +%s) + <poll_interval_minutes * 60> ))
   next_iso=$(date -u -r "$next_ts" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
     || date -u -d "@$next_ts" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
     || python3 -c "import datetime; print(datetime.datetime.utcfromtimestamp($next_ts).strftime('%Y-%m-%dT%H:%M:%SZ'))")
   jq --arg next "$next_iso" '.loop.next_run = $next' "$ORG_FILE" > "$tmp" && mv "$tmp" "$ORG_FILE"
   ```

4. Emit `org:loop:scheduled` event:
   ```bash
   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
   CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
   curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
     -H "Content-Type: application/json" \
     -d "$(jq -cn --arg org "<org_name>" --arg next "$next_iso" --arg proj "$REPO_ROOT" \
       '{type:"org:loop:scheduled",org:$org,next_run:$next,project:$proj,ts:(now*1000|floor)}')" || true
   ```

If `LOOP_STATUS` is anything else (e.g. `"stopped"`) → print "Org '<org_name>' loop ended — not rescheduling." and exit.
````

**Write this file to disk:**

```bash
mkdir -p .monomind/loops
# Write the generated loop prompt (constructed above as a here-doc or Write tool)
# to .monomind/loops/<org_name>.md
```

Use the Write tool (not Bash echo/cat) to write the file so the content is verbatim.

The org-specific iteration steps (the block between Step 1 and "Schedule Next") must be **generated from the actual org** — goal, roles, responsibilities — not left as generic placeholders.

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

# org:create — so handleOrgEvent routes it to the Orgs panel event log and SSE triggers list refresh
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg org "$orgName" \
    --arg goal "$goal_val" \
    --arg proj "$(pwd)" \
    '{type:"org:create",session:$session,org:$org,goal:$goal,project:$proj,ts:(now*1000|floor)}')" || true
```

---

## Step 8 — Return Output

```yaml
domain: ops
status: complete
artifacts:
  - path: .monomind/orgs/<org_name>.json
    type: config
  - path: .claude/agents/generated/<agent_type>.md
    type: agent-definition
    note: "one per role whose agent_type lacked a usable definition (skills, instructions, input/output)"
  - path: .monomind/loops/<org_name>.md
    type: loop-prompt
    note: "only present when --schedule was used; omit otherwise"
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
  - "[scheduled orgs only] Run /mastermind:stoporg --org <org_name> to stop the loop"
  - "[scheduled orgs only] Run /mastermind:orgs to see all org statuses"
board_url: "monotask://<org_name>/org-tasks"
run_id: "<current UTC datetime as ISO8601, e.g. via $(date -u +%Y-%m-%dT%H:%M:%SZ)>"
```

Print confirmation:
```
✓ Org "<org_name>" saved to .monomind/orgs/<org_name>.json
  → Run: /mastermind:runorg --org <org_name>
```

If `--schedule` was provided, also print:
```
✓ Loop prompt saved to .monomind/loops/<org_name>.md
  Schedule: every <poll_interval_minutes> minutes
  Status: stopped (org will not run until /mastermind:runorg --org <org_name>)

  Lifecycle:
    Start: /mastermind:runorg --org <org_name>
    Stop:  /mastermind:stoporg --org <org_name>
    List:  /mastermind:orgs
```

---

## Step 9 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
