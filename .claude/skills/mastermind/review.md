---
name: mastermind-review
description: Mastermind review domain — code review, content review, strategy review, security audit. Spawns a Review Manager coordinating a mesh of specialist reviewers for multi-angle assessment.
type: domain-skill
default_mode: auto
---

# Mastermind Review Domain

This skill is invoked by `mastermind:master` or directly via `/mastermind:review`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via _protocol.md brain load)
- `prompt`: what to review and what to assess
- `project_name`: monotask space name
- `board_id`: monotask board ID (set by master, or created standalone)
- `mode`: auto | confirm

---

## Complexity Assessment

Assess the prompt to determine execution mode:

**Simple (direct execution):** Single file or single artifact:
- "Review this function for bugs"
- "Check this paragraph for clarity"
→ Use a single Code Reviewer or content reviewer agent. Skip manager delegation.

**Complex (spawn Review Manager agent):** Any of these:
- Full codebase or module audit
- Security review across multiple surfaces
- Strategy or content review requiring multiple expert perspectives
- Combined code + architecture + security pass
→ Spawn Review Manager agent with full briefing.

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `review`)
2. Run intake from _intake.md if prompt is vague
3. Create or find monotask space `<project_name>`, create board `review`
4. Proceed with complexity assessment below
5. At end: follow _protocol.md Brain Write Procedure (namespace: `review`)

---

## Complex Execution — Review Manager Agent

Spawn a Review Manager agent via Task tool:

```javascript
Task({
  subagent_type: "reviewer",
  description: `You are the Review Manager for project <project_name>.

CONTEXT: <date> | Project: <project_name> | Spawned by: mastermind:review

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <board_id>
YOUR GOAL: <prompt>

STEP 1 — PLAN
Decompose the review scope into distinct assessment angles. For each angle, identify:
- What is being reviewed (code, architecture, security, content, strategy, metrics)
- Which specialist is best suited
- What findings format is needed (issues list, risk rating, recommendations)
- Whether angles have dependencies (e.g. architecture review before security)

STEP 2 — CREATE TASKS
For each review angle, call /monomind:createtask with this briefing format:

  CONTEXT: <date> | Project: <project_name> | Created by: Review Manager
  BRAIN MEMORY: [paste most relevant 3-5 brain context excerpts]
  GOAL: [specific review scope and assessment criteria]
  SCOPE: [exact files, URLs, documents, or system surfaces in scope]
  CONSTRAINTS: [known acceptable risks, existing decisions not to revisit, standards to apply]
  SUCCESS CRITERIA:
  - [ ] [checkable item — e.g. "all critical issues documented"]
  AGENT: [Code Reviewer | Security Engineer | analyst | Accessibility Auditor | UX Researcher]
  SWARM: mesh 4 gossip
  REPORTS TO: <board_id>
  DEPENDENCIES: [task IDs or "none"]
  OUTPUT FORMAT: unified output schema

STEP 3 — EXECUTE
Spawn one Task agent per review angle (mesh topology — reviewers share findings):
- Code quality: subagent_type "Code Reviewer"
- Security: subagent_type "Security Engineer"
- Architecture: subagent_type "Software Architect"
- Analytics/metrics: subagent_type "Analytics Reporter"
- Accessibility: subagent_type "Accessibility Auditor"

Also run /monomind:do --board <board_id> to track execution.

STEP 4 — COLLECT AND RETURN
Synthesize all review findings. Return to caller:

domain: review
status: complete | partial | blocked
artifacts:
  - path: [review report if written to disk]
    type: report
decisions:
  - what: [critical findings and recommended actions]
    why: [evidence from review]
    confidence: [0.0-1.0]
    outcome: pending
lessons:
  - what_worked: [which review angles surfaced the most value]
  - what_didnt: [gaps in review coverage]
next_actions:
  - [e.g. "run mastermind:build to fix critical issues found"]
  - [e.g. "run mastermind:release after fixes are confirmed"]
board_url: monotask://<project_name>/review
run_id: <ISO8601-timestamp>`,
  run_in_background: true
})
```

---

## Simple Execution

For simple tasks (single reviewer, single artifact):

1. Spawn one Task agent with the review request as a self-contained briefing
2. Collect output
3. Return unified output schema with `status: complete`

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Full multi-angle review | reviewer + specialists | mesh 4 gossip balanced |
| Security audit | Security Engineer + Code Reviewer | hive-mind hierarchical-mesh byzantine 6 |
| Code review only | Code Reviewer | hierarchical 3 raft specialized |
| Strategy review | analyst + researcher | mesh 3 gossip balanced |
| Content review | Code Reviewer (content) | single agent |
