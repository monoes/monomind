---
name: mastermind-finance
description: Mastermind finance domain — invoicing, budget tracking, financial forecasting. Spawns a Finance Manager coordinating financial tracking and analysis agents.
type: domain-skill
default_mode: confirm
---

# Mastermind Finance Domain

This skill is invoked by `mastermind:master` or directly via `/mastermind:finance`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via _protocol.md brain load)
- `prompt`: the finance goal for this run
- `project_name`: monotask space name
- `board_id`: monotask board ID (set by master, or created standalone)
- `mode`: auto | confirm

---

## Complexity Assessment

Assess the prompt to determine execution mode:

**Simple (direct execution):** Single calculation or single document:
- "Calculate total revenue for Q1 from these figures: ..."
- "Draft an invoice for project X at $5,000"
→ Use a single Finance Tracker agent. Skip manager delegation.

**Complex (spawn Finance Manager agent):** Any of these:
- Full financial forecast (revenue + costs + runway)
- Budget analysis across multiple cost centers
- Batch invoice processing
- P&L or cash flow modeling
→ Spawn Finance Manager agent with full briefing.

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `finance`)
2. Run intake from _intake.md if prompt is vague
3. Create or find monotask space `<project_name>`, create board `finance`
4. Proceed with complexity assessment below
5. At end: follow _protocol.md Brain Write Procedure (namespace: `finance`)

---

## Complex Execution — Finance Manager Agent

Spawn a Finance Manager agent via Task tool:

```javascript
Task({
  subagent_type: "coordinator",
  description: `You are the Finance Manager for project <project_name>.

CONTEXT: <date> | Project: <project_name> | Spawned by: mastermind:finance

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <board_id>
YOUR GOAL: <prompt>

STEP 1 — PLAN
Decompose the finance goal into discrete workstreams. For each workstream, identify:
- What financial domain it covers (invoicing, tracking, forecasting, analysis)
- What input data is needed
- What deliverable is produced (report, model, invoice batch)
- Dependencies between workstreams

STEP 2 — CREATE TASKS
For each workstream, call /monomind:createtask with this briefing format:

  CONTEXT: <date> | Project: <project_name> | Created by: Finance Manager
  BRAIN MEMORY: [paste most relevant 3-5 brain context excerpts]
  GOAL: [specific financial workstream goal]
  SCOPE: [time period, accounts, cost centers, currencies in scope]
  CONSTRAINTS: [accounting standards, tax requirements, rounding rules, approval thresholds]
  SUCCESS CRITERIA:
  - [ ] [checkable item — e.g. "forecast covers 12-month runway"]
  AGENT: [Finance Tracker | Analytics Reporter]
  SWARM: hierarchical 3 raft
  REPORTS TO: <board_id>
  DEPENDENCIES: [task IDs or "none"]
  OUTPUT FORMAT: unified output schema

STEP 3 — EXECUTE
Spawn one Task agent per workstream:
- Financial tracking and invoicing: subagent_type "Finance Tracker"
- Analysis and reporting: subagent_type "Analytics Reporter"

Also run /monomind:do --board <board_id> to track execution.

STEP 4 — COLLECT AND RETURN
Collect all financial outputs. Return to caller:

domain: finance
status: complete | partial | blocked
artifacts:
  - path: [financial reports, invoices, forecast models]
    type: report
decisions:
  - what: [financial decisions or recommendations made]
    why: [reasoning — cost drivers, runway implications, risk factors]
    confidence: [0.0-1.0]
    outcome: pending | shipped
lessons:
  - what_worked: [what data sources or models were most accurate]
  - what_didnt: [what required manual correction or more data]
next_actions:
  - [e.g. "run mastermind:ops to automate invoice generation"]
  - [e.g. "run mastermind:review on the financial model assumptions"]
board_url: monotask://<project_name>/finance
run_id: <ISO8601-timestamp>`,
  run_in_background: true
})
```

---

## Simple Execution

For simple tasks (single agent, single output):

1. Spawn one Task agent with the finance request as a self-contained briefing
2. Collect output
3. Return unified output schema with `status: complete`

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Full financial forecast | coordinator + tracker + analyst | hierarchical 3 raft specialized |
| Budget analysis | Finance Tracker + Analytics Reporter | hierarchical 3 raft specialized |
| Invoice batch | Finance Tracker | hierarchical 3 raft specialized |
| P&L report | Analytics Reporter | single agent |
| Single invoice or calculation | Finance Tracker | single agent |
