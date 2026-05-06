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
| Architecture | `/mastermind:architect` | Review structure, dedup files, DDD, design, migration, system design (`--scope review|design|deduplicate|migrate|all`) |
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

> Flags: `--auto` (skip confirmation) · `--confirm` (always ask before spawning) · `--project <name>` (set project name) · `--iterate <N>` (run N autonomous improvement cycles after initial execution)

---

**If $ARGUMENTS is non-empty:** Execute the full flow below.

---

## Execution Flow

### Step 1 — Parse flags

Extract from `$ARGUMENTS`:
- `--auto` → mode = auto
- `--confirm` → mode = confirm
- `--project <name>` → project_name = <name>
- `--iterate <N>` → iterate = N (integer ≥ 1; default 0 = no iteration)
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

**After intake resolves:** Generate a session ID (`mm-<YYYYMMDDTHHmmss>`) and emit `session:start` to the live dashboard (see Real-Time Dashboard Event Logging in `_protocol.md`). If the server is unreachable, continue without blocking.

```javascript
WebFetch({
  url: "http://localhost:4242/api/mastermind/event",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "session:start",
    session: sessionId,        // store this ID for all subsequent events
    prompt: resolvedPrompt,
    mode: mode,
    ts: Date.now()
  })
})
```

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

**Before spawning:** For EACH domain in `domains_needed`, emit a `domain:dispatch` event to the live dashboard:

```javascript
// Emit for each domain — use WebFetch for each (or batch them)
WebFetch({
  url: "http://localhost:4242/api/mastermind/event",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "domain:dispatch",
    session: sessionId,
    domain: "<domain-id>",    // e.g. "build", "marketing"
    cmd: "<one-line goal for this domain>",
    ts: Date.now()
  })
})
```

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

SESSION ID: <sessionId>   ← use this in all dashboard events

YOUR RESPONSIBILITIES:
1. Break this goal into discrete tasks using /monomind:createtask
   Each task description MUST follow the Monotask Task Briefing Standard (full context, goal, scope, constraints, success criteria, agent, swarm, dependencies)
2. Spawn specialized agents for each task using the Task tool:
   - Backend work: subagent_type "backend-dev"
   - Frontend work: subagent_type "frontend-dev"
   - Testing: subagent_type "tester"
   - Code review: subagent_type "reviewer"
   Default swarm: hierarchical 6 agents raft
3. BEFORE spawning each agent, emit agent:spawn to the live dashboard:
   WebFetch({ url: "http://localhost:4242/api/mastermind/event", method: "POST",
     headers: {"Content-Type":"application/json"},
     body: JSON.stringify({ type:"agent:spawn", session:"<sessionId>",
       domain:"build", agent:"<agent-slug>", task:"<task-description>", ts:Date.now() }) })
4. If you hand off artifacts to another domain manager, emit intercom:
   WebFetch({ url: "http://localhost:4242/api/mastermind/event", method: "POST",
     headers: {"Content-Type":"application/json"},
     body: JSON.stringify({ type:"intercom", session:"<sessionId>",
       from:"build", to:"<other-domain>", msg:"<one-line summary>", ts:Date.now() }) })
5. Execute tasks via /monomind:do --board <board_id>
6. Collect all agent outputs
7. BEFORE returning, emit domain:complete to the live dashboard:
   WebFetch({ url: "http://localhost:4242/api/mastermind/event", method: "POST",
     headers: {"Content-Type":"application/json"},
     body: JSON.stringify({ type:"domain:complete", session:"<sessionId>",
       domain:"build", status:"complete|partial|blocked",
       artifacts:["/path/file1"], decisions:[{what:"...",confidence:0.9}], ts:Date.now() }) })
8. Return unified output schema to master:
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
4. **Emit `session:complete` to the live dashboard:**

```javascript
WebFetch({
  url: "http://localhost:4242/api/mastermind/event",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "session:complete",
    session: sessionId,
    status: overallStatus,    // "complete" | "partial" | "blocked"
    domains: completedDomains,
    ts: Date.now()
  })
})
```

5. Compose the action summary for the user:

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

---

### Step 12 — Iteration Loop (only if `--iterate <N>` was set and N ≥ 1)

After Step 11, run N autonomous improvement cycles. Each cycle is a full self-directed run — no user input required.

**For each cycle i = 1 … N:**

#### 12a — Assess Current State

Load fresh brain context (repeat Brain Load Procedure from `_protocol.md`). Then evaluate the project's current state by examining:
- What was just completed (artifacts from the most recent run's output schema)
- What the brain's `next_actions` entries suggest
- What the `next_actions` from all domain outputs say
- What the git diff shows (if applicable) — any test failures, TODOs, or incomplete work
- What gaps exist relative to the original prompt's success criteria

#### 12b — Decide Next Activity

Choose the single highest-value activity for this cycle. Rank candidates by this priority:

| Priority | Activity | Choose when |
|---|---|---|
| 1 | **Test** | New code exists with no test coverage, or tests failed |
| 2 | **Debug / Fix** | Tests are failing or artifacts have known errors |
| 3 | **Review** | Significant new code exists with no review pass |
| 4 | **Improve / Refactor** | Code works but has quality issues surfaced by review or brain |
| 5 | **Add feature** | Core is stable; next_actions suggest new capability aligned with project goal |
| 6 | **Research** | Significant unknowns remain before next feature can be decided |
| 7 | **Content / Docs** | Feature is complete and undocumented |
| 8 | **Release** | Project is stable, tested, reviewed — ready to ship |

State the decision explicitly:
> "Cycle <i>/<N>: I'm choosing to **<activity>** because <one-sentence reason>. Confidence: <0.0–1.0>"

Log this as a decision in the cycle's output schema with `confidence` set accordingly.

#### 12c — Execute

Execute the chosen activity by invoking the appropriate domain skill directly (Steps 4–10 of the main flow, condensed):

- Test → `Skill("mastermind:build")` with a testing-focused prompt
- Debug/Fix → `Skill("mastermind:build")` with the specific issue as prompt
- Review → `Skill("mastermind:review")` with scope = artifacts from last run
- Improve/Refactor → `Skill("mastermind:build")` with refactor prompt
- Add feature → `Skill("mastermind:build")` with the next feature from next_actions
- Research → `Skill("mastermind:research")` with the open question as prompt
- Content/Docs → `Skill("mastermind:content")` with scope = new artifacts
- Release → `Skill("mastermind:release")` with project scope

Always pass: the current brain_context, project_name, the relevant board_id, and mode = auto (iteration cycles never pause for confirmation).

#### 12d — Brain Write

Follow Brain Write Procedure from `_protocol.md` for this cycle's domain. Score and append.

#### 12e — Cycle Summary

Output a compact progress line:

```
ITERATION <i>/<N> — <activity> — <status: complete|partial|blocked>
  → <one-line summary of what was done>
  → Next cycle will: <predicted next activity based on current state>
```

If the cycle returns `status: blocked`, skip remaining cycles and report:
> "Iteration halted at cycle <i>: blocked on <reason>. Remaining <N-i> cycles skipped."

---

After all N cycles complete, output a final iteration summary:

```
ITERATION COMPLETE — <N> cycles — <project_name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cycle 1: test       → 12 tests added, all passing
Cycle 2: review     → 3 issues found, 2 fixed inline
Cycle 3: improve    → auth module refactored, 15% complexity reduction
...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Brain updated: <total decisions scored and logged>
Project state: <one-sentence assessment of where things stand>
Suggested next: <what a human should do or approve next>
```
