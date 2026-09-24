---
name: mastermind-delegation
description: Agent Delegation Capability — injected into every spawned agent prompt so subagents can further delegate specialized work. Never invoked directly; referenced by mastermind-protocol/SKILL.md and domain skills.
type: shared
---

# Agent Delegation Capability

This file defines the **AGENT DELEGATION CAPABILITY** block that MUST be included verbatim in every `Task` / `Agent` spawn within mastermind and monomind commands.

Including it in every agent prompt makes delegation **recursive**: an agent can spawn sub-agents, which can spawn their own sub-agents, each with full access to the same capability.

---

## How to use this file

When writing a Task/Agent `description` or `prompt`, paste the section below verbatim after `BRAIN CONTEXT:`. Do not paraphrase — paste it as-is so sub-agents receive the full capability statement.

---

## AGENT DELEGATION CAPABILITY [paste this block into every agent prompt]

```
== AGENT DELEGATION CAPABILITY ==
You have full access to the Agent tool (Claude Code: Task tool) to spawn
sub-agents for any specialized subtask. This capability is recursive —
sub-agents you spawn also receive it.

To choose the subagent_type for a subtask, in this order:
  1. The prompt's [PICK] line (`[PICK] agent: <name> · skill: <invoke>`),
     unless it is clearly wrong for the subtask.
  2. mcp__monomind__pick({ task: "<subtask>", kind: "agents", top: 3 })
     -> use an agents.ranked[].name.
  3. No MCP: monomind pick -t "<subtask>" --top 3 --json | jq -r '.agents.ranked[].name'
     (local binary only, never npx).
  4. Nothing returned: coder (implementation) · tester · reviewer ·
     researcher · planner · general-purpose.
Picked names always exist on disk. Do NOT invent agent names.

WHEN to delegate:
- A subtask needs deeper expertise than your primary role
- Work can be done faster in parallel by concurrent specialists
- A subtask is outside your domain but blocks your progress

HOW to delegate:
  Agent({
    subagent_type: "Agent Name",   // a name returned by the pick
    description: "Short task label",
    prompt: `Full self-contained briefing — treat every sub-agent as cold-start.
             Include: context, scope, success criteria, and this AGENT DELEGATION
             CAPABILITY block so they can further delegate if needed.`,
    run_in_background: true   // use for parallel work
  })

RULES:
- Always pass enough context for the sub-agent to work independently
- Collect and synthesize sub-agent results before writing your final output
- Report what you delegated and what each sub-agent returned
- If a sub-agent is blocked, handle it rather than silently failing
=================================
```

---

## Placement in agent prompts

```
BRAIN CONTEXT:
[...]
=====================

== AGENT DELEGATION CAPABILITY ==
[full block above]
=================================

YOUR GOAL: [task description]
```
