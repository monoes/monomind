---
name: mastermind-idea
description: Mastermind idea domain — product ideation, feature brainstorming, pivot exploration. Spawns an Idea Manager agent for divergent thinking, then validates, elaborates, and decomposes approved ideas into actionable subtasks on separate dev and ops task boards.
type: domain-skill
default_mode: confirm
---

# Mastermind Idea Domain

This skill is invoked by `mastermind:master` or directly via `/mastermind:idea`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via _protocol.md brain load)
- `prompt`: the ideation goal for this run
- `project_name`: monotask space name
- `mode`: auto | confirm

Note: the `board_id` that mastermind:master may pass is its own orchestration board. The idea domain always creates a dedicated **ideation board** with its own pipeline columns — do not reuse master's board_id.

---

## Complexity Assessment

Assess the prompt to determine execution mode:

**Simple (direct execution):** Single-answer ideation, one agent:
- "Give me 5 name ideas for this feature"
- "Suggest one pivot angle for this product"
→ Use a single researcher or content-creator agent. Skip Steps 3–6. Go straight to Step 7 (Brain Write).

**Complex (full pipeline):** Any of these:
- Product strategy or pivot exploration (multiple angles needed)
- Feature ideation requiring market and user context
- Competitive landscape brainstorm
- Full product vision document
→ Run Steps 3–6 (Board Setup → Idea Manager → Validation → Elaboration + Tasks).

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `idea`)
2. Run intake from _intake.md if prompt is vague
3. For complex prompts: run Steps 3–6 below
4. At end: follow _protocol.md Brain Write Procedure (namespace: `idea`)

---

## Simple Execution

For simple prompts (single agent, single output):

1. Spawn one Task agent with the ideation request as a self-contained briefing
2. Collect output
3. If called standalone (not from master): follow _protocol.md Brain Write Procedure (namespace: `idea`)
4. Return unified output schema with `status: complete`

---

## Complex Execution

### Step 3 — Monotask Board Setup

Set up the space and ideation board. The ideation board has a dedicated pipeline with six columns (not master's board).

```bash
project_name="${project_name:-$(basename "$PWD")}"
date=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Find or create space
space_id=$(monotask space list 2>/dev/null | awk -F' \| ' -v n="$project_name" '$2==n{print $1}' | head -1)
[ -z "$space_id" ] && space_id=$(monotask space create "$project_name" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
[ -z "$space_id" ] && { echo "ERROR: Could not find or create space '$project_name'"; exit 1; }
```

**Memory-first board lookup:** Check memory for `"mastermind-idea board_id"` in namespace `monomind`. If a board ID is returned, use it as `BOARD_ID` and look up the existing column IDs. Otherwise, create the board:

```bash
BOARD_ID=$(monotask board create "ideation" --json | jq -r '.id // empty')
[ -z "$BOARD_ID" ] && { echo "ERROR: Failed to create ideation board"; exit 1; }
monotask space boards add "$space_id" "$BOARD_ID" >/dev/null 2>&1 || true
npx monomind@latest memory store --key "mastermind-idea board_id" --value "$BOARD_ID" --namespace monomind

# Create columns in pipeline order
COL_NEW=$(monotask column create "$BOARD_ID" "New" --json | jq -r '.id')
COL_EVALUATED=$(monotask column create "$BOARD_ID" "Evaluated" --json | jq -r '.id')
COL_ELABORATED=$(monotask column create "$BOARD_ID" "Elaborated" --json | jq -r '.id')
COL_TASKED=$(monotask column create "$BOARD_ID" "Tasked" --json | jq -r '.id')
COL_ICED=$(monotask column create "$BOARD_ID" "Iced" --json | jq -r '.id')
COL_REJECTED=$(monotask column create "$BOARD_ID" "Rejected" --json | jq -r '.id')
```

If the board already existed, look up column IDs:

```bash
columns=$(monotask column list "$BOARD_ID" --json)
COL_NEW=$(echo "$columns"       | jq -r '.[] | select(.title == "New")        | .id' | head -1)
COL_EVALUATED=$(echo "$columns" | jq -r '.[] | select(.title == "Evaluated")  | .id' | head -1)
COL_ELABORATED=$(echo "$columns"| jq -r '.[] | select(.title == "Elaborated") | .id' | head -1)
COL_TASKED=$(echo "$columns"    | jq -r '.[] | select(.title == "Tasked")     | .id' | head -1)
COL_ICED=$(echo "$columns"      | jq -r '.[] | select(.title == "Iced")       | .id' | head -1)
COL_REJECTED=$(echo "$columns"  | jq -r '.[] | select(.title == "Rejected")   | .id' | head -1)
```

---

### Step 4 — Idea Manager Agent (Divergent Thinking)

Substitute all template variables (`BOARD_ID`, `COL_NEW`, `project_name`, `brain_context`, `prompt`, `date`) with their actual values before calling Task.

Spawn the Idea Manager with `run_in_background: false` so its output is available for Step 5.

```javascript
Task({
  subagent_type: "coordinator",
  description: "Idea Manager for project " + project_name,
  run_in_background: false,
  prompt: `You are the Idea Manager for project "${project_name}".

CONTEXT: ${date} | Project: ${project_name} | Spawned by: mastermind:idea

BRAIN CONTEXT:
${brain_context}

YOUR BOARD: ${BOARD_ID}
COL_NEW: ${COL_NEW}
YOUR GOAL: ${prompt}

STEP 1 — PLAN
Decompose the ideation goal into distinct exploration angles. For each angle, identify:
- Perspective (market, user, technical, competitive, business operations)
- Which specialist to assign
- Expected output format

STEP 2 — SPAWN SPECIALISTS
Spawn one Task agent per angle (all in parallel, mesh topology). Each agent receives the
angle description, brain context, and project context, and must return a JSON array of ideas.

Specialists to spawn for EVERY run:
- Market research:       subagent_type "researcher"
- Trend analysis:        subagent_type "Trend Researcher"
- User perspective:      subagent_type "UX Researcher"
- Growth angle:          subagent_type "Growth Hacker"
- Content/narrative:     subagent_type "Content Creator"
- Business operations:   subagent_type "Account Strategist"

Each specialist must classify every idea with one of these categories:
  feature             — new product capability for end users
  technical-baseline  — infrastructure, tooling, or technical debt (not user-visible)
  business-operation  — internal process, workflow, marketing, sales, ops, or org change

Each specialist returns ideas in this format:
[
  {
    "title": "...",
    "description": "...",
    "category": "feature | technical-baseline | business-operation"
  }
]

STEP 3 — DEDUPLICATE
Collect all ideas from all specialists. Drop any idea whose title is more than 80% similar
to an already-kept idea (fuzzy match). Keep the richer description when deduplicating.

STEP 4 — CREATE CARDS AND RETURN
For each unique idea, create one card in the New column (COL_NEW = ${COL_NEW}):

  result=$(monotask card create "${BOARD_ID}" "${COL_NEW}" "<idea title ≤80 chars>" --json)
  CARD_ID=$(echo "$result" | jq -r '.id // empty')
  monotask card comment add "${BOARD_ID}" "$CARD_ID" "DESCRIPTION: <2-3 sentence description>
CATEGORY: <feature | technical-baseline | business-operation>
SOURCE: <which specialist angle produced this>"
  monotask card label add "${BOARD_ID}" "$CARD_ID" "mastermind-idea"
  monotask card label add "${BOARD_ID}" "$CARD_ID" "category:<category>"

Then output a JSON block labelled IDEAS_OUTPUT with one entry per unique idea:

IDEAS_OUTPUT
[
  {
    "card_id": "<monotask card ID just created>",
    "title": "<idea title>",
    "description": "<2-3 sentence description>",
    "category": "feature | technical-baseline | business-operation",
    "source_angle": "<which specialist produced this>"
  }
]
END_IDEAS_OUTPUT`
})
```

Parse the `IDEAS_OUTPUT` JSON block from the agent's response. If zero ideas were returned, report "Idea Manager produced no ideas." and STOP.

---

### Step 5 — Validation (Product Manager Evaluation)

Spawn a single `Product Manager` agent via the Task tool. The PM agent has Bash tool access and is responsible for both producing verdicts and executing all board updates directly.

Provide the PM agent with:
- All ideas from Step 4 (titles, descriptions, categories, card IDs, BOARD_ID, and all COL_* variables)
- The `brain_context`
- The original `prompt`

The PM agent must, for **each idea**, determine one verdict plus **impact** (0–10) and **effort** (0–10) scores:

| Verdict | Criteria |
|---------|----------|
| **evaluated** | Worth pursuing. Set a `skipElaboration` boolean (`true` = straightforward, no deep research needed; `false` = edge cases should be explored). Include a 1-2 sentence value statement. |
| **iced** | Good potential but needs a question answered first. Include the blocking question. |
| **rejected** | Out of scope, infeasible, or low value. Include a 1-sentence reason. |

The PM agent must run these board updates directly using Bash tool:

```bash
# evaluated
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_EVALUATED" --json
monotask card set-impact "$BOARD_ID" "$CARD_ID" <0-10>
monotask card set-effort "$BOARD_ID" "$CARD_ID" <0-10>
monotask card comment add "$BOARD_ID" "$CARD_ID" "Value: <value statement>"

# iced
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ICED" --json
monotask card set-impact "$BOARD_ID" "$CARD_ID" <0-10>
monotask card set-effort "$BOARD_ID" "$CARD_ID" <0-10>
monotask card comment add "$BOARD_ID" "$CARD_ID" "Blocked: <question>"

# rejected
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_REJECTED" --json
monotask card comment add "$BOARD_ID" "$CARD_ID" "Rejected: <reason>"
```

The PM agent must also output a structured block so the outer skill can proceed:

```
VERDICTS_OUTPUT
[
  {
    "card_id": "<card ID>",
    "title": "<idea title>",
    "category": "feature | technical-baseline | business-operation",
    "verdict": "evaluated | iced | rejected",
    "skipElaboration": true | false,
    "impact": <0-10>,
    "effort": <0-10>
  }
]
END_VERDICTS_OUTPUT
```

After the PM agent completes, parse `VERDICTS_OUTPUT`. If **all** ideas are iced or rejected, output a summary table and STOP — skip Steps 6–7.

---

### Step 6 — Elaboration + Task Decomposition

#### 6a. Elaboration (conditional)

For any evaluated idea with `skipElaboration: true`, move it directly to `Elaborated`:
```bash
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ELABORATED" --json
```

For ideas with `skipElaboration: false`, **split by category** before spawning agents:

**Dev ideas** (`feature` or `technical-baseline`):
Spawn two agents in parallel:
1. `feature-dev:code-explorer` — traces execution paths, maps dependencies, surfaces codebase constraints relevant to each idea.
2. `researcher` (with WebSearch) — finds prior art, edge cases, implementation pitfalls for each idea.

**Business-operation ideas** (`business-operation`):
Spawn two agents in parallel:
1. `researcher` (with WebSearch) — finds industry benchmarks, comparable operational processes, known pitfalls, and market context.
2. `Product Manager` — assesses process feasibility, stakeholder impact, alignment with existing workflows, and resource requirements.

Provide all agents with: their subset of ideas (titles, descriptions, card IDs) + `brain_context`.

Each agent must output their findings in this format:
```
ELABORATION_OUTPUT
[
  {
    "card_id": "<idea card ID>",
    "findings": "<detailed findings for this idea>",
    "blocking_issue": "<blocking issue if any, or null>"
  }
]
END_ELABORATION_OUTPUT
```

After all agents complete, merge their outputs per idea (same card_id → concatenate findings). For each idea:

```bash
# Write merged findings as card comments
# Dev ideas:
monotask card comment add "$BOARD_ID" "$CARD_ID" "Edge cases & prior art: <researcher findings>"
monotask card comment add "$BOARD_ID" "$CARD_ID" "Codebase constraints: <code-explorer findings>"

# Business-operation ideas:
monotask card comment add "$BOARD_ID" "$CARD_ID" "Industry context & benchmarks: <researcher findings>"
monotask card comment add "$BOARD_ID" "$CARD_ID" "Feasibility & stakeholder impact: <PM findings>"

# If neither agent found a blocking issue:
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ELABORATED" --json

# If either agent found a blocking issue (mutually exclusive with the above):
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ICED" --json
monotask card comment add "$BOARD_ID" "$CARD_ID" "Blocked during elaboration: <issue>"
```

#### 6b. Task Decomposition

**Spawn decomposition agents by track** — run both in parallel if both tracks have elaborated ideas:

- For **dev ideas** (`feature` or `technical-baseline`): spawn a `Software Architect` agent.
- For **business-operation ideas**: spawn a `Product Manager` agent.

Provide each agent with:
- Their subset of elaborated ideas (titles, descriptions, all card comments, card IDs, and category)
- The `brain_context`
- The original `prompt`

Each agent must output a `TASKS_OUTPUT` block. For each elaborated idea, produce 2–6 subtasks. If an idea's scope is unclear, flag it instead of decomposing.

```
TASKS_OUTPUT
[
  {
    "parent_card_id": "<ideation board card ID>",
    "title": "<subtask title ≤80 chars>",
    "description": "<what to build/do>",
    "category": "feature | technical-baseline | business-operation",
    "agent": "<recommended subagent_type>",
    "effort": <1-10>,
    "has_prerequisites": <true | false>
  }
]
FLAGGED
[
  { "card_id": "<ideation card ID>", "question": "<what needs clarifying>" }
]
END_TASKS_OUTPUT
```

**After both decomposition agents return**, the outer skill creates task cards on the appropriate board for each task's category.

---

**Dev task board** (`feature` / `technical-baseline` → `monomind-task`):

Check memory for `"monomind-task board_id"` in namespace `monomind`. If found, use it as `TASK_BOARD_ID`. Otherwise create it:

```bash
TASK_BOARD_ID=$(monotask board create "monomind-task" --json | jq -r '.id // empty')
monotask space boards add "$space_id" "$TASK_BOARD_ID" >/dev/null 2>&1 || true
npx monomind@latest memory store --key "monomind-task board_id" --value "$TASK_BOARD_ID" --namespace monomind
monotask column create "$TASK_BOARD_ID" "Backlog"       --json >/dev/null
monotask column create "$TASK_BOARD_ID" "Todo"          --json >/dev/null
monotask column create "$TASK_BOARD_ID" "In Progress"   --json >/dev/null
monotask column create "$TASK_BOARD_ID" "Review"        --json >/dev/null
monotask column create "$TASK_BOARD_ID" "Human in Loop" --json >/dev/null
monotask column create "$TASK_BOARD_ID" "Done"          --json >/dev/null
```

Look up column IDs:
```bash
task_columns=$(monotask column list "$TASK_BOARD_ID" --json)
TASK_COL_TODO=$(echo "$task_columns"    | jq -r '.[] | select(.title == "Todo")    | .id' | head -1)
TASK_COL_BACKLOG=$(echo "$task_columns" | jq -r '.[] | select(.title == "Backlog") | .id' | head -1)
```

---

**Ops task board** (`business-operation` → `monomind-ops-task`):

Check memory for `"monomind-ops-task board_id"` in namespace `monomind`. If found, use it as `OPS_BOARD_ID`. Otherwise create it:

```bash
OPS_BOARD_ID=$(monotask board create "monomind-ops-task" --json | jq -r '.id // empty')
monotask space boards add "$space_id" "$OPS_BOARD_ID" >/dev/null 2>&1 || true
npx monomind@latest memory store --key "monomind-ops-task board_id" --value "$OPS_BOARD_ID" --namespace monomind
monotask column create "$OPS_BOARD_ID" "Backlog"       --json >/dev/null
monotask column create "$OPS_BOARD_ID" "Todo"          --json >/dev/null
monotask column create "$OPS_BOARD_ID" "In Progress"   --json >/dev/null
monotask column create "$OPS_BOARD_ID" "Review"        --json >/dev/null
monotask column create "$OPS_BOARD_ID" "Human in Loop" --json >/dev/null
monotask column create "$OPS_BOARD_ID" "Done"          --json >/dev/null
```

Look up column IDs:
```bash
ops_columns=$(monotask column list "$OPS_BOARD_ID" --json)
OPS_COL_TODO=$(echo "$ops_columns"    | jq -r '.[] | select(.title == "Todo")    | .id' | head -1)
OPS_COL_BACKLOG=$(echo "$ops_columns" | jq -r '.[] | select(.title == "Backlog") | .id' | head -1)
```

---

**Create task cards** — for each task in the merged TASKS_OUTPUT:

```bash
if [ "$category" = "business-operation" ]; then
  TARGET_BOARD="$OPS_BOARD_ID"
  COL_TARGET=$([ "$has_prerequisites" = "true" ] && echo "$OPS_COL_BACKLOG" || echo "$OPS_COL_TODO")
  BOARD_LABEL="monomind-ops-task"
else
  TARGET_BOARD="$TASK_BOARD_ID"
  COL_TARGET=$([ "$has_prerequisites" = "true" ] && echo "$TASK_COL_BACKLOG" || echo "$TASK_COL_TODO")
  BOARD_LABEL="monomind-task"
fi

TASK_CARD_ID=$(monotask card create "$TARGET_BOARD" "$COL_TARGET" "<task title>" --json | jq -r '.id')
monotask card comment add "$TARGET_BOARD" "$TASK_CARD_ID" \
  "SOURCE: mastermind:idea | <first 100 chars of prompt>
AGENT: <agent>
EFFORT: <effort>/10
CATEGORY: <category>
PARENT IDEA: <idea title> (card: <parent_card_id> on ideation board)"
monotask card label add "$TARGET_BOARD" "$TASK_CARD_ID" "mastermind:idea"
monotask card label add "$TARGET_BOARD" "$TASK_CARD_ID" "category:<category>"
```

Group tasks by `parent_card_id`. For each parent idea, annotate and move to `Tasked`:
```bash
monotask card comment add "$BOARD_ID" "$parent_card_id" \
  "Subtasks created on <board_label>: <list of titles with agent and effort>"
monotask card move "$BOARD_ID" "$parent_card_id" "$COL_TASKED" --json
```

For each entry in FLAGGED, move the idea to `Iced`:
```bash
monotask card comment add "$BOARD_ID" "$flagged_card_id" "Needs clarification: <question>"
monotask card move "$BOARD_ID" "$flagged_card_id" "$COL_ICED" --json
```

---

### Step 7 — Brain Write + Return

Follow _protocol.md Brain Write Procedure (namespace: `idea`).

Return unified output schema to caller:

```yaml
domain: idea
status: complete | partial | blocked
artifacts: []
decisions:
  - what: <top idea or direction>
    why: <reasoning from validation + elaboration>
    confidence: <0.0-1.0>
    outcome: pending
lessons:
  - what_worked: <which angles produced the best insights>
  - what_didnt: <which angles were less useful>
next_actions:
  - <e.g. "run mastermind:build to prototype chosen direction">
  - <e.g. "run mastermind:research to validate top idea">
board_url: "monotask://<project_name>/ideation"
task_board_url: "monotask://<project_name>/monomind-task"
ops_task_board_url: "monotask://<project_name>/monomind-ops-task"
run_id: <ISO8601-timestamp>
summary:
  ideas_generated: N
  ideas_dev: N
  ideas_ops: N
  ideas_evaluated: N
  ideas_tasked: N
  total_dev_subtasks: N
  total_ops_subtasks: N
  ideas_iced: N
  ideas_rejected: N
```

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Full product ideation | coordinator + mesh specialists | mesh 6 gossip balanced |
| Feature brainstorm | researcher + trend-analyst | mesh 4 gossip balanced |
| Pivot exploration | coordinator + researcher + growth | mesh 4 gossip balanced |
| Competitive scan | researcher | hierarchical 3 raft specialized |
| Single idea request | researcher or content-creator | single agent |
