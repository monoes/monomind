---
name: mastermind-sales
description: Mastermind sales domain — outreach sequences, proposals, pipeline management. Spawns a Sales Manager coordinating outbound strategy and proposal writing agents.
type: domain-skill
default_mode: confirm
---

# Mastermind Sales Domain

This skill is invoked by `mastermind:master` or directly via `/mastermind:sales`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via _protocol.md brain load)
- `prompt`: the sales goal for this run
- `project_name`: monotask space name
- `board_id`: monotask board ID (set by master, or created standalone)
- `mode`: auto | confirm

---

## Complexity Assessment

Assess the prompt to determine execution mode:

**Simple (direct execution):** Single output, single agent:
- "Draft a cold email to the CTO of Acme Corp"
- "Write a one-paragraph executive summary for this proposal"
→ Use a single Outbound Strategist or Proposal Strategist agent. Skip manager delegation.

**Complex (spawn Sales Manager agent):** Any of these:
- Full outreach sequence (ICP + targeting + multi-touch sequence)
- RFP or proposal requiring research + executive summary + pricing
- Pipeline review and deal strategy across multiple opportunities
- Account expansion plan
→ Spawn Sales Manager agent with full briefing.

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `sales`)
2. Run intake from _intake.md if prompt is vague
3. Create or find monotask space `<project_name>`, create board `sales`
4. Proceed with complexity assessment below
5. At end: follow _protocol.md Brain Write Procedure (namespace: `sales`)

---

## Complex Execution — Sales Manager Agent

Spawn a Sales Manager agent via Task tool:

```javascript
Task({
  subagent_type: "coordinator",
  description: `You are the Sales Manager for project <project_name>.

CONTEXT: <date> | Project: <project_name> | Spawned by: mastermind:sales

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <board_id>
YOUR GOAL: <prompt>

STEP 1 — PLAN
Decompose the sales goal into coordinated workstreams. For each workstream, identify:
- Target segment or specific account
- Which sales motion applies (outbound, proposal, pipeline review, expansion)
- Deliverable needed (email sequence, proposal doc, deal strategy, account plan)
- Dependencies between workstreams (e.g. research before outreach)

STEP 2 — CREATE TASKS
For each workstream, call /monomind:createtask with this briefing format:

  CONTEXT: <date> | Project: <project_name> | Created by: Sales Manager
  BRAIN MEMORY: [paste most relevant 3-5 brain context excerpts]
  GOAL: [specific sales workstream goal]
  SCOPE: [target accounts, segments, deal stage, decision makers]
  CONSTRAINTS: [brand voice, compliance, do-not-contact lists, pricing floors]
  SUCCESS CRITERIA:
  - [ ] [checkable item]
  AGENT: [Outbound Strategist | Proposal Strategist | Deal Strategist | Account Strategist | researcher]
  SWARM: hierarchical 4 raft
  REPORTS TO: <board_id>
  DEPENDENCIES: [task IDs or "none"]
  OUTPUT FORMAT: unified output schema

STEP 3 — EXECUTE
Spawn one Task agent per workstream:
- Outbound and prospecting: subagent_type "Outbound Strategist"
- Proposal writing: subagent_type "Proposal Strategist"
- Deal qualification: subagent_type "Deal Strategist"
- Account expansion: subagent_type "Account Strategist"
- Competitive research: subagent_type "researcher"

Also run /monomind:do --board <board_id> to track execution.

STEP 4 — COLLECT AND RETURN
Collect all agent outputs. Return to caller:

domain: sales
status: complete | partial | blocked
artifacts:
  - path: [email sequences, proposal documents, account plans]
    type: copy
decisions:
  - what: [ICP definition, messaging strategy, deal approach]
    why: [reasoning]
    confidence: [0.0-1.0]
    outcome: pending | shipped
lessons:
  - what_worked: [which approaches resonated or were most efficient]
  - what_didnt: [what needed more personalization or research]
next_actions:
  - [e.g. "run mastermind:research to validate ICP assumptions"]
  - [e.g. "run mastermind:content to produce case studies for proposals"]
board_url: monotask://<project_name>/sales
run_id: <ISO8601-timestamp>`,
  run_in_background: true
})
```

---

## Simple Execution

For simple tasks (single agent, single output):

1. Spawn one Task agent with the sales request as a self-contained briefing
2. Collect output
3. Return unified output schema with `status: complete`

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Full outreach campaign | coordinator + outbound + researcher | hierarchical 4 raft specialized |
| Proposal / RFP response | coordinator + proposal writer | hierarchical 4 raft specialized |
| Deal strategy | Deal Strategist | hierarchical 3 raft specialized |
| Account expansion plan | Account Strategist | hierarchical 3 raft specialized |
| Single email or cold message | Outbound Strategist | single agent |
