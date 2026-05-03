---
name: monomind-do
description: "Monomind — Execute tasks from monomind-task board with parallel, minimal, or sequential agent modes, smart context group routing, and review cycles"
---

## Argument Parsing

Parse `$ARGUMENTS` for the following flags (in any order):

- `--space <SPACE_ID>` — use this space directly (skip space discovery)
- `--board <BOARD_ID>` — use this task board directly (skip board discovery)
- `--filter <text>` — only process tasks whose title contains this text (case-insensitive)
- `--mode <parallel|minimal|sequential>` — execution mode (default: ask user)
- `--max-agents <N>` — cap total agent spawns per run (default: 20). Prevents runaway costs on large boards.

If `$ARGUMENTS` contains none of these flags, treat the entire string as a filter (legacy mode).

If `--space` and `--board` are both provided, skip Step 1 entirely and go straight to column discovery on the given board.

---

## Step 0: Check monotask CLI

Run:
```bash
command -v monotask
```

If `monotask` is NOT found, attempt to install:
```bash
command -v cargo && cargo install monotask
```

If `cargo` is also missing, output this and STOP:
> monotask requires Rust. Install Rust first:
> ```bash
> curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
> source "$HOME/.cargo/env"
> cargo install monotask
> ```

---

## Step 1: Find the Task Board

**If `--space` and `--board` were provided:** Skip discovery. Use the provided `SPACE_ID` and `TASK_BOARD_ID` directly. Jump to column discovery.

**Otherwise, discover them:**

1. **Repo name**: Run `git remote get-url origin`, extract the last path segment, strip `.git`. Fallback: `basename` of the current working directory. Store as `REPO_NAME`.

2. **Find space**: Run `monotask space list` and find the space named `$REPO_NAME`. If no space exists, output "No monotask space found. Run `/monomind:idea` first." and STOP. Store `SPACE_ID`.

3. **Find task board**: List boards via `monotask board list --json`. For each board ID, run `monotask column list <BOARD_ID> --json` to find one whose title is `monomind-task`. If not found, output "No monomind-task board found. Run `/monomind:idea` first." and STOP. Store `TASK_BOARD_ID`.

4. **Store column IDs**: Run `monotask column list $TASK_BOARD_ID --json` and map all columns by name: `COL_BACKLOG`, `COL_TODO`, `COL_IN_PROGRESS`, `COL_REVIEW`, `COL_HUMAN_IN_LOOP`, `COL_DONE`.

---

## Step 2: Scan All Tasks and Build Execution Plan

### 2a: Load all pending tasks

List cards in `Todo` and `Backlog`:
```bash
monotask card list $TASK_BOARD_ID $COL_TODO --json
monotask card list $TASK_BOARD_ID $COL_BACKLOG --json
```

If `--filter` was set, filter by title match.

If no cards found, output:
```
[monomind:do] No tasks in Todo or Backlog. Queue empty.
```
Remove any loop state files and STOP.

### 2b: Read task metadata

For each card, read its comments to extract:
- **Assigned agent type** (from "Assigned agent:" comment)
- **Context group** (from "Context group:" comment)
- **Prerequisites** (from "Prerequisites:" comment)
- **Parallel safe** (from "Parallel safe:" comment, default `true`)

### 2c: Build context groups

Group tasks by their `context_group` value:
- Tasks with the same context group form a **chain** — they run sequentially on the same agent
- Tasks with `context_group: independent` or no group are **independent** — they can run on any agent
- Within a chain, order by prerequisites (prerequisite first)

### 2d: Check session memory for execution strategy

Call `mcp__monomind__memory_search` with `"task-strategy:<REPO_NAME>"`. If a recent strategy exists, use its `recommended_execution_mode` as the default.

### 2e: Choose execution mode

**If `--mode` was provided:** Use that mode.

**If session memory has a recommendation:** Present it as default.

**Otherwise, ask the user:**

```
[monomind:do] Found N tasks: X in context groups, Y independent.

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
export DO_LOOP_ID="do-$(date +%s%3N)"
cat > ".monomind/loops/${DO_LOOP_ID}.json" << EOF
{
  "id": "${DO_LOOP_ID}",
  "type": "do",
  "prompt": "/monomind:do $ARGUMENTS",
  "mode": "${EXEC_MODE}",
  "currentTask": "starting...",
  "spaceId": "${SPACE_ID:-}",
  "boardId": "${TASK_BOARD_ID:-}",
  "filter": "${FILTER:-}",
  "startedAt": $(date +%s%3N),
  "lastRunAt": $(date +%s%3N),
  "nextRunAt": 0,
  "status": "running"
}
EOF
```

Check if a stop was requested:
```bash
[ -f ".monomind/loops/${DO_LOOP_ID}.stop" ] && echo "DO_STOP_REQUESTED=true"
```
If `DO_STOP_REQUESTED=true`, output `[monomind:do] Stop requested via dashboard. Halting.`, remove state files, and STOP.

---

## Step 4: Execute Based on Mode

### Agent Budget Guard

Before spawning, count total agents needed:
- **Parallel**: one per context group + one per independent task
- **Minimal**: one per context group + one shared
- **Sequential**: one

If total exceeds `--max-agents` (default: 20), downgrade mode automatically:
- Parallel → Minimal (if still over budget → Sequential)
- Output: `[monomind:do] Agent budget exceeded (N > max-agents). Downgrading to <mode>.`

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

TASK: <title>
<full task context, checklist, acceptance criteria>

1. Implement the changes following the checklist
2. Write/update tests
3. Verify tests pass
4. Commit with descriptive message
5. Report: DONE | DONE_WITH_CONCERNS | BLOCKED (with details)
```

Move all cards to `In Progress` before spawning agents:
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

For each task being assigned to an agent, gather:

1. **Card details**: Run `monotask card view $TASK_BOARD_ID $CARD_ID` to get title, description, impact, effort, priority.

2. **Comments**: Run `monotask card comment list $TASK_BOARD_ID $CARD_ID --json`. Parse for:
   - Task description and context
   - Assigned agent type
   - Context group and prerequisites
   - Acceptance criteria
   - Additional notes

3. **Checklist**: Run `monotask card checklist list $TASK_BOARD_ID $CARD_ID --json`. If a checklist exists, include as step-by-step guide.

Bundle into `TASK_CONTEXT` for that task.

---

## Step 7: Handle Agent Results

After each agent completes (or all agents in parallel mode), process results:

### For each completed task:

**If DONE or DONE_WITH_CONCERNS:**
- Proceed to review cycle (Step 8)

**If BLOCKED:**
1. Add the blocking question as a comment:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "Blocked: <question or issue>"
   ```
2. Move card to `Human in Loop`:
   ```bash
   monotask card move $TASK_BOARD_ID $CARD_ID $COL_HUMAN_IN_LOOP --json
   ```
3. **Chain failure propagation**: If this task belongs to a context group chain, ALL remaining tasks in that chain are now blocked. For each subsequent task in the chain:
   ```bash
   monotask card move $TASK_BOARD_ID $DEPENDENT_CARD_ID $COL_BACKLOG --json
   monotask card comment add $TASK_BOARD_ID $DEPENDENT_CARD_ID "Chain paused: prerequisite '<blocked task title>' is blocked. Reason: <blocker summary>"
   ```
   Do NOT attempt to execute remaining chain tasks — they depend on the blocked task's output and context.

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
- Add a comment listing the unresolved issues
- Move card to `Human in Loop` instead of `Review`
- STOP processing this card

### 8c: If APPROVED

Proceed to Step 9.

---

## Step 9: Update Board Based on Result

### If APPROVED (from review cycle):
1. Add a comment summarizing the changes and review outcome:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "Completed and reviewed: <summary>"
   ```
2. If there's a checklist, mark completed items:
   ```bash
   monotask card checklist check $TASK_BOARD_ID $CARD_ID <ITEM_ID>
   ```
3. If DONE_WITH_CONCERNS, add concerns:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "Concerns: <concerns>"
   ```
4. Move card to `Review`:
   ```bash
   monotask card move $TASK_BOARD_ID $CARD_ID $COL_REVIEW --json
   ```
5. **Unblock dependents**: If this task was a prerequisite for other tasks, move those from `Backlog` to `Todo`:
   ```bash
   monotask card move $TASK_BOARD_ID $DEPENDENT_CARD_ID $COL_TODO --json
   ```

---

## Step 10: Summary and Next Cycle

Output a status summary:
```
[monomind:do] Execution complete (mode: <parallel|minimal|sequential>)

| Task                          | Status         | Agent        | Review     |
|-------------------------------|----------------|-------------|------------|
| <title>                       | Review         | backend-dev | approved   |
| <title>                       | Review         | coder       | approved   |
| <title>                       | Human in Loop  | coder       | blocked    |
```

Then check for remaining tasks:
```bash
monotask card list $TASK_BOARD_ID $COL_TODO --json
monotask card list $TASK_BOARD_ID $COL_BACKLOG --json
```

If tasks remain (including newly unblocked ones), output:
```
[monomind:do] Remaining: N in Todo, M in Backlog. Processing next batch in 2 minutes...
```

Update loop state and use `ScheduleWakeup` with `delaySeconds: 120` and prompt `/monomind:do --space $SPACE_ID --board $TASK_BOARD_ID --mode $EXEC_MODE` (plus `--filter` if one was set).

If no tasks remain, output:
```
[monomind:do] All tasks processed. Queue empty.
```

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
