---
name: mastermind-content
description: Mastermind content domain — blog posts, threads, docs, newsletters. Spawns a Content Manager who runs a ring pipeline (research→draft→edit→publish) for polished output.
type: domain-skill
default_mode: confirm
---

# Mastermind Content Domain

This skill is invoked by `mastermind:master` or directly via `/mastermind:content`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via _protocol.md brain load)
- `prompt`: the content goal for this run
- `project_name`: monotask space name
- `board_id`: monotask board ID (set by master, or created standalone)
- `mode`: auto | confirm

---

## Reference Library

Before generating or editing any prose, identify which reference files apply and inject them into the agent briefing.

| Reference | When to include |
|---|---|
| `.claude/skills/stop-slop/SKILL.md` | Stage 3 (Edit) and Stage 4 (Review) — not Draft |
| `.claude/skills/stop-slop/references/phrases.md` | Full edit pass — check for banned phrases |
| `.claude/skills/stop-slop/references/structures.md` | Full edit pass — check structural patterns |
| `.claude/skills/stop-slop/references/examples.md` | When the agent needs before/after context |

In each Edit/Review stage briefing (Stage 3), add:
```
REFERENCE FILES: Read these before editing:
- .claude/skills/stop-slop/SKILL.md
- .claude/skills/stop-slop/references/phrases.md
- .claude/skills/stop-slop/references/structures.md
```

---

## Complexity Assessment

Assess the prompt to determine execution mode:

**Simple (direct execution):** Single short piece, one agent:
- "Write a one-paragraph product description"
- "Draft a 280-character tweet about the release"
→ Use a single Content Creator agent. Skip manager delegation.

**Complex (spawn Content Manager agent):** Any of these:
- Blog post or article (research + draft + edit)
- Newsletter issue requiring multiple sections
- Documentation rewrite or new doc set
- Thread series across multiple posts
- Content requiring subject matter research before writing
→ Spawn Content Manager agent with ring pipeline.

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `content`)
2. Run intake from _intake.md if prompt is vague
3. Follow _protocol.md Monotask Space+Board Setup Procedure:
   ```bash
   project_name="${project_name:-$(basename "$PWD")}"
   space_id=$(monotask space list 2>/dev/null | awk -F' \| ' -v n="$project_name" '$2==n{print $1}' | head -1)
   [ -z "$space_id" ] && space_id=$(monotask space create "$project_name" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
   [ -z "$space_id" ] && { echo "ERROR: Could not find or create space '$project_name'"; exit 1; }
   board_id=$(monotask board create "content" --json | jq -r '.id // empty')
   [ -z "$board_id" ] && { echo "ERROR: Failed to create content board"; exit 1; }
   monotask space boards add "$space_id" "$board_id" >/dev/null 2>&1 || true
   todo_col=$(monotask column create "$board_id" "Todo"  --json | jq -r '.id')
   doing_col=$(monotask column create "$board_id" "Doing" --json | jq -r '.id')
   done_col=$(monotask column create "$board_id" "Done"  --json | jq -r '.id')
   ```
4. Proceed with complexity assessment below
5. At end: follow _protocol.md Brain Write Procedure (namespace: `content`)

---

## Complex Execution — Content Manager Agent

Spawn a Content Manager agent via Task tool:

```javascript
Task({
  subagent_type: "coordinator",
  description: `You are the Content Manager for project <project_name>.

CONTEXT: <date> | Project: <project_name> | Spawned by: mastermind:content

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <board_id>
YOUR GOAL: <prompt>

STEP 1 — PLAN
Decompose content production into sequential pipeline stages. The ring topology means output from each stage feeds the next:
Stage 1: Research — gather facts, sources, angles
Stage 2: Draft — produce first draft from research
Stage 3: Edit — refine, fact-check, tone-align
Stage 4: Format — structure for target platform

Identify for each stage:
- What input it receives from the prior stage
- What deliverable it produces
- Which specialist handles it

STEP 2 — CREATE TASKS
For each pipeline stage, create a monotask card on the project board.
First look up column IDs and assign shell variables:
```bash
columns=$(monotask column list "$BOARD_ID" --json)
COL_TODO_ID=$(echo "$columns" | jq -r '.[] | select(.title == "Todo" or .title == "Backlog") | .id' | head -1)
COL_DONE_ID=$(echo "$columns" | jq -r '.[] | select(.title == "Done") | .id' | head -1)
```
Then create the card:
```bash
result=$(monotask card create "$BOARD_ID" "$COL_TODO_ID" "<short summary of pipeline stage goal, ≤80 chars>" --json)
CARD_ID=$(echo "$result" | jq -r '.id // empty')
monotask card set-description "$BOARD_ID" "$CARD_ID" "[this stage's specific production goal]"
monotask card comment add "$BOARD_ID" "$CARD_ID" "CONTEXT: <date> | Project: <project_name> | Created by: Content Manager
BRAIN MEMORY: [paste most relevant 3-5 brain context excerpts]
SCOPE: [content type, target audience, platform, word count, tone]
CONSTRAINTS: [brand voice, SEO requirements, factual accuracy standards, style guide]
REFERENCE FILES: [for Stage 3 edit only: .claude/skills/stop-slop/SKILL.md, .claude/skills/stop-slop/references/phrases.md, .claude/skills/stop-slop/references/structures.md]
SUCCESS CRITERIA:
- [ ] [checkable item]
AGENT: [researcher | Content Creator | Technical Writer | Code Reviewer (as editor)]
SWARM: ring 4 raft pipeline
DEPENDENCIES: [prior stage task ID — pipeline is sequential]
OUTPUT FORMAT: unified output schema"
```

STEP 3 — EXECUTE
Spawn Task agents in pipeline order (ring topology — each must complete before next starts):
Stage 1 research: subagent_type "researcher"
Stage 2 draft: subagent_type "Content Creator"
Stage 3 edit: subagent_type "Technical Writer"
Stage 4 format/publish: subagent_type "Content Creator"

Also run /monomind:do --board <board_id> to track execution.

STEP 4 — COLLECT AND RETURN
Collect the final formatted content. Return to caller:

domain: content
status: complete | partial | blocked
artifacts:
  - path: [path to final content file]
    type: copy
decisions:
  - what: [angle, tone, or structure decisions made]
    why: [reasoning]
    confidence: [0.0-1.0]
    outcome: shipped | pending
lessons:
  - what_worked: [what produced the strongest draft]
  - what_didnt: [what required multiple iterations]
next_actions:
  - [e.g. "run mastermind:marketing to distribute the content"]
  - [e.g. "run mastermind:review for final quality check"]
board_url: monotask://<project_name>/content
run_id: <ISO8601-timestamp>`,
  run_in_background: true
})
```

---

## Simple Execution

For simple tasks (single agent, short-form content):

1. Spawn one Task agent with the content request as a self-contained briefing
2. Collect output
3. Return unified output schema with `status: complete`

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Full article / blog post | researcher → writer → editor | ring 4 raft pipeline |
| Newsletter | coordinator + writers | ring 4 raft pipeline |
| Documentation rewrite | Technical Writer + researcher | ring 4 raft pipeline |
| Social thread | Content Creator | hierarchical 3 raft specialized |
| Short-form copy | Content Creator | single agent |
