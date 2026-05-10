---
name: mastermind-idea
description: Mastermind idea domain — product ideation, feature brainstorming, pivot exploration. Spawns an Idea Manager agent for divergent thinking, then validates, elaborates, and decomposes approved ideas into actionable subtasks.
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
3. Return unified output schema with `status: complete`

---

## Complex Execution

### Step 3 — Monotask Board Setup

Set up the space and ideation board. The ideation board has a dedicated pipeline with six columns (not master's board).

```bash
project_name="${project_name:-$(basename "$PWD")}"

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
Decompose the ideation goal into distinct angles of exploration. For each angle, identify:
- Perspective (market, user, technical, competitive)
- Which specialist to assign
- Expected output format
- Dependencies between angles

STEP 2 — CREATE IDEA CARDS
For each angle, create a card in the New column:

  result=$(monotask card create "${BOARD_ID}" "${COL_NEW}" "<angle summary ≤80 chars>" --json)
  CARD_ID=$(echo "$result" | jq -r '.id // empty')
  monotask card set-description "${BOARD_ID}" "$CARD_ID" "<angle description>"
  monotask card comment add "${BOARD_ID}" "$CARD_ID" "CONTEXT: ${date} | Project: ${project_name}
SCOPE: <market | users | technology | competitors>
CONSTRAINTS: <product constraints, brand voice, strategic limits>
AGENT: <researcher | Trend Researcher | Product Manager | Growth Hacker | Content Creator>"
  monotask card label add "${BOARD_ID}" "$CARD_ID" "mastermind-idea"

STEP 3 — EXECUTE
Spawn one Task agent per angle (all in parallel, mesh topology):
- Market research:     subagent_type "researcher"
- Trend analysis:      subagent_type "Trend Researcher"
- User perspective:    subagent_type "UX Researcher"
- Growth angle:        subagent_type "Growth Hacker"
- Content/narrative:   subagent_type "Content Creator"

Each agent receives: the angle description, brain context, and the project context.

STEP 4 — DEDUPLICATE AND RETURN
Collect all ideas from the specialist agents. Deduplicate by title similarity — drop any idea whose title is more than 80% similar to an already-kept idea.

For each unique idea, return a structured entry in a JSON block labelled IDEAS_OUTPUT:

IDEAS_OUTPUT
[
  {
    "card_id": "<monotask card ID created in Step 2>",
    "title": "<idea title>",
    "description": "<2-3 sentence description>",
    "category": "feature | technical-baseline",
    "source_angle": "<which specialist produced this>"
  }
]
END_IDEAS_OUTPUT`
})
```

Parse the `IDEAS_OUTPUT` JSON block from the agent's response. If zero ideas were returned, report "Idea Manager produced no ideas." and STOP.

---

### Step 5 — Validation (Product Manager Evaluation)

Spawn a single `Product Manager` agent via the Task tool. Provide it with:
- All ideas from Step 4 (titles, descriptions, card IDs)
- The `brain_context`
- The original `prompt`

For **each idea**, the agent must return one verdict plus **impact** (0–10) and **effort** (0–10) scores:

| Verdict | Criteria |
|---------|----------|
| **evaluated** | Worth pursuing. Include a `skipElaboration` boolean (`true` = straightforward, `false` = needs deeper research) and a 1-2 sentence value statement. |
| **iced** | Good potential but needs a question answered first. Include the blocking question. |
| **rejected** | Out of scope, infeasible, or low value. Include a 1-sentence reason. |

Execute board updates for each verdict:

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

If **all** ideas were iced or rejected, output a summary table and STOP — skip Steps 6–7.

---

### Step 6 — Elaboration + Task Decomposition

#### 6a. Elaboration (conditional)

For any evaluated idea with `skipElaboration: true`, move it directly to `Elaborated`:
```bash
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ELABORATED" --json
```

For ideas with `skipElaboration: false`, spawn two agents in parallel via the Task tool:

1. `feature-dev:code-explorer` — traces execution paths, maps dependencies, surfaces codebase constraints for each idea.
2. `researcher` (with WebSearch) — finds prior art, edge cases, implementation pitfalls.

Provide both with: the list of `skipElaboration: false` ideas (titles, descriptions, card IDs) + `brain_context`.

After both complete, for each idea they processed:

```bash
monotask card comment add "$BOARD_ID" "$CARD_ID" "Edge cases: <findings>"
monotask card comment add "$BOARD_ID" "$CARD_ID" "Technical notes: <codebase constraints, implementation path>"
monotask card comment add "$BOARD_ID" "$CARD_ID" "Prior art: <references found>"

# If no blocking issue found:
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ELABORATED" --json

# If a blocking issue IS found (mutually exclusive with the above):
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ICED" --json
monotask card comment add "$BOARD_ID" "$CARD_ID" "Blocked during elaboration: <issue>"
```

#### 6b. Task Decomposition

Spawn a single `Software Architect` agent via the Task tool. Provide it with:
- All ideas now in the `Elaborated` column — titles, descriptions, all card comments, and card IDs
- The `brain_context`
- The original `prompt`

The architect must return a `TASKS` array. For each elaborated idea, produce 2–6 subtasks. If an idea's scope is unclear, the architect should flag it (no subtasks for that idea) and include the card_id + a clarifying question.

Each task entry in the TASKS array must include:
```json
{
  "parent_card_id": "<ideation board card ID>",
  "title": "<subtask title ≤80 chars>",
  "description": "<what to build/do>",
  "agent": "<recommended subagent_type>",
  "effort": <1-10>,
  "has_prerequisites": false
}
```

**After the Architect returns**, the outer skill creates cards on the `monomind-task` board:

**Look up or create the monomind-task board** — check memory for `"monomind-task board_id"` in namespace `monomind`. If found, use it as `TASK_BOARD_ID`. Otherwise:

```bash
TASK_BOARD_ID=$(monotask board create "monomind-task" --json | jq -r '.id // empty')
monotask space boards add "$space_id" "$TASK_BOARD_ID" >/dev/null 2>&1 || true
npx monomind@latest memory store --key "monomind-task board_id" --value "$TASK_BOARD_ID" --namespace monomind
# Create columns matching createtask standard
monotask column create "$TASK_BOARD_ID" "Backlog"       --json >/dev/null
monotask column create "$TASK_BOARD_ID" "Todo"          --json >/dev/null
monotask column create "$TASK_BOARD_ID" "In Progress"   --json >/dev/null
monotask column create "$TASK_BOARD_ID" "Review"        --json >/dev/null
monotask column create "$TASK_BOARD_ID" "Human in Loop" --json >/dev/null
monotask column create "$TASK_BOARD_ID" "Done"          --json >/dev/null
```

Look up the column ID for card placement:
```bash
task_columns=$(monotask column list "$TASK_BOARD_ID" --json)
# Cards with prerequisites → Backlog; cards without → Todo
TASK_COL_TODO=$(echo "$task_columns"    | jq -r '.[] | select(.title == "Todo")    | .id' | head -1)
TASK_COL_BACKLOG=$(echo "$task_columns" | jq -r '.[] | select(.title == "Backlog") | .id' | head -1)
```

For each task in the TASKS array:
```bash
# Choose column based on has_prerequisites
COL_TARGET=$( [ "$has_prerequisites" = "true" ] && echo "$TASK_COL_BACKLOG" || echo "$TASK_COL_TODO" )

TASK_CARD_ID=$(monotask card create "$TASK_BOARD_ID" "$COL_TARGET" "<task title>" --json | jq -r '.id')
monotask card comment add "$TASK_BOARD_ID" "$TASK_CARD_ID" \
  "SOURCE: mastermind:idea | <first 100 chars of prompt>
AGENT: <agent>
EFFORT: <effort>/10
PARENT IDEA: <idea title> (card: <parent_card_id> on ideation board)"
monotask card label add "$TASK_BOARD_ID" "$TASK_CARD_ID" "mastermind:idea"
```

For each **parent idea card** (grouped by `parent_card_id`), annotate and move to `Tasked`:
```bash
# $IDEA_CARD_ID = parent_card_id from the TASKS group
monotask card comment add "$BOARD_ID" "$IDEA_CARD_ID" \
  "Subtasks created: <list of titles with agent and effort>"
monotask card move "$BOARD_ID" "$IDEA_CARD_ID" "$COL_TASKED" --json
```

For any idea the Architect flagged as unclear, move to `Iced`:
```bash
monotask card comment add "$BOARD_ID" "$IDEA_CARD_ID" "Needs clarification: <question>"
monotask card move "$BOARD_ID" "$IDEA_CARD_ID" "$COL_ICED" --json
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
run_id: <ISO8601-timestamp>
summary:
  ideas_generated: N
  ideas_evaluated: N
  ideas_tasked: N
  total_subtasks: N
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
