---
name: mastermind-research
description: Mastermind research domain — market research, competitor analysis, user research, trend scanning. Spawns a Research Manager coordinating a mesh of researcher agents for comprehensive intelligence gathering.
type: domain-skill
default_mode: auto
---

# Mastermind Research Domain

This skill is invoked by `mastermind:master` or directly via `/mastermind:research`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via _protocol.md brain load)
- `prompt`: the research question or intelligence goal
- `project_name`: monotask space name
- `board_id`: monotask board ID (set by master, or created standalone)
- `mode`: auto | confirm

---

## Complexity Assessment

Assess the prompt to determine execution mode:

**Simple (direct execution):** Single-answer lookup or quick scan:
- "What is the pricing model for Competitor X?"
- "Find the current market size for SaaS tools in HR"
→ Use a single researcher agent. Skip manager delegation.

**Complex (spawn Research Manager agent):** Any of these:
- Full competitive landscape analysis
- Market sizing with multiple data sources
- User research synthesis across multiple interviews or signals
- Trend analysis requiring cross-domain intelligence
→ Spawn Research Manager agent with full briefing.

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `research`)
2. Run intake from _intake.md if prompt is vague
3. Follow _protocol.md Monotask Space+Board Setup Procedure:
   ```bash
   project_name="${project_name:-$(basename "$PWD")}"
   space_id=$(monotask space list 2>/dev/null | awk -F' \| ' -v n="$project_name" '$2==n{print $1}' | head -1)
   [ -z "$space_id" ] && space_id=$(monotask space create "$project_name" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
   [ -z "$space_id" ] && { echo "ERROR: Could not find or create space '$project_name'"; exit 1; }
   board_id=$(monotask board create "research" --json | jq -r '.id // empty')
   [ -z "$board_id" ] && { echo "ERROR: Failed to create research board"; exit 1; }
   monotask space boards add "$space_id" "$board_id" >/dev/null 2>&1 || true
   todo_col=$(monotask column create "$board_id" "Todo"  --json | jq -r '.id')
   doing_col=$(monotask column create "$board_id" "Doing" --json | jq -r '.id')
   done_col=$(monotask column create "$board_id" "Done"  --json | jq -r '.id')
   ```
4. Proceed with complexity assessment below
5. At end: follow _protocol.md Brain Write Procedure (namespace: `research`)

---

## Complex Execution — Research Manager Agent

Spawn a Research Manager agent via Task tool:

```javascript
Task({
  subagent_type: "researcher",
  description: `You are the Research Manager for project <project_name>.

CONTEXT: <date> | Project: <project_name> | Spawned by: mastermind:research

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <board_id>
YOUR GOAL: <prompt>

STEP 1 — PLAN
Decompose the research goal into parallel intelligence streams. For each stream, identify:
- What specific question it answers
- Which data sources to tap (web, docs, user signals, code, analytics)
- Which specialist is best suited
- How outputs from different streams combine into a final answer

STEP 2 — CREATE TASKS
For each research stream, create a monotask card on the project board. First look up column IDs and assign shell variables:
```bash
columns=$(monotask column list "$BOARD_ID" --json)
COL_TODO_ID=$(echo "$columns" | jq -r '.[] | select(.title == "Todo" or .title == "Backlog") | .id' | head -1)
COL_DONE_ID=$(echo "$columns" | jq -r '.[] | select(.title == "Done") | .id' | head -1)
```
Then create the card:
```bash
result=$(monotask card create "$BOARD_ID" "$COL_TODO_ID" "<short summary of research question, ≤80 chars>" --json)
CARD_ID=$(echo "$result" | jq -r '.id // empty')
monotask card set-description "$BOARD_ID" "$CARD_ID" "[specific research question this stream answers]"
monotask card comment add "$BOARD_ID" "$CARD_ID" "CONTEXT: <date> | Project: <project_name> | Created by: Research Manager
BRAIN MEMORY: [paste most relevant 3-5 brain context excerpts]
SCOPE: [sources to consult, search queries to run, depth of analysis]
CONSTRAINTS: [recency requirements, geographic scope, data reliability thresholds]
SUCCESS CRITERIA:
- [ ] [checkable item — e.g. \"top 5 competitors identified with pricing\"]
AGENT: [researcher | Trend Researcher | UX Researcher | Analytics Reporter]
SWARM: mesh 4 gossip
DEPENDENCIES: [task IDs or \"none\"]
OUTPUT FORMAT: unified output schema"
```

STEP 3 — EXECUTE
Spawn one Task agent per research stream (mesh topology — findings cross-pollinate):
- Web and market research: subagent_type "researcher"
- Trend and signal analysis: subagent_type "Trend Researcher"
- User behavior and UX signals: subagent_type "UX Researcher"
- Data and metrics analysis: subagent_type "Analytics Reporter"

Also run /monomind:do --board <board_id> to track execution.

STEP 4 — COLLECT AND RETURN
Synthesize all research streams into an intelligence report. Return to caller:

domain: research
status: complete | partial | blocked
artifacts:
  - path: [research report if written to disk]
    type: report
decisions:
  - what: [key findings and recommended actions]
    why: [evidence from research]
    confidence: [0.0-1.0]
    outcome: pending
lessons:
  - what_worked: [which sources or methods yielded best signal]
  - what_didnt: [gaps or low-quality sources]
next_actions:
  - [e.g. "run mastermind:idea to act on market insights"]
  - [e.g. "run mastermind:marketing with validated positioning"]
board_url: monotask://<project_name>/research
run_id: <ISO8601-timestamp>`,
  run_in_background: true
})
```

---

## Simple Execution

For simple tasks (single researcher, single question):

1. Spawn one Task agent with the research question as a self-contained briefing
2. Collect output
3. Return unified output schema with `status: complete`

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Full competitive analysis | researcher + trend + UX | mesh 4 gossip balanced |
| Market sizing | researcher | hierarchical 3 raft specialized |
| Trend scan | Trend Researcher | single agent |
| User research synthesis | UX Researcher | hierarchical 3 raft specialized |
| Quick factual lookup | researcher | single agent |
