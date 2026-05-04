---
name: mastermind-master
description: Mastermind top-level orchestrator — receives any business prompt, loads the brain, decomposes into domains, spawns domain manager agents via Task tool, synthesizes results, and writes back to the brain. The single entry point for full business automation.
---

**If $ARGUMENTS is empty:** Output the capability menu below and wait.

---

**MASTERMIND**
*Your autonomous business brain.*

Describe what you want to accomplish and I'll handle the rest — or pick a domain directly.

| Domain | Command | What it does |
|---|---|---|
| Full automation | *(you're here)* | Route to all needed domains automatically |
| Development | `/mastermind:build` | Ship features, fix bugs, refactor |
| Ideas | `/mastermind:idea` | Brainstorm products, features, pivots |
| Marketing | `/mastermind:marketing` | Campaigns, copy, SEO, social |
| Review | `/mastermind:review` | Code, content, strategy, metrics |
| Research | `/mastermind:research` | Market, competitor, user research |
| Content | `/mastermind:content` | Blog, threads, docs, newsletters |
| Release | `/mastermind:release` | Version, changelog, deploy |
| Sales | `/mastermind:sales` | Outreach, proposals, pipeline |
| Operations | `/mastermind:ops` | Workflow automation, reporting |
| Finance | `/mastermind:finance` | Invoicing, tracking, forecasting |
| Brain | `/mastermind:brain` | Inspect and manage your business memory |

> Flags: `--auto` (skip confirmation) · `--confirm` (always ask before spawning) · `--project <name>` (set project name)

---

**If $ARGUMENTS is non-empty:** Execute the full flow below.

---

## Execution Flow

### Step 1 — Parse flags

Extract from `$ARGUMENTS`:
- `--auto` → mode = auto
- `--confirm` → mode = confirm
- `--project <name>` → project_name = <name>
- Remaining text = prompt

### Step 2 — Brain Load

Follow the Brain Load Procedure from `_protocol.md`:

1. Call `mcp__monomind__agentdb_hierarchical-recall` namespace `mastermind:principles` (limit 20)
2. For each domain that appears relevant to the prompt, call `mcp__monomind__agentdb_context-synthesize` namespace `mastermind:<domain>:weekly`
3. Call `mcp__monomind__monograph_query` with 3-5 keywords from the prompt

Assemble the BRAIN CONTEXT block from results.

### Step 3 — Intake

Invoke the intake logic from `_intake.md`:

- Check if prompt is rich (≥20 words + domain signals + goal phrase)
- If vague: ask intake questions one at a time (Q1–Q5, stop when enough context)
- If user says "decide yourself": make explicit LLM decision, state it, log it with confidence 0.7
- Resolve: mode (auto/confirm), project_name, domains_needed

### Step 4 — Decompose

For each domain in `domains_needed`, assess complexity:
- **Simple** (skill-only): single task, single agent, < 30 minutes estimated — invoke skill directly
- **Complex** (manager agent): multi-step, multi-file, multi-day, or multi-agent — spawn a Task agent

Complexity threshold for manager agent: any of these is true:
- Requires 3+ files to be created/modified
- Requires 2+ specialized agent types
- Has external dependencies (APIs, services)
- Is estimated to take more than one conversation turn

### Step 5 — Plan Output

Build a plan summary:

```
MASTERMIND PLAN — <project_name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Prompt: <prompt>
Mode: <auto|confirm>

Domains activated:
  ✦ build → Development Manager agent → board: <project>/development
  ✦ marketing → Marketing Manager agent → board: <project>/marketing

Monotask space: <project_name>
Brain loaded: <N> principles, <M> domain summaries
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If mode = confirm: show plan and wait for user to say "go" or modify. If mode = auto: proceed immediately.

### Step 6 — Monotask Setup

For each active domain:
1. Find or create monotask space named `<project_name>`
2. Create a board named `<domain>` within that space
3. Note the board ID for the domain manager's task briefing

### Step 7 — Spawn Domain Managers

Spawn ALL domain manager agents in ONE message using the Task tool (parallel execution).

Each Task call must include a complete briefing following the Monotask Task Briefing Standard from `_protocol.md`. Include:
- The full BRAIN CONTEXT block
- The board ID
- The specific goal for this domain
- The project name and run context
- Instruction to use `/monomind:createtask` for all sub-tasks
- Instruction to use `/monomind:do` to execute
- Instruction to spawn specialized agents using the domain-appropriate swarm topology
- Instruction to return the unified output schema when done

Example Task call for Development Manager:
```javascript
Task({
  subagent_type: "coordinator",
  description: `You are the Development Manager for project <project_name>.

CONTEXT: Mastermind run <date> | Project: <project_name> | Master spawned you.

BRAIN CONTEXT:
<paste brain context here>

YOUR BOARD: <board_id> (monotask://<project_name>/development)

GOAL: <domain-specific goal extracted from prompt>

YOUR RESPONSIBILITIES:
1. Break this goal into discrete tasks using /monomind:createtask
   Each task description MUST follow the Monotask Task Briefing Standard (full context, goal, scope, constraints, success criteria, agent, swarm, dependencies)
2. Spawn specialized agents for each task using the Task tool:
   - Backend work: subagent_type "backend-dev"
   - Frontend work: subagent_type "frontend-dev"
   - Testing: subagent_type "tester"
   - Code review: subagent_type "reviewer"
   Default swarm: hierarchical 6 agents raft
3. Execute tasks via /monomind:do --board <board_id>
4. Collect all agent outputs
5. Return unified output schema to master:
   domain: build
   status: complete|partial|blocked
   artifacts: [...]
   decisions: [...]
   lessons: [...]
   next_actions: [...]
   board_url: monotask://<project_name>/development
   run_id: <ISO8601-timestamp>`,
  run_in_background: true
})
```

### Step 8 — Wait for Reports

Collect the unified output schema from each domain manager. If a manager reports `status: blocked`, note the blocker but continue collecting from others — do not abort.

### Step 9 — Synthesize

1. Collect all domain output schemas
2. Identify any cross-domain artifacts needed (e.g. a release that requires both build and review)
3. Write cross-domain artifacts to disk if needed
4. Compose the action summary for the user:

```
MASTERMIND RUN COMPLETE — <project_name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status: complete | partial | blocked

Domains completed: build ✓ | marketing ✓
Domains blocked: (none)

Artifacts produced:
  /path/to/file1 (code)
  /path/to/file2 (copy)

Key decisions made:
  • [what] — [why] (confidence: X)

Next actions suggested:
  • /mastermind:review --project <project_name>
  • /mastermind:release --project <project_name>

Monotask boards:
  → monotask://<project_name>/development
  → monotask://<project_name>/marketing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 10 — Brain Write

Follow the Brain Write Procedure from `_protocol.md` for each domain that ran:
1. Score all decisions from this run
2. Append to Tier 1 raw log (AgentDB)
3. Check and trigger weekly compaction if threshold met
4. Check and trigger graph consolidation if cluster detected

### Step 11 — Output to User

Show the action summary (Step 9). If any compaction ran during Step 10, append:
> "Brain updated: compacted <N> entries into <M> summaries."
