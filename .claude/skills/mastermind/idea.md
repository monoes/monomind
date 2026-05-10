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
- `board_id`: monotask board ID (set by master, or created standalone)
- `mode`: auto | confirm

---

## Complexity Assessment

Assess the prompt to determine execution mode:

**Simple (direct execution):** Single-answer ideation, one agent:
- "Give me 5 name ideas for this feature"
- "Suggest one pivot angle for this product"
→ Use a single researcher or content-creator agent. Skip Steps 4–6.

**Complex (full pipeline):** Any of these:
- Product strategy or pivot exploration (multiple angles needed)
- Feature ideation requiring market and user context
- Competitive landscape brainstorm
- Full product vision document
→ Run Steps 3–6 (Idea Manager → Validation → Elaboration → Tasks).

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `idea`)
2. Run intake from _intake.md if prompt is vague
3. Set up monotask space and board (see Step 3 below)
4. Proceed with complexity assessment
5. At end: follow _protocol.md Brain Write Procedure (namespace: `idea`)

---

## Simple Execution

For simple prompts (single agent, single output):

1. Spawn one Task agent with the ideation request as a self-contained briefing
2. Collect output
3. Return unified output schema with `status: complete`
4. Skip Steps 3–6 entirely.

---

## Complex Execution

### Step 3 — Monotask Board Setup

Set up the ideation board with the standard idea pipeline columns:

```bash
project_name="${project_name:-$(basename "$PWD")}"
space_id=$(monotask space list 2>/dev/null | awk -F' \| ' -v n="$project_name" '$2==n{print $1}' | head -1)
[ -z "$space_id" ] && space_id=$(monotask space create "$project_name" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
[ -z "$space_id" ] && { echo "ERROR: Could not find or create space '$project_name'"; exit 1; }

# Memory-first board lookup
BOARD_ID=$(npx monomind@latest memory search "mastermind-idea board_id $project_name" --namespace monomind 2>/dev/null | head -1)

if [ -z "$BOARD_ID" ]; then
  BOARD_ID=$(monotask board create "ideation" --json | jq -r '.id // empty')
  [ -z "$BOARD_ID" ] && { echo "ERROR: Failed to create ideation board"; exit 1; }
  monotask space boards add "$space_id" "$BOARD_ID" >/dev/null 2>&1 || true
  npx monomind@latest memory store --key "mastermind-idea board_id $project_name" --value "$BOARD_ID" --namespace monomind

  # Create columns in pipeline order
  COL_NEW=$(monotask column create "$BOARD_ID" "New" --json | jq -r '.id')
  COL_EVALUATED=$(monotask column create "$BOARD_ID" "Evaluated" --json | jq -r '.id')
  COL_ELABORATED=$(monotask column create "$BOARD_ID" "Elaborated" --json | jq -r '.id')
  COL_TASKED=$(monotask column create "$BOARD_ID" "Tasked" --json | jq -r '.id')
  COL_ICED=$(monotask column create "$BOARD_ID" "Iced" --json | jq -r '.id')
  COL_REJECTED=$(monotask column create "$BOARD_ID" "Rejected" --json | jq -r '.id')
else
  columns=$(monotask column list "$BOARD_ID" --json)
  COL_NEW=$(echo "$columns" | jq -r '.[] | select(.name == "New") | .id' | head -1)
  COL_EVALUATED=$(echo "$columns" | jq -r '.[] | select(.name == "Evaluated") | .id' | head -1)
  COL_ELABORATED=$(echo "$columns" | jq -r '.[] | select(.name == "Elaborated") | .id' | head -1)
  COL_TASKED=$(echo "$columns" | jq -r '.[] | select(.name == "Tasked") | .id' | head -1)
  COL_ICED=$(echo "$columns" | jq -r '.[] | select(.name == "Iced") | .id' | head -1)
  COL_REJECTED=$(echo "$columns" | jq -r '.[] | select(.name == "Rejected") | .id' | head -1)
fi
```

---

### Step 4 — Idea Manager Agent (Divergent Thinking)

Spawn an Idea Manager agent via Task tool:

```javascript
Task({
  subagent_type: "coordinator",
  description: `You are the Idea Manager for project <project_name>.

CONTEXT: <date> | Project: <project_name> | Spawned by: mastermind:idea

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <BOARD_ID>
YOUR GOAL: <prompt>

STEP 1 — PLAN
Decompose the ideation goal into distinct angles of exploration. For each angle, identify:
- What perspective or lens to apply (market, user, technical, competitive)
- Which specialist to assign
- What output format is needed (list, document, diagram, recommendation)
- Dependencies between angles

STEP 2 — CREATE IDEA CARDS
For each angle, create a card in the "New" column (COL_NEW = <COL_NEW>):
```bash
result=$(monotask card create "<BOARD_ID>" "<COL_NEW>" "<ideation angle summary, ≤80 chars>" --json)
CARD_ID=$(echo "$result" | jq -r '.id // empty')
monotask card set-description "<BOARD_ID>" "$CARD_ID" "[specific ideation angle and output expected]"
monotask card comment add "<BOARD_ID>" "$CARD_ID" "CONTEXT: <date> | Project: <project_name>
BRAIN MEMORY: [3-5 most relevant brain context excerpts]
SCOPE: [market | users | technology | competitors]
CONSTRAINTS: [product constraints, brand voice, strategic limits]
AGENT: [researcher | Trend Researcher | Product Manager | Growth Hacker | Content Creator]"
monotask card label add "<BOARD_ID>" "$CARD_ID" "mastermind-idea"
```

STEP 3 — EXECUTE
Spawn one Task agent per angle (all in parallel):
- Market research: subagent_type "researcher"
- Trend analysis: subagent_type "Trend Researcher"
- User perspective: subagent_type "UX Researcher"
- Growth angle: subagent_type "Growth Hacker"
- Content/narrative: subagent_type "Content Creator"

STEP 4 — COLLECT AND RETURN
Synthesize all agent outputs. For each idea produced, return a structured entry:
{
  "card_id": "<monotask card ID>",
  "title": "<idea title>",
  "description": "<2-3 sentence description>",
  "category": "feature | technical-baseline",
  "source_angle": "<which specialist produced this>"
}

Return the full array of ideas to the caller.`,
  run_in_background: false
})
```

After the Idea Manager completes, collect all returned ideas. If zero ideas were returned, report "Idea Manager produced no ideas." and STOP.

---

### Step 5 — Validation (Product Manager Evaluation)

Spawn a single `Product Manager` agent via the Agent tool. Provide it with:
- All ideas returned by the Idea Manager (titles, descriptions, card IDs)
- The `brain_context`
- The original `prompt`

For **each idea**, the agent must return one verdict plus **impact** (0–10) and **effort** (0–10) scores:

| Verdict | Criteria | Action |
|---------|----------|--------|
| **evaluated** | Worth pursuing. Include a `skipElaboration` boolean (`true` = straightforward, `false` = needs deeper research) and a 1-2 sentence value statement. | Move to `Evaluated` |
| **iced** | Good potential but needs a question answered first. Include the blocking question. | Move to `Iced` |
| **rejected** | Out of scope, infeasible, or low value. Include a 1-sentence reason. | Move to `Rejected` |

Execute the board updates:

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

#### Elaboration (conditional)

Check if any evaluated ideas have `skipElaboration: false`.

**If all have `skipElaboration: true`:** Move each directly to `Elaborated`:
```bash
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ELABORATED" --json
```

**Otherwise**, spawn two agents in parallel via the Agent tool:

1. `feature-dev:code-explorer` — traces execution paths, maps dependencies, surfaces internal constraints for each idea.
2. `researcher` (with WebSearch) — finds prior art, edge cases, implementation pitfalls.

Provide both with: all `skipElaboration: false` ideas + their card IDs + `brain_context`.

After both complete, for each idea needing elaboration:
```bash
monotask card comment add "$BOARD_ID" "$CARD_ID" "Edge cases: <findings>"
monotask card comment add "$BOARD_ID" "$CARD_ID" "Technical notes: <codebase constraints, implementation path>"
monotask card comment add "$BOARD_ID" "$CARD_ID" "Prior art: <references found>"

# No blocking issue → Elaborated
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ELABORATED" --json

# Blocking issue found → Iced
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ICED" --json
monotask card comment add "$BOARD_ID" "$CARD_ID" "Blocked during elaboration: <issue>"
```

Also move all `skipElaboration: true` ideas to `Elaborated`.

#### Task Decomposition

Spawn a single `Software Architect` agent via the Agent tool. Provide it with:
- All ideas in the `Elaborated` column (titles, descriptions, all comments, card IDs)
- The `brain_context`
- The original `prompt`

The architect must decompose each elaborated idea into 2–6 subtasks. For each idea, if scope is unclear, move it to `Iced` with a clarifying question instead of decomposing.

For each subtask, create a card on the `monomind-task` board (look up or create with same pattern as Step 3, board name `"monomind-task"`):

```bash
# Look up or create monomind-task board
TASK_BOARD_ID=$(npx monomind@latest memory search "monomind-task board_id $project_name" --namespace monomind 2>/dev/null | head -1)
if [ -z "$TASK_BOARD_ID" ]; then
  TASK_BOARD_ID=$(monotask board create "monomind-task" --json | jq -r '.id // empty')
  monotask space boards add "$space_id" "$TASK_BOARD_ID" >/dev/null 2>&1 || true
  npx monomind@latest memory store --key "monomind-task board_id $project_name" --value "$TASK_BOARD_ID" --namespace monomind
  TASK_COL_TODO=$(monotask column create "$TASK_BOARD_ID" "Todo" --json | jq -r '.id')
  monotask column create "$TASK_BOARD_ID" "In Progress" --json >/dev/null
  monotask column create "$TASK_BOARD_ID" "Done" --json >/dev/null
else
  TASK_COL_TODO=$(monotask column list "$TASK_BOARD_ID" --json | jq -r '.[] | select(.name == "Todo") | .id' | head -1)
fi

# Create subtask card
TASK_CARD_ID=$(monotask card create "$TASK_BOARD_ID" "$TASK_COL_TODO" "<subtask title>" --json | jq -r '.id')
monotask card comment add "$TASK_BOARD_ID" "$TASK_CARD_ID" "SOURCE: mastermind:idea | <first 100 chars of prompt>
AGENT: <recommended subagent_type>
EFFORT: <1-10>
PARENT IDEA: <idea title> (card: <CARD_ID> on ideation board)"
monotask card label add "$TASK_BOARD_ID" "$TASK_CARD_ID" "mastermind:idea"
```

After all subtask cards are created for each idea, annotate the idea card and move it to `Tasked`:
```bash
monotask card comment add "$BOARD_ID" "$IDEA_CARD_ID" "Subtasks created:\n- <title> (agent: <type>, effort: <N>/10)\n..."
monotask card move "$BOARD_ID" "$IDEA_CARD_ID" "$COL_TASKED" --json
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
  ideas_iced: N
  ideas_rejected: N
  total_subtasks: N
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
