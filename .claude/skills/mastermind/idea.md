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
# Compatible with macOS bash 3.2
project_name="${project_name:-$(basename "$PWD")}"
date=$(date -u +%Y-%m-%dT%H:%M:%SZ)
idea_canonical="${project_name}-idea"

# Find or create space (by exact name)
space_id=$(monotask space list 2>/dev/null | awk -F'|' '{gsub(/^ +| +$/,"",$1);gsub(/^ +| +$/,"",$2);if($2==n)print $1}' n="$project_name" | head -1)
[ -z "$space_id" ] && space_id=$(monotask space create "$project_name" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
[ -z "$space_id" ] && { echo "ERROR: Could not find or create space '$project_name'"; exit 1; }

# Find existing idea board by canonical name — reuse across runs (same pattern as master Step 6)
BOARD_ID=$(monotask board list 2>/dev/null | awk -F'|' '{gsub(/^ +| +$/,"",$1);gsub(/^ +| +$/,"",$2);if($2==n)print $1}' n="$idea_canonical" | head -1)

if [ -n "$BOARD_ID" ]; then
  echo "Reusing idea board: $BOARD_ID ($idea_canonical)"
  columns=$(monotask column list "$BOARD_ID" --json)
  COL_NEW=$(echo "$columns"       | jq -r '.[] | select(.title == "New")        | .id' | head -1)
  COL_EVALUATED=$(echo "$columns" | jq -r '.[] | select(.title == "Evaluated")  | .id' | head -1)
  COL_ELABORATED=$(echo "$columns"| jq -r '.[] | select(.title == "Elaborated") | .id' | head -1)
  COL_TASKED=$(echo "$columns"    | jq -r '.[] | select(.title == "Tasked")     | .id' | head -1)
  COL_ICED=$(echo "$columns"      | jq -r '.[] | select(.title == "Iced")       | .id' | head -1)
  COL_REJECTED=$(echo "$columns"  | jq -r '.[] | select(.title == "Rejected")   | .id' | head -1)
  [ -z "$COL_NEW" ]        && { echo "ERROR: 'New' column missing on board $BOARD_ID — was board created with wrong schema?"; exit 1; }
  [ -z "$COL_EVALUATED" ]  && { echo "ERROR: 'Evaluated' column missing on board $BOARD_ID"; exit 1; }
  [ -z "$COL_ELABORATED" ] && { echo "ERROR: 'Elaborated' column missing on board $BOARD_ID"; exit 1; }
  [ -z "$COL_TASKED" ]     && { echo "ERROR: 'Tasked' column missing on board $BOARD_ID"; exit 1; }
  [ -z "$COL_ICED" ]       && { echo "ERROR: 'Iced' column missing on board $BOARD_ID"; exit 1; }
  [ -z "$COL_REJECTED" ]   && { echo "ERROR: 'Rejected' column missing on board $BOARD_ID"; exit 1; }
else
  echo "Creating idea board: $idea_canonical"
  BOARD_ID=$(monotask board create --space "$space_id" "$idea_canonical" --json 2>/dev/null | jq -r '.id // empty')
  [ -z "$BOARD_ID" ] && { echo "ERROR: Failed to create idea board '$idea_canonical'"; exit 1; }
  monotask space boards add "$space_id" "$BOARD_ID" >/dev/null 2>&1 || true
  COL_NEW=$(monotask column create "$BOARD_ID"       "New"        --json | jq -r '.id')
  COL_EVALUATED=$(monotask column create "$BOARD_ID" "Evaluated"  --json | jq -r '.id')
  COL_ELABORATED=$(monotask column create "$BOARD_ID" "Elaborated" --json | jq -r '.id')
  COL_TASKED=$(monotask column create "$BOARD_ID"    "Tasked"     --json | jq -r '.id')
  COL_ICED=$(monotask column create "$BOARD_ID"      "Iced"       --json | jq -r '.id')
  COL_REJECTED=$(monotask column create "$BOARD_ID"  "Rejected"   --json | jq -r '.id')
fi
```

**After either branch above, validate and echo all values.** This is the canonical source for Step 4 Task construction.

```bash
# Validate BOARD_ID looks like a UUID before proceeding
[[ ! "$BOARD_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] && \
  { echo "ERROR: BOARD_ID '$BOARD_ID' is not a valid UUID — aborting to prevent board name corruption"; exit 1; }

# Echo literal values — READ THESE and embed them as string literals in the Step 4 Task prompt.
# These are shell variables; they DO NOT survive into the Task agent's context.
echo "=== IDEA BOARD LITERAL VALUES ==="
echo "BOARD_ID=$BOARD_ID"
echo "COL_NEW=$COL_NEW"
echo "COL_EVALUATED=$COL_EVALUATED"
echo "COL_ELABORATED=$COL_ELABORATED"
echo "COL_TASKED=$COL_TASKED"
echo "COL_ICED=$COL_ICED"
echo "COL_REJECTED=$COL_REJECTED"
echo "==================================="
```

---

### Step 4 — Idea Manager Agent (Divergent Thinking)

**Before spawning the Idea Manager**, run the registry-aware specialist selection to determine which agents to use. This replaces hardcoded agent types with the best available specialists for the prompt.

```bash
REGISTRY=".monomind/registry.json"
PROMPT="$prompt"
TOP_N=6

# Select user/market/ops angle specialists
CATEGORIES="marketing strategy product academic specialized"
user_market_agents=$(jq -r \
  --arg cats "$CATEGORIES" \
  --arg kw "$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]' | grep -oE '[a-z]{5,}' | sort -u | tr '\n' ' ')" \
  --argjson n "$TOP_N" \
  '[ .agents[] | select(.deprecated != true)
     | select(.category as $c | ($cats | split(" ") | any(. == $c)))
     | {name: .name, slug: .slug, category: .category,
        score: (.name | ascii_downcase | if contains($kw | split(" ") | .[0]) then 2 else 0 end)}
   ] | sort_by(-.score) | unique_by(.slug) | .[0:$n] | [.[].name]' \
  "$REGISTRY" 2>/dev/null)

# Select technical angle specialists
CATEGORIES="engineering development architecture"
tech_agents=$(jq -r \
  --arg cats "$CATEGORIES" \
  --argjson n 3 \
  '[ .agents[] | select(.deprecated != true)
     | select(.category as $c | ($cats | split(" ") | any(. == $c)))
     | {name: .name, slug: .slug}
   ] | unique_by(.slug) | .[0:$n] | [.[].name]' \
  "$REGISTRY" 2>/dev/null)

# Merge: take top 6 from market/ops + top 2 from tech (cap at 8 total)
specialist_list=$(echo "$user_market_agents $tech_agents" | jq -Rs \
  'split("\n") | map(select(length>0)) | unique | .[0:8]' 2>/dev/null)

# Fallback if registry missing
[ -z "$specialist_list" ] && specialist_list='["researcher","Trend Researcher","Growth Hacker","UX Researcher","Content Creator","Account Strategist"]'

echo "Selected specialists: $specialist_list"
```

**CRITICAL — Variable substitution required before constructing the Task call:**
The Task agent runs in an isolated context and cannot inherit shell variables. Before writing the Task prompt below, read the literal UUID values from the `=== IDEA BOARD LITERAL VALUES ===` echo block above and embed them as **hard-coded strings** in the prompt. Do NOT write `${BOARD_ID}`, `${COL_NEW}`, etc. in the prompt — the agent will receive those as literal dollar-sign strings and its `monotask card create` calls will fail, causing it to improvise with `monotask board create` and corrupt board names. Replace every `${BOARD_ID}`, `${COL_NEW}`, `${project_name}`, `${brain_context}`, `${prompt}`, `${date}`, and `${specialist_list}` with the actual value before calling Task. Leave `$result`, `$CARD_ID`, and other loop-internal variables as-is — they are bash variables the agent itself will set at runtime, not substitution targets.

Spawn the Idea Manager with `run_in_background: false` so its output is available for Step 5.

```javascript
Task({
  subagent_type: "coordinator",
  description: "Idea Manager for project " + project_name,
  run_in_background: false,
  prompt: `SAFETY CHECK: Before doing anything else, verify that the BOARD_ID you received matches UUID format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (8-4-4-4-12 hex chars). If it does not, STOP immediately and report "ERROR: BOARD_ID was not substituted — received: <value>". Do NOT call monotask board create, monotask space create, or any board/space/column creation commands. Your only job is creating CARDS on the board you were given.

You are the Idea Manager for project "${project_name}".

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

The following specialist agents have been pre-selected from the registry as best-fit for this prompt.
Spawn ALL of them in one message, assigning each a distinct angle:

SPECIALISTS: ${specialist_list}

Assign each specialist the angle that best matches their domain expertise.
For any specialist you don't recognize, assign them the closest research or analysis angle.
Always ensure at minimum these angles are covered even if the same agent covers multiple:
- Market / competitive landscape
- User / UX perspective
- Growth / acquisition
- Business operations / process
- Technical feasibility (at least one engineering-category agent)

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
  monotask card set-description "${BOARD_ID}" "$CARD_ID" "<2-3 sentence description>"
  monotask card comment add "${BOARD_ID}" "$CARD_ID" "CATEGORY: <feature | technical-baseline | business-operation>
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

Parse the `IDEAS_OUTPUT` JSON block from the agent's response and assign it:
```bash
ideas_output_json='<paste the JSON array from IDEAS_OUTPUT here>'
```
If zero ideas were returned, report "Idea Manager produced no ideas." and STOP.

---

### Step 5 — Validation (Product Manager Evaluation)

**Build `ideas_list` before constructing the Step 5 Task prompt:**
```bash
# Format the full IDEAS_OUTPUT array (from Step 4) as the literal string to embed in the Task prompt.
# Each line: card_id | title | description | category | source_angle
ideas_list=$(echo "$ideas_output_json" | jq -r \
  '.[] | "- card_id: \(.card_id)\n  title: \(.title)\n  description: \(.description)\n  category: \(.category)\n  source: \(.source_angle)\n"')
```

**CRITICAL — Variable substitution required for Step 5 Task call:**
Before constructing the Task prompt below, read the literal UUID values from the `=== IDEA BOARD LITERAL VALUES ===` echo block (Step 3) and embed them as hard-coded strings. Also embed the full `brain_context`, `prompt`, and `ideas_list` (built above) as literal text. Replace every `${BOARD_ID}`, `${COL_EVALUATED}`, `${COL_ICED}`, `${COL_REJECTED}`, `${brain_context}`, `${prompt}`, `${project_name}`, `${date}`, and `${ideas_list}` with its actual value before calling Task — the agent receives unsubstituted `${...}` strings verbatim and silently skips every board update.

Spawn a single `Product Manager` agent via the Task tool. The PM agent has Bash tool access and is responsible for both producing verdicts and executing all board updates directly.

```javascript
Task({
  subagent_type: "Product Manager",
  description: "PM validation for project " + project_name,
  run_in_background: false,
  prompt: `SAFETY CHECK: Verify that the BOARD_ID you received matches UUID format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (8-4-4-4-12 hex chars). If it does not, STOP and report "ERROR: BOARD_ID not substituted — received: <value>". Do NOT call monotask board create, space create, or column create. Your only job is evaluating cards and running impact/effort updates on existing cards.

You are the Product Manager evaluator for project "${project_name}".

CONTEXT: ${date} | Project: ${project_name}
ORIGINAL GOAL: ${prompt}

BRAIN CONTEXT:
${brain_context}

YOUR BOARD: ${BOARD_ID}
COL_EVALUATED: ${COL_EVALUATED}
COL_ICED:      ${COL_ICED}
COL_REJECTED:  ${COL_REJECTED}

IDEAS TO EVALUATE (formatted from IDEAS_OUTPUT parsed in Step 4 — paste the full JSON array here as literal text):
${ideas_list}

For EVERY idea above, determine:
- verdict: evaluated | iced | rejected
- impact: 0–10 (business value / strategic importance)
- effort: 0–10 (implementation cost / complexity)
- skipElaboration: true (simple, no deep research needed) | false (edge cases should be explored) — only for evaluated
- rationale: 1-2 sentence value statement (evaluated), blocking question (iced), or rejection reason (rejected)

MANDATORY BOARD UPDATES — run these bash commands for EVERY idea, no exceptions:

For evaluated ideas:
  monotask card move "${BOARD_ID}" "<CARD_ID>" "${COL_EVALUATED}" --json
  monotask card set-impact "${BOARD_ID}" "<CARD_ID>" <impact>
  monotask card set-effort "${BOARD_ID}" "<CARD_ID>" <effort>
  monotask card comment add "${BOARD_ID}" "<CARD_ID>" "Value: <rationale>"

For iced ideas:
  monotask card move "${BOARD_ID}" "<CARD_ID>" "${COL_ICED}" --json
  monotask card set-impact "${BOARD_ID}" "<CARD_ID>" <impact>
  monotask card set-effort "${BOARD_ID}" "<CARD_ID>" <effort>
  monotask card comment add "${BOARD_ID}" "<CARD_ID>" "Blocked: <blocking question>"

For rejected ideas:
  monotask card move "${BOARD_ID}" "<CARD_ID>" "${COL_REJECTED}" --json
  monotask card comment add "${BOARD_ID}" "<CARD_ID>" "Rejected: <reason>"

IMPORTANT: set-impact and set-effort MUST be called for every evaluated and iced idea. Do not skip them.

After completing all board updates, output this structured block:

VERDICTS_OUTPUT
[
  {
    "card_id": "<card ID>",
    "title": "<idea title>",
    "category": "feature | technical-baseline | business-operation",
    "verdict": "evaluated | iced | rejected",
    "skipElaboration": true | false,
    "rationale": "<value statement | blocking question | rejection reason>",
    "impact": <0-10>,
    "effort": <0-10>
  }
]
END_VERDICTS_OUTPUT`
})
```

After the PM agent completes, parse the `VERDICTS_OUTPUT` block from the agent's response and assign it:
```bash
verdicts_output_json='<paste the JSON array from VERDICTS_OUTPUT here>'
```
This variable is used throughout Steps 6a and 6c to build idea lists, registry keywords, and inherit impact/effort scores — it must be set before proceeding. If **all** ideas are iced or rejected, output a summary table and STOP — skip Steps 6–7.

---

### Step 6 — Elaboration + Task Decomposition

#### 6a. Elaboration (conditional)

For any evaluated idea with `skipElaboration: true`, move it directly to `Elaborated`, set a description, and write a rationale comment so future readers understand why no deep elaboration was needed:
```bash
monotask card set-description "$BOARD_ID" "$CARD_ID" "Elaboration skipped — PM assessed this as straightforward.\n\nRationale: <rationale from VERDICTS_OUTPUT for this card_id>\n\nImpact: <impact>/10 | Effort: <effort>/10"
monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ELABORATED" --json
monotask card comment add "$BOARD_ID" "$CARD_ID" "Elaboration skipped: PM assessed this idea as straightforward with no significant unknowns. Rationale: <rationale from VERDICTS_OUTPUT for this card_id>"
```

For ideas with `skipElaboration: false`, **split by category** before spawning agents:

**Build `dev_ideas_list` and `ops_ideas_list` before constructing the Step 6a Task prompts:**
```bash
# Filter VERDICTS_OUTPUT (parsed in Step 5) by category and format as literal text.
dev_ideas_list=$(echo "$verdicts_output_json" | jq -r \
  '.[] | select(.verdict == "evaluated") | select(.category == "feature" or .category == "technical-baseline") |
   "- card_id: \(.card_id)\n  title: \(.title)\n  category: \(.category)\n  rationale: \(.rationale)\n"')

ops_ideas_list=$(echo "$verdicts_output_json" | jq -r \
  '.[] | select(.verdict == "evaluated") | select(.category == "business-operation") |
   "- card_id: \(.card_id)\n  title: \(.title)\n  category: \(.category)\n  rationale: \(.rationale)\n"')
```

**CRITICAL — Variable substitution required for Step 6a Task calls:**
Elaboration agents run in isolated Task contexts. Before constructing each Task prompt, replace every `${brain_context}`, `${dev_ideas_list}`, and `${ops_ideas_list}` with the actual literal text — `brain_context` from the brain load, `dev_ideas_list` and `ops_ideas_list` built above. Do NOT leave any `${...}` placeholders in the prompt — the agent receives them as literal dollar-sign strings and produces empty ELABORATION_OUTPUT blocks.

**Dev ideas** (`feature` or `technical-baseline`):
Spawn two agents in parallel via Task tool:

```javascript
// Agent 1 — code explorer
Task({
  subagent_type: "feature-dev:code-explorer",
  description: "Elaboration: codebase constraints for dev ideas",
  run_in_background: true,
  prompt: `SAFETY CHECK: You are an elaboration agent. Do NOT call monotask board create, space create, or column create. Your only job is producing an ELABORATION_OUTPUT block — the outer skill writes to the board.

Analyze the following dev ideas against the current codebase. For each idea, trace relevant execution paths, map dependencies, and surface constraints or implementation risks.

BRAIN CONTEXT:
${brain_context}

IDEAS:
${dev_ideas_list}

Output this block:
ELABORATION_OUTPUT
[
  {
    "card_id": "<idea card ID>",
    "findings": "<detailed codebase constraints, dependency risks, and implementation notes>",
    "blocking_issue": "<blocking issue if any, or null>"
  }
]
END_ELABORATION_OUTPUT`
})

// Agent 2 — researcher
Task({
  subagent_type: "researcher",
  description: "Elaboration: prior art and edge cases for dev ideas",
  run_in_background: true,
  prompt: `SAFETY CHECK: You are an elaboration agent. Do NOT call monotask board create, space create, or column create. Your only job is producing an ELABORATION_OUTPUT block — the outer skill writes to the board.

Research the following dev ideas. For each idea, find prior art, known edge cases, implementation pitfalls, and relevant open-source approaches.

BRAIN CONTEXT:
${brain_context}

IDEAS:
${dev_ideas_list}

Output this block:
ELABORATION_OUTPUT
[
  {
    "card_id": "<idea card ID>",
    "findings": "<prior art, edge cases, pitfalls, and relevant examples>",
    "blocking_issue": "<blocking issue if any, or null>"
  }
]
END_ELABORATION_OUTPUT`
})
```

**Business-operation ideas** (`business-operation`):
Spawn two agents in parallel via Task tool:

```javascript
// Agent 1 — researcher
Task({
  subagent_type: "researcher",
  description: "Elaboration: industry benchmarks for ops ideas",
  run_in_background: true,
  prompt: `SAFETY CHECK: You are an elaboration agent. Do NOT call monotask board create, space create, or column create. Your only job is producing an ELABORATION_OUTPUT block — the outer skill writes to the board.

Research the following business-operation ideas. For each idea, find industry benchmarks, comparable operational processes, known pitfalls, and market context.

BRAIN CONTEXT:
${brain_context}

IDEAS:
${ops_ideas_list}

Output this block:
ELABORATION_OUTPUT
[
  {
    "card_id": "<idea card ID>",
    "findings": "<industry benchmarks, comparable processes, pitfalls, and market context>",
    "blocking_issue": "<blocking issue if any, or null>"
  }
]
END_ELABORATION_OUTPUT`
})

// Agent 2 — Product Manager
Task({
  subagent_type: "Product Manager",
  description: "Elaboration: feasibility assessment for ops ideas",
  run_in_background: true,
  prompt: `SAFETY CHECK: You are an elaboration agent. Do NOT call monotask board create, space create, or column create. Your only job is producing an ELABORATION_OUTPUT block — the outer skill writes to the board.

Assess the following business-operation ideas for process feasibility, stakeholder impact, alignment with existing workflows, and resource requirements.

BRAIN CONTEXT:
${brain_context}

IDEAS:
${ops_ideas_list}

Output this block:
ELABORATION_OUTPUT
[
  {
    "card_id": "<idea card ID>",
    "findings": "<feasibility assessment, stakeholder impact, workflow alignment, resource needs>",
    "blocking_issue": "<blocking issue if any, or null>"
  }
]
END_ELABORATION_OUTPUT`
})
```

Wait for all background agents to complete (do not proceed until all — or two, if only one category — return ELABORATION_OUTPUT blocks). Then build `merged_elaboration_json` by merging agent outputs per `card_id` and injecting `category` from `verdicts_output_json`:

```bash
# Assign each agent's ELABORATION_OUTPUT JSON array from its output block:
dev_researcher_json='<ELABORATION_OUTPUT array from the dev researcher agent>'
dev_codebase_json='<ELABORATION_OUTPUT array from the dev code-explorer agent>'
ops_researcher_json='<ELABORATION_OUTPUT array from the ops researcher agent>'
ops_pm_json='<ELABORATION_OUTPUT array from the ops PM agent>'
# Use '[]' for any track that had no ideas (e.g. if all ideas were dev, set ops_* to '[]')

# Merge dev track: join researcher + codebase findings by card_id, inject category from verdicts
dev_merged=$(jq -n \
  --argjson r "$dev_researcher_json" \
  --argjson c "$dev_codebase_json" \
  --argjson v "$verdicts_output_json" \
  '[$r[] | {card_id: .card_id, blocking_issue: .blocking_issue,
     researcher_findings: .findings,
     codebase_findings: ([$c[] | select(.card_id == .card_id)] | first | .findings // ""),
     category: ([$v[] | select(.card_id == .card_id)] | first | .category // "feature")}]')

# Merge ops track: join researcher + PM findings by card_id, inject category
ops_merged=$(jq -n \
  --argjson r "$ops_researcher_json" \
  --argjson p "$ops_pm_json" \
  --argjson v "$verdicts_output_json" \
  '[$r[] | {card_id: .card_id, blocking_issue: .blocking_issue,
     researcher_findings: .findings,
     pm_findings: ([$p[] | select(.card_id == .card_id)] | first | .findings // ""),
     category: ([$v[] | select(.card_id == .card_id)] | first | .category // "business-operation")}]')

# Combine both tracks
merged_elaboration_json=$(jq -s 'add' <(echo "$dev_merged") <(echo "$ops_merged"))
```

Use process substitution (not a pipeline) so the while loop runs in the main shell and variables remain in scope after `done`:

```bash
while IFS= read -r idea; do
  CARD_ID=$(echo "$idea"        | jq -r '.card_id')
  category=$(echo "$idea"       | jq -r '.category')
  blocking_issue=$(echo "$idea" | jq -r '.blocking_issue // empty')

  if [ "$category" = "business-operation" ]; then
    researcher_findings=$(echo "$idea" | jq -r '.researcher_findings')
    pm_findings=$(echo "$idea"         | jq -r '.pm_findings')
    monotask card set-description "$BOARD_ID" "$CARD_ID" "## Elaboration Findings

### Industry context & benchmarks:
$researcher_findings

### Feasibility & stakeholder impact:
$pm_findings"
    monotask card comment add "$BOARD_ID" "$CARD_ID" "Industry context & benchmarks: $researcher_findings"
    monotask card comment add "$BOARD_ID" "$CARD_ID" "Feasibility & stakeholder impact: $pm_findings"
  else
    researcher_findings=$(echo "$idea" | jq -r '.researcher_findings')
    codebase_findings=$(echo "$idea"   | jq -r '.codebase_findings')
    monotask card set-description "$BOARD_ID" "$CARD_ID" "## Elaboration Findings

### Edge cases & prior art:
$researcher_findings

### Codebase constraints:
$codebase_findings"
    monotask card comment add "$BOARD_ID" "$CARD_ID" "Edge cases & prior art: $researcher_findings"
    monotask card comment add "$BOARD_ID" "$CARD_ID" "Codebase constraints: $codebase_findings"
  fi

  if [ -n "$blocking_issue" ]; then
    monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ICED" --json
    monotask card comment add "$BOARD_ID" "$CARD_ID" "Blocked during elaboration: $blocking_issue"
  else
    monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ELABORATED" --json
  fi
done < <(echo "$merged_elaboration_json" | jq -c '.[]')
```

#### 6b. User Confirmation Gate

**Auto-mode bypass:** If `mode` is `auto` (set by mastermind:master or caller), skip this gate entirely and proceed directly to Step 6c with all elaborated ideas.

**Confirm mode only:** If `mode` is `confirm` (default), present a review table of all elaborated ideas to the user.

Build the table from `verdicts_output_json` (filtered to `verdict == "evaluated"`). For each row:
- **Impact** and **Effort** come from `.impact` and `.effort` fields in `verdicts_output_json`
- **Track**: `feature` or `technical-baseline` → `dev`; `business-operation` → `ops`

Print this exact format:

```
╔══════════════════════════════════════════════════════════════════════╗
║  IDEA REVIEW — Please confirm before task generation                ║
╚══════════════════════════════════════════════════════════════════════╝

#  | Title                          | Category          | Impact | Effort | Track
---|--------------------------------|-------------------|--------|--------|-------
1  | <title>                        | <category>        | <N>/10 | <N>/10 | dev / ops
2  | <title>                        | <category>        | <N>/10 | <N>/10 | dev / ops
...

To proceed: reply with one of:
  • "go" — generate tasks for all ideas above
  • "remove 2,4" — drop ideas by number, generate tasks for the rest
  • "remove 3 | add detail to 1: <your notes>" — remove some, annotate others
  • "add detail to 2: <your notes>" — annotate an idea before decomposing
  • "stop" — cancel task generation

Waiting for your confirmation.
```

Wait for the user's response before continuing. Do not spawn any agents until a reply is received.

**Process the user's reply:**

- **"go"**: proceed with all elaborated ideas.
- **"remove N[,N...]"**: remove those ideas from the elaboration list. Move their ideation cards to `Iced`:
  ```bash
  monotask card comment add "$BOARD_ID" "$CARD_ID" "Removed by user before task generation"
  monotask card move "$BOARD_ID" "$CARD_ID" "$COL_ICED" --json
  ```
- **"add detail to N: <notes>"**: append the notes as a card comment before decomposing:
  ```bash
  monotask card comment add "$BOARD_ID" "$CARD_ID" "User notes: <notes>"
  ```
- **"stop"**: skip Step 6c and Step 7. Print a summary of ideas in Elaborated/Iced/Rejected and return `status: partial`.
- Combined instructions ("remove 2,4 | add detail to 1: ...") are processed together.

After applying all user instructions, proceed to Step 6c with the remaining ideas.

---

#### 6c. Task Decomposition

**Select decomposition agents from the registry** before spawning. Run this selection once per track:

```bash
REGISTRY=".monomind/registry.json"

# Dev decomposition agent — pick the most relevant engineering/architecture specialist
# Build keyword signal from elaborated dev idea titles (from VERDICTS_OUTPUT filtered above)
DEV_IDEA_CONTEXT=$(echo "$verdicts_output_json" | jq -r \
  '[.[] | select(.verdict=="evaluated") | select(.category=="feature" or .category=="technical-baseline") | .title] | join(" ")')
dev_decomp_agent=$(jq -r \
  --arg kw "$(echo "$DEV_IDEA_CONTEXT" | tr '[:upper:]' '[:lower:]' | grep -oE '[a-z]{5,}' | sort -u | tr '\n' ' ')" \
  '[ .agents[] | select(.deprecated != true)
     | select(.category == "engineering" or .category == "architecture")
     | {name: .name,
        score: (.name | ascii_downcase |
                if contains("architect") then 3
                elif contains("backend") then 2
                elif contains("mobile") then 2
                elif contains("frontend") then 2
                elif contains("security") then 2
                elif contains("data") then 2
                else 1 end
               )}
   ] | sort_by(-.score) | .[0].name // "Software Architect"' \
  "$REGISTRY" 2>/dev/null)
dev_decomp_agent="${dev_decomp_agent:-Software Architect}"

# Ops decomposition agent — pick the most relevant strategy/sales/product specialist
OPS_IDEA_CONTEXT=$(echo "$verdicts_output_json" | jq -r \
  '[.[] | select(.verdict=="evaluated") | select(.category=="business-operation") | .title] | join(" ")')
ops_decomp_agent=$(jq -r \
  --arg kw "$(echo "$OPS_IDEA_CONTEXT" | tr '[:upper:]' '[:lower:]' | grep -oE '[a-z]{5,}' | sort -u | tr '\n' ' ')" \
  '[ .agents[] | select(.deprecated != true)
     | select(.category == "strategy" or .category == "sales" or .category == "product" or .category == "marketing")
     | {name: .name,
        score: (.name | ascii_downcase |
                if contains("product manager") then 4
                elif contains("launch") then 3
                elif contains("outbound") then 3
                elif contains("deal") then 3
                elif contains("pricing") then 3
                elif contains("growth") then 2
                else 1 end
               )}
   ] | sort_by(-.score) | .[0].name // "Product Manager"' \
  "$REGISTRY" 2>/dev/null)
ops_decomp_agent="${ops_decomp_agent:-Product Manager}"

echo "Dev decomp: $dev_decomp_agent | Ops decomp: $ops_decomp_agent"
```

**CRITICAL — Variable substitution required for Step 6c Task calls:**
Before constructing each Task prompt, replace `${brain_context}`, `${prompt}`, `${project_name}`, `${dev_ideas_elaborated}`, and `${ops_ideas_elaborated}` with actual literal text. Also substitute the `subagent_type` values: replace `dev_decomp_agent` and `ops_decomp_agent` with the string values echoed by the registry selection above (e.g. `"Software Architect"`). Build those lists from the VERDICTS_OUTPUT and ELABORATION_OUTPUT results:

```bash
# Build elaborated idea lists including card comments (full context for decomposition agents)
dev_ideas_elaborated=$(echo "$verdicts_output_json" | jq -r \
  '[.[] | select(.verdict=="evaluated") | select(.category=="feature" or .category=="technical-baseline") |
   "card_id: \(.card_id)\ntitle: \(.title)\ncategory: \(.category)\nrationale: \(.rationale)\nimpact: \(.impact) effort: \(.effort)"] | join("\n\n")')

ops_ideas_elaborated=$(echo "$verdicts_output_json" | jq -r \
  '[.[] | select(.verdict=="evaluated") | select(.category=="business-operation") |
   "card_id: \(.card_id)\ntitle: \(.title)\ncategory: \(.category)\nrationale: \(.rationale)\nimpact: \(.impact) effort: \(.effort)"] | join("\n\n")')
```

**Spawn decomposition agents by track** — run both in parallel if both tracks have elaborated ideas:

```javascript
// Dev decomposition agent (only if dev_ideas_elaborated is non-empty)
Task({
  subagent_type: dev_decomp_agent,  // value from registry selection above
  description: "Task decomposition: dev ideas for " + project_name,
  run_in_background: true,
  prompt: `SAFETY CHECK: You are a decomposition agent. You must NOT call monotask board create, space create, or column create. Your only job is producing a TASKS_OUTPUT block — the outer skill creates the cards. If you are unsure of any card ID, list it as "UNKNOWN" rather than inventing a value.

Decompose the following dev ideas into concrete subtasks (2–6 per idea). Each subtask should be independently implementable.

PROJECT: ${project_name}
GOAL: ${prompt}

BRAIN CONTEXT:
${brain_context}

DEV IDEAS TO DECOMPOSE:
${dev_ideas_elaborated}

For each idea, produce 2–6 subtasks. If an idea's scope is unclear, flag it in FLAGGED instead of decomposing.

TASKS_OUTPUT
[
  {
    "parent_card_id": "<ideation board card ID from the list above>",
    "title": "<subtask title ≤80 chars>",
    "description": "<what to build/do — specific and actionable>",
    "category": "feature | technical-baseline",
    "agent": "<recommended subagent_type>",
    "effort": <1-10>,
    "has_prerequisites": <true | false>
  }
]
FLAGGED
[
  { "card_id": "<ideation card ID>", "question": "<what needs clarifying>" }
]
END_TASKS_OUTPUT`
})

// Ops decomposition agent (only if ops_ideas_elaborated is non-empty)
Task({
  subagent_type: ops_decomp_agent,  // value from registry selection above
  description: "Task decomposition: ops ideas for " + project_name,
  run_in_background: true,
  prompt: `SAFETY CHECK: You are a decomposition agent. You must NOT call monotask board create, space create, or column create. Your only job is producing a TASKS_OUTPUT block — the outer skill creates the cards. If you are unsure of any card ID, list it as "UNKNOWN" rather than inventing a value.

Decompose the following business-operation ideas into concrete subtasks (2–6 per idea). Each subtask should be independently actionable.

PROJECT: ${project_name}
GOAL: ${prompt}

BRAIN CONTEXT:
${brain_context}

OPS IDEAS TO DECOMPOSE:
${ops_ideas_elaborated}

For each idea, produce 2–6 subtasks. If an idea's scope is unclear, flag it in FLAGGED instead of decomposing.

TASKS_OUTPUT
[
  {
    "parent_card_id": "<ideation board card ID from the list above>",
    "title": "<subtask title ≤80 chars>",
    "description": "<what to build/do — specific and actionable>",
    "category": "business-operation",
    "agent": "<recommended subagent_type>",
    "effort": <1-10>,
    "has_prerequisites": <true | false>
  }
]
FLAGGED
[
  { "card_id": "<ideation card ID>", "question": "<what needs clarifying>" }
]
END_TASKS_OUTPUT`
})
```

**After both decomposition agents return**, the outer skill creates task cards on the appropriate board for each task's category. Each task card inherits the parent idea's `impact` and `effort` scores from the VERDICTS_OUTPUT parsed in Step 5 — look up by `parent_card_id`.

---

**Dev task board** (`feature` / `technical-baseline` → `Implementation Tasks`):

Canonical board name: `${project_name}-tasks-dev`. Find-or-create:

```bash
dev_task_canonical="${project_name}-tasks-dev"
TASK_BOARD_ID=$(monotask board list 2>/dev/null | awk -F'|' '{gsub(/^ +| +$/,"",$1);gsub(/^ +| +$/,"",$2);if($2==n)print $1}' n="$dev_task_canonical" | head -1)
if [ -n "$TASK_BOARD_ID" ]; then
  echo "Reusing dev task board: $TASK_BOARD_ID ($dev_task_canonical)"
  task_columns=$(monotask column list "$TASK_BOARD_ID" --json)
  TASK_COL_TODO=$(echo "$task_columns"    | jq -r '.[] | select(.title=="Todo")           | .id' | head -1)
  TASK_COL_BACKLOG=$(echo "$task_columns" | jq -r '.[] | select(.title=="Backlog")        | .id' | head -1)
else
  echo "Creating dev task board: $dev_task_canonical"
  TASK_BOARD_ID=$(monotask board create --space "$space_id" "$dev_task_canonical" --json 2>/dev/null | jq -r '.id // empty')
  [ -z "$TASK_BOARD_ID" ] && { echo "ERROR: Failed to create dev task board"; exit 1; }
  monotask space boards add "$space_id" "$TASK_BOARD_ID" >/dev/null 2>&1 || true
  TASK_COL_BACKLOG=$(monotask column create "$TASK_BOARD_ID" "Backlog"       --json | jq -r '.id')
  TASK_COL_TODO=$(monotask column create "$TASK_BOARD_ID"    "Todo"          --json | jq -r '.id')
  monotask column create "$TASK_BOARD_ID" "In Progress"   --json >/dev/null
  monotask column create "$TASK_BOARD_ID" "Human in Loop" --json >/dev/null
  monotask column create "$TASK_BOARD_ID" "Review"        --json >/dev/null
  monotask column create "$TASK_BOARD_ID" "Done"          --json >/dev/null
  monotask column create "$TASK_BOARD_ID" "Cancelled"     --json >/dev/null
fi
[ -z "$TASK_BOARD_ID" ]    && { echo "ERROR: TASK_BOARD_ID empty — aborting"; exit 1; }
[ -z "$TASK_COL_TODO" ]    && { echo "ERROR: Could not find Todo column on dev task board"; exit 1; }
```

---

**Ops task board** (`business-operation` → `Operations Tasks`):

Canonical board name: `${project_name}-tasks-ops`. Find-or-create:

```bash
ops_task_canonical="${project_name}-tasks-ops"
OPS_BOARD_ID=$(monotask board list 2>/dev/null | awk -F'|' '{gsub(/^ +| +$/,"",$1);gsub(/^ +| +$/,"",$2);if($2==n)print $1}' n="$ops_task_canonical" | head -1)
if [ -n "$OPS_BOARD_ID" ]; then
  echo "Reusing ops task board: $OPS_BOARD_ID ($ops_task_canonical)"
  ops_columns=$(monotask column list "$OPS_BOARD_ID" --json)
  OPS_COL_TODO=$(echo "$ops_columns"    | jq -r '.[] | select(.title=="Todo")    | .id' | head -1)
  OPS_COL_BACKLOG=$(echo "$ops_columns" | jq -r '.[] | select(.title=="Backlog") | .id' | head -1)
else
  echo "Creating ops task board: $ops_task_canonical"
  OPS_BOARD_ID=$(monotask board create --space "$space_id" "$ops_task_canonical" --json 2>/dev/null | jq -r '.id // empty')
  [ -z "$OPS_BOARD_ID" ] && { echo "ERROR: Failed to create ops task board"; exit 1; }
  monotask space boards add "$space_id" "$OPS_BOARD_ID" >/dev/null 2>&1 || true
  OPS_COL_BACKLOG=$(monotask column create "$OPS_BOARD_ID" "Backlog"       --json | jq -r '.id')
  OPS_COL_TODO=$(monotask column create "$OPS_BOARD_ID"    "Todo"          --json | jq -r '.id')
  monotask column create "$OPS_BOARD_ID" "In Progress"   --json >/dev/null
  monotask column create "$OPS_BOARD_ID" "Human in Loop" --json >/dev/null
  monotask column create "$OPS_BOARD_ID" "Review"        --json >/dev/null
  monotask column create "$OPS_BOARD_ID" "Done"          --json >/dev/null
  monotask column create "$OPS_BOARD_ID" "Cancelled"     --json >/dev/null
fi
[ -z "$OPS_BOARD_ID" ]    && { echo "ERROR: OPS_BOARD_ID empty — aborting"; exit 1; }
[ -z "$OPS_COL_TODO" ]    && { echo "ERROR: Could not find Todo column on ops task board"; exit 1; }
```

---

**Assign TASKS_OUTPUT from each decomposition agent, then merge and iterate:**

```bash
# Parse the TASKS_OUTPUT block from the dev decomp agent's response and assign:
dev_tasks_json='<TASKS_OUTPUT JSON array from dev decomp agent, or [] if no dev ideas>'
# Parse the TASKS_OUTPUT block from the ops decomp agent's response and assign:
ops_tasks_json='<TASKS_OUTPUT JSON array from ops decomp agent, or [] if no ops ideas>'

merged_tasks_json=$(jq -s 'add' <(echo "$dev_tasks_json") <(echo "$ops_tasks_json"))

# Use process substitution (not a pipeline) so variables set inside the loop
# remain in scope after done — needed for the parent-annotation step below.
# Also initialise the subtask-accumulator map before the loop.
declare -A parent_subtask_summaries  # parent_card_id -> newline-separated task summary lines

while IFS= read -r task; do
  parent_card_id=$(echo "$task"    | jq -r '.parent_card_id')
  title=$(echo "$task"             | jq -r '.title')
  description=$(echo "$task"       | jq -r '.description')
  category=$(echo "$task"          | jq -r '.category')
  agent=$(echo "$task"             | jq -r '.agent')
  task_effort=$(echo "$task"       | jq -r '.effort')
  has_prerequisites=$(echo "$task" | jq -r '.has_prerequisites')

  if [ "$category" = "business-operation" ]; then
  TARGET_BOARD="$OPS_BOARD_ID"
  COL_TARGET=$([ "$has_prerequisites" = "true" ] && echo "$OPS_COL_BACKLOG" || echo "$OPS_COL_TODO")
  BOARD_LABEL="Operations Tasks"
else
  TARGET_BOARD="$TASK_BOARD_ID"
  COL_TARGET=$([ "$has_prerequisites" = "true" ] && echo "$TASK_COL_BACKLOG" || echo "$TASK_COL_TODO")
  BOARD_LABEL="Implementation Tasks"
fi

# Inherit impact and effort from parent idea — look up from verdicts_output_json by parent_card_id
parent_impact=$(echo "$verdicts_output_json" | jq -r --arg id "$parent_card_id" '.[] | select(.card_id == $id) | .impact // 5')
parent_effort=$(echo "$verdicts_output_json" | jq -r --arg id "$parent_card_id" '.[] | select(.card_id == $id) | .effort // 5')
# Default to 5 if lookup returned empty (e.g. parent_card_id was "UNKNOWN")
[ -z "$parent_impact" ] && parent_impact=5
[ -z "$parent_effort" ] && parent_effort=5

# Create task card as a proper subtask of the parent idea card (cross-board link)
# Signature: subtask add <PARENT_BOARD_ID> <PARENT_CARD_ID> <CHILD_BOARD_ID> <COL_ID> <TITLE>
TASK_CARD_ID=$(monotask card subtask add "$BOARD_ID" "$parent_card_id" "$TARGET_BOARD" "$COL_TARGET" "<task title>" --json | jq -r '.id')
# Set the task description as the primary content field
monotask card set-description "$TARGET_BOARD" "$TASK_CARD_ID" "<what to build/do — from TASKS_OUTPUT description>"
monotask card set-impact "$TARGET_BOARD" "$TASK_CARD_ID" "$parent_impact"
monotask card set-effort "$TARGET_BOARD" "$TASK_CARD_ID" "$parent_effort"
monotask card comment add "$TARGET_BOARD" "$TASK_CARD_ID" \
  "SOURCE: mastermind:idea | <first 100 chars of prompt>
AGENT: <agent>
TASK EFFORT: <task_effort>/10
PARENT IDEA IMPACT: <parent_impact>/10  PARENT IDEA EFFORT: <parent_effort>/10
CATEGORY: <category>
PARENT IDEA: <idea title> (card: <parent_card_id> on ideation board)"
monotask card label add "$TARGET_BOARD" "$TASK_CARD_ID" "mastermind:idea"
monotask card label add "$TARGET_BOARD" "$TASK_CARD_ID" "category:$category"

# Accumulate subtask summary for this parent (used in the post-loop annotation step)
parent_subtask_summaries[$parent_card_id]+="  - $title (agent: $agent, effort: $task_effort/10, board: $BOARD_LABEL)\n"

done < <(echo "$merged_tasks_json" | jq -c '.[]')
```

After the loop, annotate each parent idea card and move it to `Tasked`:
```bash
for parent_card_id in "${!parent_subtask_summaries[@]}"; do
  subtask_list="${parent_subtask_summaries[$parent_card_id]}"
  monotask card comment add "$BOARD_ID" "$parent_card_id" \
    "Subtasks created:\n${subtask_list}"
  monotask card move "$BOARD_ID" "$parent_card_id" "$COL_TASKED" --json
done
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
board_url: "monotask://<project_name>/Ideas & Innovation"
task_board_url: "monotask://<project_name>/Implementation Tasks"
ops_task_board_url: "monotask://<project_name>/Operations Tasks"
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
