---
name: mastermind-build
description: Mastermind build domain — development automation for features, bugs, refactors, and code review. Spawns a Development Manager agent who creates monotask tasks and coordinates specialized sub-agent swarms.
type: domain-skill
default_mode: auto
---

# Mastermind Build Domain

This skill is invoked by `mastermind:master` or directly via `/mastermind:build`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via _protocol.md brain load)
- `prompt`: the goal for this build run
- `project_name`: monotask space name
- `board_id`: monotask board ID (set by master, or created standalone)
- `mode`: auto | confirm

---

## Complexity Assessment

Assess the prompt to determine execution mode:

**Simple (direct skill execution):** Single task, single agent, one file:
- "Fix the typo in /src/auth.ts line 42"
- "Add a console.log to debug X"
→ Use the Edit tool or Task with a single coder agent. Skip manager delegation.

**Complex (spawn Development Manager agent):** Any of these:
- 3+ files to create/modify
- Requires frontend + backend + testing
- New feature with architecture decisions
- Performance optimization across modules
- Security fix with audit trail needed
→ Spawn Development Manager agent with full briefing.

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `build`)
2. Run intake from _intake.md if prompt is vague
3. Create or find monotask space `<project_name>`, create board `development`
4. Proceed with complexity assessment below
5. At end: follow _protocol.md Brain Write Procedure (namespace: `build`)

---

## Complex Execution — Development Manager Agent

Spawn a Development Manager agent via Task tool:

```javascript
Task({
  subagent_type: "coordinator",
  description: `You are the Development Manager for project <project_name>.

CONTEXT: <date> | Project: <project_name> | Spawned by: mastermind:build

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <board_id>
YOUR GOAL: <prompt>

STEP 1 — PLAN
Decompose the goal into discrete development tasks. For each task, identify:
- Which files are affected
- What type of work it is (backend, frontend, test, review)
- Dependencies between tasks
- Estimated complexity

STEP 2 — CREATE TASKS
For each task, call /monomind:createtask with this briefing format:

  CONTEXT: <date> | Project: <project_name> | Created by: Development Manager
  BRAIN MEMORY: [paste most relevant 3-5 brain context excerpts]
  GOAL: [specific task goal]
  SCOPE: [exact file paths in scope]
  CONSTRAINTS: [must-not-break items, existing APIs to preserve]
  SUCCESS CRITERIA:
  - [ ] [checkable item]
  AGENT: [backend-dev | frontend-dev | tester | reviewer | sparc-coder]
  SWARM: hierarchical 4 raft
  REPORTS TO: <board_id>
  DEPENDENCIES: [task IDs or "none"]
  OUTPUT FORMAT: unified output schema

STEP 3 — EXECUTE
Spawn one Task agent per task (all in parallel where dependencies allow):
- Backend tasks: subagent_type "backend-dev"
- Frontend tasks: subagent_type "frontend-dev"
- Testing tasks: subagent_type "tester"
- Code review: subagent_type "reviewer"
- TDD/SPARC work: subagent_type "sparc-coder"

Also run /monomind:do --board <board_id> to track execution.

STEP 4 — COLLECT AND RETURN
Collect all agent output schemas. Return to caller:

domain: build
status: complete | partial | blocked
artifacts:
  - path: [each file created/modified]
    type: code
decisions:
  - what: [architectural decisions made]
    why: [reasoning]
    confidence: [0.0-1.0]
    outcome: shipped | pending
lessons:
  - what_worked: [what helped]
  - what_didnt: [what didn't]
next_actions:
  - [suggested follow-ups like "run mastermind:review"]
board_url: monotask://<project_name>/development
run_id: <ISO8601-timestamp>`,
  run_in_background: true
})
```

---

## Simple Execution

For simple tasks (single agent, single file):

1. Spawn one Task agent with the task as a self-contained briefing
2. Collect output
3. Return unified output schema with `status: complete`

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Feature development | coordinator | hierarchical 6 raft specialized |
| Bug fix | coder + tester | hierarchical 4 raft specialized |
| Refactor | coordinator | hierarchical 5 raft specialized |
| Performance | perf-analyzer + coder | star 4 parallel |
| Security fix | security-architect + auditor | hive-mind hierarchical-mesh byzantine 6 |
| Code review | reviewer | mesh 4 gossip balanced |
