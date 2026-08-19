---
name: specialagent
description: Find the single best specialized agent from the verified ~98-agent roster using two-stage LLM domain→agent selection
version: 2.0.0
triggers:
  - /specialagent
  - find best agent
  - which agent should i use
  - best agent for
  - recommend an agent
  - pick an agent
  - what agent
  - who should handle this
  - which specialist
  - what specialist
  - agent for this task
  - assign an agent
  - which swarm agent
tools:
  - Bash
---

# /specialagent — Two-Stage LLM Agent Selection

Finds the best agent using a lightweight two-stage LLM approach: first pick the domain, then pick the agent within that domain. Only names are passed at each stage — no descriptions, no keyword dumps.

## How It Works

```
Stage 1: Give LLM domain names → LLM picks best domain
Stage 2: Give LLM agent names in that domain → LLM picks best agent
```

## Stage 1: Domain Selection

The verified roster is ~98 agent definitions (97 registered in `packages/@monomind/cli/.monomind/registry.json`). Domains and representative agents from each:

| Domain | Representative agents (NOT exhaustive — run `ls .claude/agents/` for the full set) |
|---|---|
| development | coder · Backend Architect · Frontend Developer · mobile-dev · Mobile App Builder · Rapid Prototyper · Software Architect · Senior Developer · AI Engineer · Data Engineer · Database Optimizer · AI Data Remediation Engineer · LSP/Index Engineer · Embedded Firmware Engineer · Solidity Smart Contract Engineer · WeChat Mini Program Developer · Feishu Integration Developer · Model QA Specialist |
| testing | tester · tdd-london-swarm · production-validator · API Tester · Accessibility Auditor · Evidence Collector · Performance Benchmarker · Test Results Analyzer · Tool Evaluator · Workflow Optimizer · Code Reviewer |
| security | Security Engineer · Compliance Auditor · Blockchain Security Auditor · Threat Detection Engineer · Agentic Identity & Trust Architect · Identity Graph Operator · ZK Steward |
| devops | DevOps Automator · SRE (Site Reliability Engineer) · Git Workflow Master · Incident Response Commander |
| architecture | system-architect · Software Architect · Backend Architect · Workflow Architect · Autonomous Optimization Architect · Automation Governance Architect · v1-integration-architect |
| research | researcher · Technical Writer · Developer Advocate · goal-planner |
| marketing | Competitive Content Strategist · CRO Specialist · Email Marketing Specialist · Launch Strategist · Pricing Strategist |
| design | Monodesign · Cultural Intelligence Strategist |
| github | pr-manager · issue-tracker · release-manager · repo-architect · code-review-swarm · multi-repo-swarm · sync-coordinator · workflow-automation · project-board-sync |
| swarm / consensus | mesh-coordinator · collective-intelligence-coordinator · scout-explorer · swarm-memory-manager · worker-specialist · coordinator · planner · smart-agent · swarm-init · quorum-manager |
| optimization | Benchmark Suite · Load Balancing Coordinator · Performance Monitor · Resource Allocator · Topology Optimizer |
| specialized | MCP Builder · Document Generator · Agents Orchestrator · dashboard-verifier |

**The filesystem is authoritative** — run `ls .claude/agents/` (and `ls packages/@monomind/cli/.claude/agents/`) for the current full list; agents are added over time. Only recommend agents that actually exist there.

**Stage 1 prompt to yourself:**
> "Given the task: `<task>` — which single domain from this list best fits: development, testing, security, devops, architecture, research, marketing, design, github, swarm, optimization, specialized? Answer with just the domain name."

## Stage 2: Agent Selection Per Domain

From the chosen domain's agents (table above), pick the best fit. **Before recommending, verify the name exists** as a `.md` file under `.claude/agents/` (or `packages/@monomind/cli/.claude/agents/`). If the name you want is not on disk, fall back to another agent in the domain or to a core agent (`coder`, `reviewer`, `tester`, `researcher`, `planner`).

**Stage 2 prompt to yourself:**
> "Given the task: `<task>` — which single agent from this domain's list is the best fit: `<comma-separated agent names for the selected domain>`? Answer with just the agent name."

## Execution Steps

1. Read the user's task
2. **Stage 1**: Internally reason through the domain list → select one domain
3. **Stage 2**: Internally reason through agent names in that domain → select one agent
4. Verify the agent exists: `ls .claude/agents/**/<slug>.md` (names double as slugs; confirm via the frontmatter `name:` field)
5. Output the recommendation

## Slug Mapping

Agent names double as their `subagent_type` slug — the slug is the agent's frontmatter `name` (or the filename without `.md`). Resolve a name to its slug from the definition on disk:

```bash
# list every available agent definition
ls .claude/agents/ packages/@monomind/cli/.claude/agents/
# read a specific agent's registered name
grep -m1 "^name:" .claude/agents/**/<file>.md
```

If unsure, pass the agent name as the slug. The authoritative set is whatever currently exists in those directories (~98 definitions).

## Output Format

```
TASK: <one-line task summary>

DOMAIN: <selected domain>

RECOMMENDED AGENT: <Agent Name>
Invoke: Task({ subagent_type: "<slug>", prompt: "..." })
```

Then ask: "Should I spawn this agent now?"

## Rules

1. Only pass names at each stage — no descriptions, no keyword dumps, no scoring tables
2. Pick exactly one domain, then exactly one agent
3. For tasks that clearly need a specialized tool (e.g. accessibility audits → Accessibility Auditor, not tester), prefer the more specific agent
4. Never recommend a generic role (coder, tester) when a specialized agent in the right domain exists
