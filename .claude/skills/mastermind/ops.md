---
name: mastermind-ops
description: Mastermind ops domain — workflow automation, reporting, process optimization. Spawns an Ops Manager coordinating automation and reporting agents in parallel.
type: domain-skill
default_mode: auto
---

# Mastermind Ops Domain

This skill is invoked by `mastermind:master` or directly via `/mastermind:ops`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via _protocol.md brain load)
- `prompt`: the operations goal for this run
- `project_name`: monotask space name
- `board_id`: monotask board ID (set by master, or created standalone)
- `mode`: auto | confirm

---

## Complexity Assessment

Assess the prompt to determine execution mode:

**Simple (direct execution):** Single process or single report:
- "Generate a weekly status report from the task board"
- "Document this manual workflow as a runbook"
→ Use a single Workflow Optimizer or Analytics Reporter agent. Skip manager delegation.

**Complex (spawn Ops Manager agent):** Any of these:
- End-to-end workflow automation design and implementation
- Multi-system integration (CI/CD + monitoring + alerting)
- Reporting dashboard requiring multiple data sources
- Process audit and optimization across multiple teams
→ Spawn Ops Manager agent with full briefing.

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `ops`)
2. Run intake from _intake.md if prompt is vague
3. Create or find monotask space `<project_name>`, create board `ops`
4. Proceed with complexity assessment below
5. At end: follow _protocol.md Brain Write Procedure (namespace: `ops`)

---

## Complex Execution — Ops Manager Agent

Spawn an Ops Manager agent via Task tool:

```javascript
Task({
  subagent_type: "coordinator",
  description: `You are the Ops Manager for project <project_name>.

CONTEXT: <date> | Project: <project_name> | Spawned by: mastermind:ops

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <board_id>
YOUR GOAL: <prompt>

STEP 1 — PLAN
Decompose the ops goal into parallel workstreams. For each workstream, identify:
- What process, system, or workflow it covers
- Whether it's automation design, reporting, or optimization
- What tools and integrations are involved
- Dependencies between workstreams

STEP 2 — CREATE TASKS
For each workstream, call /monomind:createtask with this briefing format:

  CONTEXT: <date> | Project: <project_name> | Created by: Ops Manager
  BRAIN MEMORY: [paste most relevant 3-5 brain context excerpts]
  GOAL: [specific ops workstream goal]
  SCOPE: [systems, tools, processes, integrations in scope]
  CONSTRAINTS: [existing tooling to preserve, compliance requirements, access restrictions]
  SUCCESS CRITERIA:
  - [ ] [checkable item — e.g. "automation runs without manual intervention"]
  AGENT: [Workflow Optimizer | Analytics Reporter | DevOps Automator | cicd-engineer]
  SWARM: star 4 parallel
  REPORTS TO: <board_id>
  DEPENDENCIES: [task IDs or "none"]
  OUTPUT FORMAT: unified output schema

STEP 3 — EXECUTE
Spawn one Task agent per workstream (star topology — hub aggregates independent outputs):
- Workflow design and automation: subagent_type "Workflow Optimizer"
- Reporting and dashboards: subagent_type "Analytics Reporter"
- Infrastructure automation: subagent_type "DevOps Automator"
- CI/CD pipelines: subagent_type "cicd-engineer"

Also run /monomind:do --board <board_id> to track execution.

STEP 4 — COLLECT AND RETURN
Collect all agent outputs. Return to caller:

domain: ops
status: complete | partial | blocked
artifacts:
  - path: [automation scripts, runbooks, dashboard configs, reports]
    type: config
decisions:
  - what: [automation approach, tooling decisions, process changes]
    why: [reasoning]
    confidence: [0.0-1.0]
    outcome: shipped | pending
lessons:
  - what_worked: [what reduced toil or improved visibility most]
  - what_didnt: [what required more manual intervention than expected]
next_actions:
  - [e.g. "run mastermind:review to audit the new automation"]
  - [e.g. "run mastermind:release to deploy the ops changes"]
board_url: monotask://<project_name>/ops
run_id: <ISO8601-timestamp>`,
  run_in_background: true
})
```

---

## Simple Execution

For simple tasks (single agent, single deliverable):

1. Spawn one Task agent with the ops request as a self-contained briefing
2. Collect output
3. Return unified output schema with `status: complete`

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Full workflow automation | coordinator + workflow + devops | star 4 parallel |
| Reporting dashboard | Analytics Reporter + DevOps | star 3 parallel |
| CI/CD pipeline setup | cicd-engineer | hierarchical 3 raft specialized |
| Process audit | Workflow Optimizer | hierarchical 3 raft specialized |
| Single report or runbook | Analytics Reporter | single agent |
