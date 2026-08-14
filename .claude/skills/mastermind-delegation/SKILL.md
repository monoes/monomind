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

Available agent categories (use the exact slug or name — all of these exist on disk):

  CORE      coder · reviewer · tester · planner · researcher
  BACKEND   Backend Architect · Database Optimizer · API Tester
  FRONTEND  Frontend Developer · mobile-dev · Mobile App Builder
  ARCH      Software Architect · system-architect · Backend Architect
  SECURITY  Security Engineer · Compliance Auditor · Blockchain Security Auditor · Threat Detection Engineer
  AI/ML     AI Engineer · Data Engineer · AI Data Remediation Engineer · Model QA Specialist
  DEVOPS    DevOps Automator · SRE (Site Reliability Engineer) · Git Workflow Master · Incident Response Commander
  DOCS      Technical Writer
  MARKETING Competitive Content Strategist · CRO Specialist · Email Marketing Specialist · Launch Strategist · Pricing Strategist
  SPECIALIZED  MCP Builder · Document Generator · LSP/Index Engineer · Embedded Firmware Engineer · Solidity Smart Contract Engineer
  GITHUB    pr-manager · issue-tracker · code-review-swarm · release-manager
  DESIGN    Monodesign (UI/UX · brand · CSS · animation · design systems)
  SWARM     mesh-coordinator · coordinator · Agents Orchestrator

The authoritative list is the filesystem — run `ls .claude/agents/` for the full
~98-agent set. Do NOT invent agent names; only delegate to agents that exist.

WHEN to delegate:
- A subtask needs deeper expertise than your primary role
- Work can be done faster in parallel by concurrent specialists
- A subtask is outside your domain but blocks your progress

HOW to delegate:
  Agent({
    subagent_type: "agent-slug",
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
