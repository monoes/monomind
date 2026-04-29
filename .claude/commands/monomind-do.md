---
name: monomind-do
description: "Monomind — Pick up tasks from monomind-task board, execute them with smart agent selection, review, fix bugs, then loop every 2 minutes"
---

## Argument Parsing

Parse `$ARGUMENTS` for the following flags (in any order):

- `--space <SPACE_ID>` — use this space directly (skip space discovery)
- `--board <BOARD_ID>` — use this task board directly (skip board discovery)
- `--filter <text>` — only process tasks whose title contains this text (case-insensitive)

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

**If `--space` and `--board` were provided:** Skip discovery. Use the provided `SPACE_ID` and `TASK_BOARD_ID` directly. Jump to step 4.

**Otherwise, discover them:**

1. **Repo name**: Run `git remote get-url origin`, extract the last path segment, strip `.git`. Fallback: `basename` of the current working directory. Store as `REPO_NAME`.

2. **Find space**: Run `monotask space list` and find the space named `$REPO_NAME`. If no space exists, output "No monotask space found. Run `/monomind:idea` first." and STOP. Store `SPACE_ID`.

3. **Find task board**: List boards via `monotask board list --json`. For each board ID, run `monotask column list <BOARD_ID> --json` to find one whose title is `monomind-task`. If not found, output "No monomind-task board found. Run `/monomind:idea` first." and STOP. Store `TASK_BOARD_ID`.

4. **Store column IDs**: Run `monotask column list $TASK_BOARD_ID --json` and map all columns by name: `COL_BACKLOG`, `COL_TODO`, `COL_IN_PROGRESS`, `COL_REVIEW`, `COL_HUMAN_IN_LOOP`, `COL_DONE`.

---

## Step 1.5: Initialize Loop State

Generate a loop ID and write the initial state file so the dashboard can track this run:
```bash
mkdir -p .monomind/loops
export DO_LOOP_ID="do-$(date +%s%3N)"
cat > ".monomind/loops/${DO_LOOP_ID}.json" << EOF
{
  "id": "${DO_LOOP_ID}",
  "type": "do",
  "prompt": "/monomind:do $ARGUMENTS",
  "currentTask": "discovering...",
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

Also check if a stop was requested from a previous cycle:
```bash
[ -f ".monomind/loops/${DO_LOOP_ID}.stop" ] && echo "DO_STOP_REQUESTED=true"
```
If `DO_STOP_REQUESTED=true`, output `[monomind:do] Stop requested via dashboard. Halting.`, remove state files, and STOP.

## Step 2: Find Next Task

1. List cards in `Todo` first (prioritized), then `Backlog`:
   ```bash
   monotask card list $TASK_BOARD_ID $COL_TODO --json
   monotask card list $TASK_BOARD_ID $COL_BACKLOG --json
   ```

2. If `$ARGUMENTS` was provided, filter by title match.

3. Pick the **first available card** (Todo before Backlog). If no cards found, output:
   ```
   [monomind:do] No tasks in Todo or Backlog. Checking again in 2 minutes...
   ```
   Update loop state before scheduling:
   ```bash
   NEXT_AT=$(( $(date +%s%3N) + 120000 ))
   cat > ".monomind/loops/${DO_LOOP_ID}.json" << EOF
   {"id":"${DO_LOOP_ID}","type":"do","prompt":"/monomind:do $ARGUMENTS","currentTask":"queue empty — waiting","spaceId":"${SPACE_ID:-}","boardId":"${TASK_BOARD_ID:-}","filter":"${FILTER:-}","startedAt":$(cat .monomind/loops/${DO_LOOP_ID}.json 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('startedAt',0))" 2>/dev/null || date +%s%3N),"lastRunAt":$(date +%s%3N),"nextRunAt":${NEXT_AT},"status":"waiting"}
   EOF
   ```
   Then use `ScheduleWakeup` with `delaySeconds: 120` and prompt `/monomind:do --space $SPACE_ID --board $TASK_BOARD_ID` (plus `--filter` if one was set) to check again. STOP this iteration.

4. Store `CURRENT_CARD_ID` and `CURRENT_CARD_TITLE`.

---

## Step 3: Read Full Task Context

Gather ALL context for the selected card:

1. **Card details**: Run `monotask card view $TASK_BOARD_ID $CURRENT_CARD_ID` to get title, description, impact, effort, and priority.

2. **Comments**: Run `monotask card comment list $TASK_BOARD_ID $CURRENT_CARD_ID --json`. Parse for:
   - Task description (first comment)
   - **Assigned agent type** — look for a comment starting with "Assigned agent:" and extract the type
   - Additional context, edge cases, technical notes

3. **Checklist**: Run `monotask card checklist list $TASK_BOARD_ID $CURRENT_CARD_ID --json`. If a checklist exists, treat each unchecked item as a sub-step.

4. **Subtasks**: Check if comments reference subtask card IDs or child cards.

5. **Attached images**: If comments contain image paths or URLs, read them with the Read tool.

Bundle into `TASK_CONTEXT`.

---

## Step 4: Gather Project Context

Collect in parallel (skip any that error):

1. **README**: Read `README.md` (first 200 lines).
2. **Package manifest**: Read whichever exists first: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`.
3. **Memory search**: Call `mcp__monomind__memory_search` with the card title.
4. **Knowledge graph**: Call `mcp__monomind__graphify_suggest` with the card title.

Bundle into `PROJECT_CONTEXT`.

---

## Step 5: Move to In Progress

```bash
monotask card move $TASK_BOARD_ID $CURRENT_CARD_ID $COL_IN_PROGRESS --json
monotask card comment add $TASK_BOARD_ID $CURRENT_CARD_ID "Work started by monomind:do"
```

---

## Step 6: Assess Complexity and Choose Execution Mode

Analyze the task to determine complexity:

**Simple task** (single agent) — use when:
- Task touches 1-2 files
- Clear, self-contained scope
- Checklist has fewer than 4 items
- Effort score is 0-4

**Complex task** (swarm) — use when:
- Task touches 3+ files or multiple modules
- Has subtasks or long checklist (4+ items)
- Involves cross-cutting concerns (API + DB + tests + docs)
- Effort score is 5-10

### Simple mode: Single Agent

Determine the agent type from the "Assigned agent:" comment. If none specified, default to `coder`.

Spawn the agent via the Agent tool with:
- Full `TASK_CONTEXT` and `PROJECT_CONTEXT`
- The checklist items as step-by-step guide
- Instructions to commit changes with a descriptive message

### Complex mode: Swarm

Use a `hierarchical` swarm with `raft` consensus and `specialized` strategy.

Agent team (4-6 agents based on task domain):
- **coordinator** — plans and delegates subtasks
- **assigned agent type** (from card) — primary implementer
- **tester** — writes and runs tests for the changes
- Additional agents as needed based on task domain (e.g., `backend-dev` + `Frontend Developer` for full-stack work)

Spawn all agents in ONE message via the Agent tool. The coordinator receives the full task context and delegates to specialists.

### Agent prompt requirements (both modes):

The agent(s) MUST:
- Implement the task as described
- Follow the checklist if one exists
- Write or update tests for all changes
- Commit changes with descriptive messages
- Report back with one of:
  - **DONE**: Task completed. Include summary of changes and list of files modified.
  - **DONE_WITH_CONCERNS**: Task completed with concerns. Include concerns.
  - **BLOCKED**: Cannot complete. Include the specific question or blocker.

---

## Step 7: Handle Subtasks

After the main task completes, check for subtasks (child cards or referenced cards).

For each subtask:
1. Read its full context (same as Step 3)
2. Move to `In Progress`
3. Assess complexity and execute (same as Step 6, using the subtask's assigned agent or inheriting from parent)
4. Run through the review cycle (Step 8) independently

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
   monotask card comment add $TASK_BOARD_ID $CURRENT_CARD_ID "Completed and reviewed: <summary>"
   ```
2. If there's a checklist, mark completed items:
   ```bash
   monotask card checklist check $TASK_BOARD_ID $CURRENT_CARD_ID <ITEM_ID>
   ```
3. If DONE_WITH_CONCERNS, add concerns:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CURRENT_CARD_ID "Concerns: <concerns>"
   ```
4. Move card to `Review`:
   ```bash
   monotask card move $TASK_BOARD_ID $CURRENT_CARD_ID $COL_REVIEW --json
   ```

### If BLOCKED (from execution):
1. Add the blocking question:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CURRENT_CARD_ID "Blocked: <question or issue>"
   ```
2. Move card to `Human in Loop`:
   ```bash
   monotask card move $TASK_BOARD_ID $CURRENT_CARD_ID $COL_HUMAN_IN_LOOP --json
   ```

---

## Step 10: Summary and Next Cycle

Output a single status line:
```
[monomind:do] "<title>" → <Review | Human in Loop> (agent: <type>, mode: <single|swarm>, review: <approved|blocked>)
```

Then check for remaining tasks:
```bash
monotask card list $TASK_BOARD_ID $COL_TODO --json
monotask card list $TASK_BOARD_ID $COL_BACKLOG --json
```

If tasks remain, output:
```
[monomind:do] Remaining: N in Todo, M in Backlog. Next task in 2 minutes...
```

Use `ScheduleWakeup` with `delaySeconds: 120` and prompt `/monomind:do --space $SPACE_ID --board $TASK_BOARD_ID` (plus `--filter` if one was set) to process the next task.

If no tasks remain, output:
```
[monomind:do] All tasks processed. Queue empty.
```

Remove the loop state file:
```bash
rm -f ".monomind/loops/${DO_LOOP_ID}.json" ".monomind/loops/${DO_LOOP_ID}.stop"
```

Do NOT schedule another wake-up. STOP.
