---
name: mastermind:do
description: "Mastermind — Execute tasks from a task file (default, docs/tasks/) or monotask board (--monotask flag) with parallel, minimal, or sequential agent modes, context group routing, and review cycles"
---

## Repeat Flag Extraction

**Before all other parsing:** Extract and discard `--repeat`, `--tillend`, `--maxruns`, `--wait` from `$ARGUMENTS` so they don't interfere with the command's own argument parser. `mastermind:do` manages its own task-board-driven loop internally (see end of command) — the REPEAT POSTAMBLE is NOT used. To wrap this command with an external loop, use `/mastermind:repeat -- /mastermind:do ...`.

## Argument Parsing

**Extract `--monotask` flag first:** If `--monotask` is present, set `USE_MONOTASK=true` and remove it. Default: `USE_MONOTASK=false`.

Parse remaining `$ARGUMENTS` for the following flags (in any order):

- `--file <path>` — *(file mode only)* use this specific task file; skip file discovery
- `--space <SPACE_ID>` — *(monotask mode only)* use this space directly (skip space discovery)
- `--board <BOARD_ID>` — *(monotask mode only)* use this task board directly (skip board discovery)
- `--filter <text>` — only process tasks whose title contains this text (case-insensitive)
- `--mode <parallel|minimal|sequential>` — execution mode (default: ask user)
- `--max-agents <N>` — cap total agent spawns per run (default: 20)

If `$ARGUMENTS` contains none of these flags, treat the entire string as a filter (legacy mode).

**Auto-promote to monotask mode:** If `--space` and `--board` are both present (even without explicit `--monotask`), set `USE_MONOTASK=true` — these flags only make sense in monotask mode, so their presence implies it. This ensures old wakeup prompts without `--monotask` still work correctly.

If `USE_MONOTASK=true` AND `--space` and `--board` are both provided, skip Step 1 entirely and go straight to column discovery on the given board.

---

## Step 0: Check monotask CLI *(skip unless `--monotask` was passed)*

**Only run this step if `USE_MONOTASK=true`.**

```bash
command -v monotask
```
If not found: attempt `cargo install monotask`. If cargo missing, tell user to install Rust first and STOP.

---

## Step 1: Find Work

**File mode (default, `USE_MONOTASK=false`):**

If `--file <path>` was provided: use that path as `TASK_FILE`. Otherwise:
```bash
# Find the most recently modified task file
TASK_FILE=$(ls -t docs/tasks/*.md 2>/dev/null | head -1)
```
If no file found, output "No task file found. Run `/mastermind:createtask` first to generate one." and STOP.

Read `TASK_FILE`. Store the path — it will be passed through all continuation prompts.

---

**Monotask mode (`USE_MONOTASK=true`):**

If `--space` and `--board` were provided: use directly, jump to column discovery.

Otherwise:
1. **Repo name**: `git remote get-url origin` → strip path + `.git`. Fallback: `basename` of cwd. Store `REPO_NAME`.
2. **Find space**: `monotask space list` → find space named `$REPO_NAME`. If missing: "No monotask space found. Run `/mastermind:ideate` first." STOP. Store `SPACE_ID`.
3. **Find board**: `npx monomind@latest memory search "monomind-task board_id"` → use if found. Otherwise scan `monotask space boards list $SPACE_ID` for the one with a `Backlog` column. If not found: "No task board found. Run `/mastermind:createtask --monotask` first." STOP. Store `TASK_BOARD_ID`.
4. **Column IDs**: `monotask column list $TASK_BOARD_ID --json` → map `COL_BACKLOG`, `COL_TODO`, `COL_IN_PROGRESS`, `COL_REVIEW`, `COL_HUMAN_IN_LOOP`, `COL_DONE`.

---

## Step 2: Scan All Tasks and Build Execution Plan

### 2a: Load all pending tasks

**File mode:** Read `TASK_FILE`. Find all `## Task N: <title>` sections with `> status: todo` or `> status: backlog`. Follow the parsing spec in `_taskfile.md`. If `--filter` was set, keep only tasks whose title contains the filter text (case-insensitive).

**Monotask mode:** 
```bash
monotask card list $TASK_BOARD_ID $COL_TODO --json
monotask card list $TASK_BOARD_ID $COL_BACKLOG --json
```
Apply `--filter` if set.

If no tasks found (either mode), output:
```
[mastermind:do] No tasks in Todo or Backlog. Queue empty.
```
Remove any loop state files and STOP.

### 2b: Read task metadata

**File mode:** For each task section, extract from the blockquote lines:
- `> agent:` → assigned agent type
- `> context_group:` → context group
- `> prerequisites:` → prerequisites (comma-separated titles or "none")
- `> parallel_safe:` → parallel safe flag (default `true`)

**Monotask mode:** For each card, read its comments to extract the same fields from "Assigned agent:", "Context group:", "Prerequisites:", "Parallel safe:" comment lines.

### 2c: Build context groups

Group tasks by `context_group`:
- Same context group → **chain** (sequential, same agent)
- `independent` or no group → **independent** (parallelizable)
- Within a chain, order by prerequisites (prerequisite first)

### 2d: Check execution strategy

**File mode:** Read `recommended_mode` from the frontmatter of `TASK_FILE`. Use as the default.

**Monotask mode:** Call `mcp__monomind__memory_search` with `"task-strategy:<REPO_NAME>"`. If found, use `recommended_execution_mode` as default.

### 2e: Choose execution mode

**If `--mode` was provided:** Use that mode.

**If session memory has a recommendation:** Present it as default.

**Otherwise, ask the user:**

```
[mastermind:do] Found N tasks: X in context groups, Y independent.

Context groups:
  - <group-1>: 3 tasks (agent: backend-dev, sequential)
  - <group-2>: 2 tasks (agent: Frontend Developer, sequential)
  - independent: 4 tasks (mixed agents, parallelizable)

How do you want to execute?

1. **Parallel** — Spawn one agent per context group + one per independent task. (~N agents, fastest)
2. **Minimal** — One agent per context group + one shared agent for all independents. (~M agents, balanced)
3. **Sequential** — One agent processes everything in order. (1 agent, cheapest)
```

Store chosen mode as `EXEC_MODE`.

---

## Step 3: Initialize Loop State

Generate a loop ID and write the initial state file:
```bash
mkdir -p .monomind/loops
NOW_MS=$(python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo "$(date +%s)000")
export DO_LOOP_ID="do-${NOW_MS}"
cat > ".monomind/loops/${DO_LOOP_ID}.json" << EOF
{
  "id": "${DO_LOOP_ID}",
  "sessionId": "${DO_LOOP_ID}",
  "type": "do",
  "prompt": "/mastermind:do $ARGUMENTS",
  "mode": "${EXEC_MODE}",
  "currentTask": "starting...",
  "taskFile": "${TASK_FILE:-}",
  "spaceId": "${SPACE_ID:-}",
  "boardId": "${TASK_BOARD_ID:-}",
  "useMonotask": "${USE_MONOTASK:-false}",
  "filter": "${FILTER:-}",
  "startedAt": ${NOW_MS},
  "lastRunAt": ${NOW_MS},
  "nextRunAt": 0,
  "status": "running"
}
EOF
```

Check if a stop was requested:
```bash
[ -f ".monomind/loops/${DO_LOOP_ID}.stop" ] && echo "DO_STOP_REQUESTED=true"
```
If `DO_STOP_REQUESTED=true`, output `[mastermind:do] Stop requested via dashboard. Halting.`, remove state files, and STOP.

---

## Step 4: Execute Based on Mode

### Agent Budget Guard

Before spawning, count total agents needed:
- **Parallel**: one per context group + one per independent task
- **Minimal**: one per context group + one shared
- **Sequential**: one

If total exceeds `--max-agents` (default: 20), downgrade mode automatically:
- Parallel → Minimal (if still over budget → Sequential)
- Output: `[mastermind:do] Agent budget exceeded (N > max-agents). Downgrading to <mode>.`

Track `AGENTS_SPAWNED` counter. If it hits the limit mid-run (e.g., during review cycles), stop spawning and queue remaining work for the next cycle.

### Mode: Parallel

Spawn ALL agents in ONE message using the Agent tool:

**For each context group chain:**
- Spawn ONE agent of the chain's recommended type
- Provide it with ALL tasks in the chain, in prerequisite order
- The agent executes them sequentially, committing after each
- Agent prompt includes: full task context for ALL tasks in the chain, project context, instruction to execute in order

**For each independent task:**
- Spawn ONE agent of the task's assigned type
- Provide it with that single task's context
- The agent executes and commits

All agents run concurrently via `run_in_background: true`.

**Agent prompt template for chain execution:**
```
You have N tasks to execute in order. Complete each one before moving to the next.
Tasks share context — knowledge from earlier tasks applies to later ones.

== AGENT DELEGATION CAPABILITY ==
You have full access to the Agent tool (Claude Code: Task tool) to spawn
sub-agents for any specialized subtask. This capability is recursive —
sub-agents you spawn also receive it.

Available agent categories:
  CORE      coder · reviewer · tester · planner · researcher
  BACKEND   backend-dev · Backend Architect · DB Optimizer · API Tester
  FRONTEND  Frontend Developer · mobile-dev · Mobile App Builder
  ARCH      Software Architect · system-architect
  SECURITY  Security Engineer · security-architect
  AI/ML     AI Engineer · ml-developer · Data Engineer
  DEVOPS    DevOps Automator · SRE · cicd-engineer
  DOCS      Technical Writer · api-docs
  PRODUCT   Product Manager · Launch Strategist · CRO Specialist
  MARKETING Content Creator · SEO Specialist · Growth Hacker
  SOCIAL    TikTok · LinkedIn · Twitter · Instagram Strategist
  SALES     Deal Strategist · Sales Coach · Outbound Strategist
  BUSINESS  Finance Tracker · Legal Compliance Checker · Analytics Reporter
  DESIGN    Monodesign (UI/UX · brand · CSS · animation · design systems)

Delegate when: a subtask needs deeper expertise, parallel work speeds things up,
or a subtask is outside your domain but blocks your progress.
How: Agent({ subagent_type: "slug", prompt: `full briefing + this delegation block`, run_in_background: true })
=================================

TASK 1 of N: <title>
<full task context, checklist, acceptance criteria>

TASK 2 of N: <title>
<full task context, checklist, acceptance criteria>
...

For each task:
1. Implement the changes following the checklist
2. Write/update tests
3. Verify tests pass
4. Commit with descriptive message
5. Write a HANDOFF CONTEXT section (3-5 lines): what files changed, what decisions were made, what the next task needs to know
6. Report: DONE | DONE_WITH_CONCERNS | BLOCKED (with details)

IMPORTANT — Handoff Context:
After completing each task in the chain, write a brief ## Handoff Context block:
- Files created/modified (with paths)
- Key decisions made (naming, patterns chosen, trade-offs)
- State the next task inherits (new types, config values, API shapes)
This ensures continuity even if context is compressed between tasks.

If you are BLOCKED on any task, STOP the entire chain. Do not attempt subsequent tasks.
Report which task is blocked and list the remaining unstarted tasks.
```

**Agent prompt template for independent tasks:**
```
Execute this single task:

== AGENT DELEGATION CAPABILITY ==
You have full access to the Agent tool (Claude Code: Task tool) to spawn
sub-agents for any specialized subtask. This capability is recursive —
sub-agents you spawn also receive it.

Available agent categories:
  CORE      coder · reviewer · tester · planner · researcher
  BACKEND   backend-dev · Backend Architect · DB Optimizer · API Tester
  FRONTEND  Frontend Developer · mobile-dev · Mobile App Builder
  ARCH      Software Architect · system-architect
  SECURITY  Security Engineer · security-architect
  AI/ML     AI Engineer · ml-developer · Data Engineer
  DEVOPS    DevOps Automator · SRE · cicd-engineer
  DOCS      Technical Writer · api-docs
  PRODUCT   Product Manager · Launch Strategist · CRO Specialist
  MARKETING Content Creator · SEO Specialist · Growth Hacker
  SOCIAL    TikTok · LinkedIn · Twitter · Instagram Strategist
  SALES     Deal Strategist · Sales Coach · Outbound Strategist
  BUSINESS  Finance Tracker · Legal Compliance Checker · Analytics Reporter
  DESIGN    Monodesign (UI/UX · brand · CSS · animation · design systems)

Delegate when: a subtask needs deeper expertise, parallel work speeds things up,
or a subtask is outside your domain but blocks your progress.
How: Agent({ subagent_type: "slug", prompt: `full briefing + this delegation block`, run_in_background: true })
=================================

TASK: <title>
<full task context, checklist, acceptance criteria>

1. Implement the changes following the checklist
2. Write/update tests
3. Verify tests pass
4. Commit with descriptive message
5. Report: DONE | DONE_WITH_CONCERNS | BLOCKED (with details)
```

Mark tasks as in-progress before spawning agents:

*File mode:* For each task being dispatched, use Edit on `TASK_FILE` to change `> status: todo` → `> status: in_progress` in that task's section.

*Monotask mode:*
```bash
monotask card move $TASK_BOARD_ID $CARD_ID $COL_IN_PROGRESS --json
```

### Mode: Minimal

Same as parallel, but:
- One agent per context group chain (same as parallel)
- ONE shared agent for ALL independent tasks (executes them sequentially)
- Total agents = number of context groups + 1

### Mode: Sequential

Spawn ONE agent with ALL tasks (all chains flattened into prerequisite order, then independents):
- The single agent receives every task
- Executes them in order, committing after each
- Maximum context preservation, minimum cost

---

## Step 5: Gather Project Context (for agent prompts)

Collect in parallel (skip any that error):

1. **README**: Read `README.md` (first 200 lines).
2. **Package manifest**: Read whichever exists first: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`.
3. **Memory search**: Call `mcp__monomind__memory_search` with the first task's title.
4. **Knowledge graph**: Call `mcp__monomind__monograph_suggest` with the first task's title.

Bundle into `PROJECT_CONTEXT` and include in every agent prompt.

---

## Step 6: Read Full Task Context (for each task)

**File mode:** Read from `TASK_FILE` using the Read tool. For the target task, extract everything between `## Task N: <title>` and the next `---` separator. This includes: What/Why/Where/Context sections, Definition of Done checkboxes, Testing Criteria, and Checklist items. Bundle into `TASK_CONTEXT`.

**Monotask mode:**

1. `monotask card view $TASK_BOARD_ID $CARD_ID` → title, description, effort, priority
2. `monotask card comment list $TASK_BOARD_ID $CARD_ID --json` → parse for agent type, context group, prerequisites, acceptance criteria
3. Retrieve checklist:
   ```bash
   CHECKLIST_ID=$(monotask card comment list $TASK_BOARD_ID $CARD_ID --json \
     | jq -r '.[].text' | grep '^CHECKLIST_ID:' | head -1 | cut -d: -f2 | tr -d ' ')
   ```

Bundle into `TASK_CONTEXT` for that task.

---

## Step 7: Handle Agent Results

After each agent completes (or all agents in parallel mode), process results:

### For each completed task:

**If DONE or DONE_WITH_CONCERNS:**

*File mode:* Edit `TASK_FILE` — change `> status: in_progress` → `> status: review` in that task's section. (This prevents the task from being re-picked if the loop wakes up during the review cycle.)

*Monotask mode:* No status change yet — card stays in `In Progress` until reviewer approves in Step 9.

- Proceed to review cycle (Step 8)

**If BLOCKED:**

*File mode:* Use the Edit tool on `TASK_FILE`:
- Change `> status: in_progress` → `> status: blocked` in that task's section
- Append `> blocked_reason: <question or issue>` after the status line
- For each downstream chain task: change `> status: todo` → `> status: backlog` and append `> blocked_reason: prerequisite '<blocked task title>' is blocked`

*Monotask mode:*
```bash
monotask card comment add $TASK_BOARD_ID $CARD_ID "Blocked: <question or issue>"
monotask card move $TASK_BOARD_ID $CARD_ID $COL_HUMAN_IN_LOOP --json
# For each chain dependent:
monotask card move $TASK_BOARD_ID $DEPENDENT_CARD_ID $COL_BACKLOG --json
monotask card comment add $TASK_BOARD_ID $DEPENDENT_CARD_ID "Chain paused: prerequisite '<blocked task title>' is blocked. Reason: <blocker summary>"
```

Do NOT attempt to execute remaining chain tasks in either mode.

---

## Step 8: Review and Bug Fix Cycle

After execution completes (DONE or DONE_WITH_CONCERNS), run a review session BEFORE moving the card.

### 8a: Spawn a Code Reviewer

Spawn a `feature-dev:code-reviewer` agent via the Agent tool. Provide:
- The list of files modified (from the implementer's report)
- The `TASK_CONTEXT` (so the reviewer knows what was intended)
- The `PROJECT_CONTEXT`
- Instructions: review the changes for correctness, bugs, security issues, test coverage, and adherence to the task requirements. Run the test suite if one exists.

The reviewer MUST report:
- **APPROVED**: Changes look correct, tests pass, no issues found.
- **BUGS_FOUND**: List of specific bugs or issues found, with file paths and descriptions.
- **TESTS_FAILING**: Which tests fail and why.

### 8b: If BUGS_FOUND or TESTS_FAILING

Spawn the original implementer agent (same type) to fix the issues. Provide:
- The reviewer's findings (exact bug descriptions, failing tests)
- The original `TASK_CONTEXT` for reference
- Instructions: fix the reported issues, run tests, commit the fixes

After the fix agent completes, run the reviewer AGAIN (repeat 8a). Loop until the reviewer returns **APPROVED** or a maximum of 3 fix cycles. If still not approved after 3 cycles:

*File mode:* Edit `TASK_FILE` — change `> status: review` → `> status: blocked`, append `> blocked_reason: max review cycles reached — <list unresolved issues>`

*Monotask mode:*
```bash
monotask card comment add $TASK_BOARD_ID $CARD_ID "Unresolved issues: <list>"
monotask card move $TASK_BOARD_ID $CARD_ID $COL_HUMAN_IN_LOOP --json
```

STOP processing this card.

### 8c: If APPROVED

Proceed to Step 9.

---

## Step 9: Update State Based on Result

### If APPROVED (from review cycle):

*File mode:* Use the Edit tool on `TASK_FILE`:
1. Change `> status: review` → `> status: done` in that task's section
2. Replace all `- [ ]` with `- [x]` in that task's Checklist section
3. If DONE_WITH_CONCERNS: append `> concerns: <concerns>` after the status line
4. **Unblock dependents**: Follow the "Prerequisite Unblock Logic" from `_taskfile.md` — find tasks whose prerequisites are now all `done` and change their status from `backlog` to `todo`.

*Monotask mode:*
```bash
monotask card comment add $TASK_BOARD_ID $CARD_ID "Completed and reviewed: <summary>"
# Mark checklist items:
ITEM_IDS=$(monotask card comment list $TASK_BOARD_ID $CARD_ID --json \
  | jq -r '.[].text' | grep '^ITEM_IDS:' | head -1 | sed 's/^ITEM_IDS: //')
for ITEM_ID in $(echo "$ITEM_IDS" | tr ',' '\n'); do
  [ -n "$ITEM_ID" ] && monotask checklist item-check $TASK_BOARD_ID $CARD_ID $CHECKLIST_ID "$ITEM_ID"
done
# If DONE_WITH_CONCERNS:
monotask card comment add $TASK_BOARD_ID $CARD_ID "Concerns: <concerns>"
# Move to Review:
monotask card move $TASK_BOARD_ID $CARD_ID $COL_REVIEW --json
# Unblock dependents:
monotask card move $TASK_BOARD_ID $DEPENDENT_CARD_ID $COL_TODO --json
```

---

## Step 10: Summary and Next Cycle

Output a status summary:
```
[mastermind:do] Execution complete (mode: <parallel|minimal|sequential>)

| Task                          | Status         | Agent        | Review     |
|-------------------------------|----------------|-------------|------------|
| <title>                       | Review         | backend-dev | approved   |
| <title>                       | Review         | coder       | approved   |
| <title>                       | Human in Loop  | coder       | blocked    |
```

Then check for remaining tasks:

*File mode:* Re-read `TASK_FILE`. Count sections with `> status: todo` or `> status: backlog`.

*Monotask mode:*
```bash
monotask card list $TASK_BOARD_ID $COL_TODO --json
monotask card list $TASK_BOARD_ID $COL_BACKLOG --json
```

If tasks remain (including newly unblocked ones), output:
```
[mastermind:do] Remaining: N in Todo, M in Backlog. Processing next batch in 2 minutes...
```

Update loop state and use `ScheduleWakeup` with `delaySeconds: 120`.

- **File mode:** prompt = `/mastermind:do --file <TASK_FILE> --mode <EXEC_MODE>` (append `--filter <FILTER>` if set)
- **Monotask mode:** prompt = `/mastermind:do --monotask --space $SPACE_ID --board $TASK_BOARD_ID --mode $EXEC_MODE` (append `--filter <FILTER>` if set)

If no tasks remain, output:
```
[mastermind:do] All tasks processed. Queue empty.
```

To repeat this command on a schedule, wrap it with `/mastermind:repeat`.

### Store execution outcome in session memory

Call `mcp__monomind__memory_store` with:
```json
{
  "key": "execution-outcome:<REPO_NAME>:<timestamp>",
  "content": {
    "mode": "<EXEC_MODE>",
    "tasks_completed": N,
    "tasks_blocked": M,
    "agents_spawned": K,
    "review_cycles": L,
    "outcome": "success | partial | blocked",
    "lessons": ["any patterns observed — e.g. 'context groups worked well', 'task X was too large']"
  },
  "tags": ["execution-outcome", "monomind-do"]
}
```

Remove the loop state file:
```bash
rm -f ".monomind/loops/${DO_LOOP_ID}.json" ".monomind/loops/${DO_LOOP_ID}.stop"
```

Do NOT schedule another wake-up. STOP.
