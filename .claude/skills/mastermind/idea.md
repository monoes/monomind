---
name: mastermind-idea
description: Mastermind idea domain — product ideation, feature brainstorming, pivot exploration. Spawns an Idea Manager agent who coordinates a mesh of specialist agents for divergent thinking.
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
→ Use a single researcher or content-creator agent. Skip manager delegation.

**Complex (spawn Idea Manager agent):** Any of these:
- Product strategy or pivot exploration (multiple angles needed)
- Feature ideation requiring market and user context
- Competitive landscape brainstorm
- Full product vision document
→ Spawn Idea Manager agent with full briefing.

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `idea`)
2. Run intake from _intake.md if prompt is vague
3. Create or find monotask space `<project_name>`, create board `ideation`
4. Proceed with complexity assessment below
5. At end: follow _protocol.md Brain Write Procedure (namespace: `idea`)

---

## Complex Execution — Idea Manager Agent

Spawn an Idea Manager agent via Task tool:

```javascript
Task({
  subagent_type: "coordinator",
  description: `You are the Idea Manager for project <project_name>.

CONTEXT: <date> | Project: <project_name> | Spawned by: mastermind:idea

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <board_id>
YOUR GOAL: <prompt>

STEP 1 — PLAN
Decompose the ideation goal into distinct angles of exploration. For each angle, identify:
- What perspective or lens to apply (market, user, technical, competitive)
- Which specialist to assign
- What output format is needed (list, document, diagram, recommendation)
- Dependencies between angles

STEP 2 — CREATE TASKS
For each angle, call /monomind:createtask with this briefing format:

  CONTEXT: <date> | Project: <project_name> | Created by: Idea Manager
  BRAIN MEMORY: [paste most relevant 3-5 brain context excerpts]
  GOAL: [specific ideation angle and output]
  SCOPE: [domain of exploration — market, users, technology, competitors]
  CONSTRAINTS: [existing product constraints, brand voice, strategic limits]
  SUCCESS CRITERIA:
  - [ ] [checkable item]
  AGENT: [researcher | Trend Researcher | Product Manager | Growth Hacker | Content Creator]
  SWARM: mesh 6 gossip
  REPORTS TO: <board_id>
  DEPENDENCIES: [task IDs or "none"]
  OUTPUT FORMAT: unified output schema

STEP 3 — EXECUTE
Spawn one Task agent per angle (all in parallel — mesh topology means all perspectives feed each other):
- Market research angle: subagent_type "researcher"
- Trend analysis: subagent_type "Trend Researcher"
- User perspective: subagent_type "UX Researcher"
- Growth angle: subagent_type "Growth Hacker"
- Content/narrative angle: subagent_type "Content Creator"

Also run /monomind:do --board <board_id> to track execution.

STEP 4 — COLLECT AND RETURN
Synthesize all agent perspectives into a coherent ideation report. Return to caller:

domain: idea
status: complete | partial | blocked
artifacts:
  - path: [ideation document if written to disk]
    type: report
decisions:
  - what: [top idea or direction recommended]
    why: [reasoning from synthesized perspectives]
    confidence: [0.0-1.0]
    outcome: pending
lessons:
  - what_worked: [which angles produced the best insights]
  - what_didnt: [which angles were less useful]
next_actions:
  - [e.g. "run mastermind:research to validate top idea"]
  - [e.g. "run mastermind:build to prototype chosen direction"]
board_url: monotask://<project_name>/ideation
run_id: <ISO8601-timestamp>`,
  run_in_background: true
})
```

---

## Simple Execution

For simple tasks (single agent, single output):

1. Spawn one Task agent with the ideation request as a self-contained briefing
2. Collect output
3. Return unified output schema with `status: complete`

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Full product ideation | coordinator + mesh specialists | mesh 6 gossip balanced |
| Feature brainstorm | researcher + trend-analyst | mesh 4 gossip balanced |
| Pivot exploration | coordinator + researcher + growth | mesh 4 gossip balanced |
| Competitive scan | researcher | hierarchical 3 raft specialized |
| Single idea request | researcher or content-creator | single agent |
