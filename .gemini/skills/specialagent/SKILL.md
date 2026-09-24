---
name: specialagent
description: Find the single best specialized agent for a task — the [PICK] line or the shared pick index (mcp__monomind__pick / monomind pick), with a two-stage domain→agent fallback over the installed agents
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

# /specialagent — Best Agent for a Task

Finds the best installed agent for a task. Never recommend from memory or from a hardcoded roster: the agent set differs per install, and a `subagent_type` that is not installed fails at spawn time.

## Step 1: Use the pick index

In this order, stop at the first that answers:

1. **`[PICK]` line** — if the prompt carries `[PICK] agent: <name> · skill: <invoke>`, recommend that agent unless it is clearly wrong for the task.
2. **`mcp__monomind__pick({ task: "<task>", kind: "agents", top: 5 })`** — choose the best fit among `agents.ranked[]` (prefer the top entry unless another is clearly more specific). Each `name` is a spawnable `subagent_type`.
3. **Local CLI** — `monomind pick -t "<task>" --top 5 --json | jq -r '.agents.ranked[].name'` (local binary only, never npx; see `mastermind-agent-select/SKILL.md` for the version-checked `mmpick` helper).

## Step 2 (fallback): Two-stage domain → agent selection

Only when Step 1 returned nothing. Only names are passed at each stage — no descriptions, no keyword dumps.

```
Stage 1: Give LLM the category names → LLM picks the best category
Stage 2: Give LLM the agent names installed in that category → LLM picks the best agent
```

Categories are the `.claude/agents/` folder names: `architecture consensus core design engineering github goal marketing monoswarm optimization specialists specialized templates testing`.

List the installed agent names in a category from the registry (or the definitions on disk):

```bash
CAT="engineering"
jq -r --arg c "$CAT" '.agents[] | select(.category == $c and .deprecated != true) | .name' .monomind/registry.json 2>/dev/null \
  || grep -h -m1 "^name:" packages/@monomind/cli/.claude/agents/$CAT/*.md .claude/agents/$CAT/*.md 2>/dev/null | sed 's/^name: *//'
```

**Stage 1 prompt to yourself:**
> "Given the task: `<task>` — which single category from this list best fits: `<category names>`? Answer with just the category name."

**Stage 2 prompt to yourself:**
> "Given the task: `<task>` — which single agent from this category is the best fit: `<agent names listed above>`? Answer with just the agent name."

If both stages come up empty, fall back to a core agent: `coder`, `reviewer`, `tester`, `researcher`, `planner`.

## Slug Mapping

The `subagent_type` is the agent's frontmatter `name:` — what the pick index returns as `name`, and what the registry lists as `.name`.

## Output Format

```
TASK: <one-line task summary>

PICKED BY: <[PICK] line | mcp__monomind__pick | monomind pick | category fallback: <category>>

RECOMMENDED AGENT: <Agent Name>
Invoke: Task({ subagent_type: "<agent name>", prompt: "..." })
```

Then ask: "Should I spawn this agent now?"

## Rules

1. Prefer the pick index; in the fallback, only pass names at each stage — no descriptions, no keyword dumps, no scoring tables
2. Recommend exactly one agent, and only a name that is installed
3. For tasks that clearly need a specialized tool (e.g. accessibility audits → Accessibility Auditor, not tester), prefer the more specific agent
4. Never recommend a generic role (coder, tester) when a specialized agent in the right domain exists
