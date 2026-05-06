---
name: mastermind-marketing
description: Mastermind marketing domain — campaigns, copy, SEO, social media strategy. Spawns a Marketing Manager who coordinates content, SEO, social, and analytics agents in parallel.
type: domain-skill
default_mode: confirm
---

# Mastermind Marketing Domain

This skill is invoked by `mastermind:master` or directly via `/mastermind:marketing`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via _protocol.md brain load)
- `prompt`: the marketing goal for this run
- `project_name`: monotask space name
- `board_id`: monotask board ID (set by master, or created standalone)
- `mode`: auto | confirm

---

## Reference Library

Before building any task briefing, identify which reference files apply and include their paths in the agent's instructions with a directive to Read them before starting work.

| Reference | When to include |
|---|---|
| `references/persuasion-psychology.md` | **Always** — all marketing tasks |
| `references/copywriting-frameworks.md` | Copy tasks: landing pages, headlines, CTAs, hero sections, any page copy; email copy: subject lines, cold outreach, nurture sequences |
| `.claude/skills/stop-slop/SKILL.md` | **All copy review** — run before delivering any written asset |
| `.claude/skills/stop-slop/references/phrases.md` | Full copy edit pass — check for banned phrases |
| `.claude/skills/stop-slop/references/structures.md` | Full copy edit pass — check structural patterns |

In each agent task briefing, add:
```
REFERENCE FILES: Read these before starting:
- .claude/skills/mastermind/references/persuasion-psychology.md
[For copy tasks (landing pages, CTAs, email copy, headlines, subject lines), also read:]
- .claude/skills/mastermind/references/copywriting-frameworks.md
```

---

## Specialist Agent Routing

Use these agents instead of generic types when the task is domain-specific:

| Task | Agent slug | When to use |
|---|---|---|
| Email sequences, drip campaigns, cold outreach | `email-specialist` | Any multi-email flow or cold email |
| Page CRO, signup flow, form, popup optimization | `cro-specialist` | Conversion analysis or optimization |
| Pricing decisions, tier design, pricing pages | `pricing-strategist` | Any pricing or packaging task |
| Product launch, feature announcement, GTM | `launch-strategist` | Any launch or release |
| Competitor pages, content strategy, topic planning | `competitive-content` | Competitive content or editorial planning |
| General copy and content | `content-creator` | Multi-platform content, brand storytelling |
| SEO audits, keyword strategy | `seo-specialist` | Technical SEO, organic search |
| Social media | `social-media-strategist` | Social content and calendars |
| Paid ads | `ad-creative-strategist` | Ad copy and paid creative |

For tasks outside these domains (referral programs, schema markup, analytics tracking), name the appropriate specialist agent in the briefing and let it handle depth.

---

## Complexity Assessment

Assess the prompt to determine execution mode:

**Simple (direct execution):** Single asset, single agent:
- "Write one tweet announcing the new API release"
- "Draft a subject line for the newsletter"
→ Use a single Content Creator agent. Skip manager delegation.

**Complex (spawn Marketing Manager agent):** Any of these:
- Full campaign across multiple channels
- SEO audit or keyword strategy
- Social media calendar or multi-post series
- Launch strategy requiring copy + analytics + distribution
→ Spawn Marketing Manager agent with full briefing.

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `marketing`)
2. Run intake from _intake.md if prompt is vague
3. Create or find monotask space `<project_name>`, create board `marketing`
4. Proceed with complexity assessment below
5. At end: follow _protocol.md Brain Write Procedure (namespace: `marketing`)

---

## Complex Execution — Marketing Manager Agent

Spawn a Marketing Manager agent via Task tool:

```javascript
Task({
  subagent_type: "coordinator",
  description: `You are the Marketing Manager for project <project_name>.

CONTEXT: <date> | Project: <project_name> | Spawned by: mastermind:marketing

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <board_id>
YOUR GOAL: <prompt>

STEP 1 — PLAN
Decompose the marketing goal into parallel workstreams. For each workstream, identify:
- Which channel or medium it targets (social, SEO, email, paid, content)
- Which specialist to assign
- What deliverables are needed (copy, strategy doc, keyword list, calendar)
- Dependencies between workstreams

STEP 2 — CREATE TASKS
For each workstream, call /monomind:createtask with this briefing format:

  CONTEXT: <date> | Project: <project_name> | Created by: Marketing Manager
  BRAIN MEMORY: [paste most relevant 3-5 brain context excerpts]
  GOAL: [specific marketing workstream goal]
  SCOPE: [channel, audience, tone, brand constraints]
  CONSTRAINTS: [brand voice, legal/compliance, budget limits, existing assets]
  SUCCESS CRITERIA:
  - [ ] [checkable item]
  AGENT: [Content Creator | Email Marketing Specialist | CRO Specialist | Pricing Strategist | Launch Strategist | Competitive Content Strategist | SEO Specialist | Social Media Strategist | Analytics Reporter | Ad Creative Strategist]
  SWARM: star 5 parallel
  REPORTS TO: <board_id>
  DEPENDENCIES: [task IDs or "none"]
  OUTPUT FORMAT: unified output schema

STEP 3 — EXECUTE
Spawn one Task agent per workstream (all in parallel — star topology, hub aggregates):
- Copy and content: subagent_type "Content Creator"
- SEO: subagent_type "SEO Specialist"
- Social media: subagent_type "Social Media Strategist"
- Analytics and measurement: subagent_type "Analytics Reporter"
- Ad creative: subagent_type "Ad Creative Strategist"
- Email sequences / drip campaigns: subagent_type "Email Marketing Specialist" (slug: email-specialist)
- Page / flow CRO: subagent_type "CRO Specialist" (slug: cro-specialist)
- Pricing strategy / packaging: subagent_type "Pricing Strategist" (slug: pricing-strategist)
- Product launch / GTM: subagent_type "Launch Strategist" (slug: launch-strategist)
- Competitive content / comparison pages: subagent_type "Competitive Content Strategist" (slug: competitive-content)

Also run /monomind:do --board <board_id> to track execution.

STEP 4 — COLLECT AND RETURN
Collect all agent outputs. Return to caller:

domain: marketing
status: complete | partial | blocked
artifacts:
  - path: [each asset created — copy doc, keyword list, social calendar]
    type: copy
decisions:
  - what: [channel prioritization or messaging decisions]
    why: [reasoning]
    confidence: [0.0-1.0]
    outcome: pending | shipped
lessons:
  - what_worked: [which channels or approaches were strongest]
  - what_didnt: [what needed more brand context or iteration]
next_actions:
  - [e.g. "run mastermind:content to produce the blog series"]
  - [e.g. "run mastermind:review on the campaign copy"]
board_url: monotask://<project_name>/marketing
run_id: <ISO8601-timestamp>`,
  run_in_background: true
})
```

---

## Simple Execution

For simple tasks (single agent, single asset):

1. Spawn one Task agent with the marketing request as a self-contained briefing
2. Collect output
3. Return unified output schema with `status: complete`

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Full campaign | coordinator + channel specialists | star 5 parallel |
| SEO strategy | SEO Specialist | hierarchical 3 raft specialized |
| Social calendar | Social Media Strategist | hierarchical 3 raft specialized |
| Copy production | Content Creator | single agent or hierarchical 3 |
| Email sequence | Email Marketing Specialist | single agent |
| Cold outreach | Email Marketing Specialist | single agent |
| Page / flow CRO | CRO Specialist | single agent |
| Pricing design | Pricing Strategist | single agent |
| Product launch | Launch Strategist + Content Creator | hierarchical 3 |
| Competitive content | Competitive Content Strategist | single agent |
| Analytics review | Analytics Reporter | single agent |
