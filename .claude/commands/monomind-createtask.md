---
name: monomind-createtask
description: "Monomind — Ingest a prompt, file, or folder, deeply understand it, generate a full implementation plan, and create self-contained tasks on monotask that coder agents can pick up"
---

If `$ARGUMENTS` is empty, output this and STOP:

> **Usage:** `/monomind:createtask <prompt | path-to-file | path-to-folder>`
>
> Examples:
> - `/monomind:createtask Build a webhook delivery system with retries and dead-letter queue`
> - `/monomind:createtask docs/superpowers/specs/2026-04-27-swarm-tab-redesign-design.md`
> - `/monomind:createtask docs/superpowers/specs/`
>
> This command deeply analyzes your input, generates a full implementation plan, and creates self-contained tasks on monotask that simple coder agents can execute without additional context.

Do NOT proceed further if no arguments were provided.

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

## Step 1: Classify and Ingest Input

Parse `$ARGUMENTS` to determine input type:

### 1a: Detect input type

- If `$ARGUMENTS` is an existing **file path** (check with `test -f`): `INPUT_TYPE=file`
- If `$ARGUMENTS` is an existing **directory path** (check with `test -d`): `INPUT_TYPE=folder`
- Otherwise: `INPUT_TYPE=prompt`

### 1b: Collect raw content

**If `INPUT_TYPE=prompt`:**
- Store the text as `RAW_CONTENT`.

**If `INPUT_TYPE=file`:**
- Read the file using the Read tool.
- Store the full contents as `RAW_CONTENT`.
- Store filename as `INPUT_LABEL`.

**If `INPUT_TYPE=folder`:**
- List all files in the directory (non-recursive, skip hidden files):
  ```bash
  find "$ARGUMENTS" -maxdepth 2 -type f ! -name '.*' | head -30
  ```
- Read each file using the Read tool (up to 30 files, skip binary files).
- Concatenate all contents with `--- FILE: <path> ---` separators as `RAW_CONTENT`.
- Store folder path as `INPUT_LABEL`.

### 1c: Enrich with knowledge systems

Run ALL of the following in parallel (skip any that error):

1. **Knowledge graph — suggest**: Call `mcp__monomind__graphify_suggest` with the first 200 chars of `RAW_CONTENT`.
2. **Knowledge graph — query**: If any specific module/component names appear in `RAW_CONTENT`, call `mcp__monomind__graphify_query` for each (up to 5 queries).
3. **Memory search**: Call `mcp__monomind__memory_search` with a summary of the input. Use top 5 results.
4. **README**: Read `README.md` (first 200 lines). Skip if missing.
5. **Package manifest**: Read whichever exists first: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`.
6. **Repo name**: Run `git remote get-url origin`, extract last path segment, strip `.git`. Fallback: `basename` of cwd. Store as `REPO_NAME`.

Bundle everything into `FULL_CONTEXT` = `RAW_CONTENT` + graph results + memory results + README + manifest.

---

## Step 2: Setup Monotask Space and Task Board

### Space
- Run `monotask space list` and check if a space named `$REPO_NAME` exists.
- If not, create it: `monotask space create "$REPO_NAME"`.
- Store `SPACE_ID`.

### Task Board
- List boards via `monotask board list --json`. For each board ID, run `monotask column list <BOARD_ID> --json` to find one whose columns contain `Todo` (the `monomind-task` board).
- If the `monomind-task` board does not exist:
  1. Create it: `monotask board create "monomind-task" --json` — store `TASK_BOARD_ID`.
  2. Add to space: `monotask space boards add $SPACE_ID $TASK_BOARD_ID`.
  3. Create columns in order:
     - `Backlog`
     - `Todo`
     - `In Progress`
     - `Review`
     - `Human in Loop`
     - `Done`
- Store all column IDs mapped by name.

---

## Step 3: Deep Analysis — Understand the Document

Spawn a `Software Architect` agent via the Agent tool. Provide it with:

- The complete `FULL_CONTEXT`
- The user's original `$ARGUMENTS`

The agent MUST produce a structured analysis:

```json
{
  "summary": "2-3 sentence overview of what this document/prompt is about",
  "goals": ["list of high-level goals or features described"],
  "components": [
    {
      "name": "component or module name",
      "description": "what it does",
      "dependencies": ["other components it depends on"],
      "files_likely_affected": ["paths from graphify or educated guesses"]
    }
  ],
  "technical_constraints": ["any constraints, tech stack requirements, or limitations mentioned"],
  "acceptance_criteria": ["testable conditions for when this is done"],
  "risks": ["potential pitfalls, ambiguities, or unknowns"]
}
```

Store as `ANALYSIS`.

---

## Step 4: Generate Implementation Plan

Spawn a `planner` agent via the Agent tool. Provide it with:

- The `ANALYSIS` from Step 3
- The `FULL_CONTEXT`
- The `REPO_NAME` and project info

The agent MUST produce an ordered list of implementation tasks. Each task must be **completely self-contained** — a coder agent with NO prior context should be able to execute it by reading only the task card.

For each task, produce:

```json
{
  "title": "Short action-oriented title (e.g. 'Add webhook retry logic with exponential backoff')",
  "description": "Detailed description: WHAT to build, WHY it's needed, WHERE it fits in the system",
  "context": "All relevant context a coder needs: existing patterns to follow, related files, API shapes, data models, config values. Include specific file paths from graphify results when available.",
  "acceptance_criteria": ["list of testable conditions that prove this task is done"],
  "checklist": ["step-by-step implementation steps the coder should follow"],
  "agent_type": "recommended agent type (e.g. coder, backend-dev, Frontend Developer, Security Engineer)",
  "priority": "critical | high | medium | low",
  "effort": 1-10,
  "dependencies": ["titles of other tasks that must complete first, or empty array"]
}
```

**Rules for task generation:**
- Tasks MUST be ordered so dependencies come first.
- Each task should take a single agent 5-30 minutes to complete.
- Tasks that are too large MUST be split.
- Every task MUST include enough context that the coder doesn't need to read the original document.
- Include a test-writing step in every task's checklist.
- Assign agent types from available agents (coder, backend-dev, Frontend Developer, Security Engineer, etc.) based on the task domain.

Store as `TASKS` array.

---

## Step 5: Create Tasks on Monotask Board

For each task in the `TASKS` array, in dependency order:

1. **Create the card** in the `Todo` column (dependency-free tasks) or `Backlog` column (has unfinished dependencies):
   ```bash
   monotask card create $TASK_BOARD_ID $COL_TODO "<title>" --json
   ```
   Store the returned `CARD_ID`.

2. **Set description** with the full context block:
   ```bash
   monotask card set-description $TASK_BOARD_ID $CARD_ID "<description>\n\n## Context\n<context>"
   ```

3. **Add agent assignment comment**:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "Assigned agent: <agent_type>"
   ```

4. **Add acceptance criteria comment**:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "Acceptance criteria:\n- <criterion 1>\n- <criterion 2>\n..."
   ```

5. **Add dependency comment** (if any):
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "Dependencies: <task title 1>, <task title 2>"
   ```

6. **Set priority**:
   ```bash
   monotask card set-priority $TASK_BOARD_ID $CARD_ID <1-4>
   ```
   Map: critical=1, high=2, medium=3, low=4.

7. **Create checklist** with implementation steps:
   ```bash
   monotask checklist add $TASK_BOARD_ID $CARD_ID "Implementation Steps" --json
   ```
   Store `CHECKLIST_ID`, then for each step:
   ```bash
   monotask checklist item-add $TASK_BOARD_ID $CARD_ID $CHECKLIST_ID "<step>"
   ```

Batch card creation commands where possible to reduce round-trips.

---

## Step 6: Exploration Session — Suggest Missing Pieces

After all tasks are created, spawn a **second** `Software Architect` agent (fresh context) via the Agent tool. Provide it with:

- The `ANALYSIS` from Step 3
- The complete list of `TASKS` already created (titles + descriptions)
- The `FULL_CONTEXT`

The agent must act as a **critical reviewer** and identify:

```json
{
  "missing_pieces": [
    {
      "title": "What's missing",
      "description": "Why this matters and what should be done",
      "category": "testing | documentation | error-handling | monitoring | security | performance | accessibility | deployment | migration"
    }
  ],
  "upcoming_plans": [
    {
      "title": "Natural follow-up work",
      "description": "What this would add and why it's worth considering",
      "category": "enhancement | optimization | scale | integration"
    }
  ]
}
```

**Areas to explore:**
- Missing test coverage (unit, integration, e2e)
- Error handling and edge cases not covered
- Documentation that should be created or updated
- Security considerations (input validation, auth, rate limiting)
- Performance implications (caching, indexing, pagination)
- Monitoring and observability (logging, metrics, alerts)
- Migration or backwards compatibility concerns
- Deployment steps or configuration changes needed
- Accessibility requirements (for UI tasks)

### Present to User

Output the suggestions in a clear format:

```
## Missing Pieces

| # | Category     | Title                              | Description                |
|---|-------------|------------------------------------|----------------------------|
| 1 | testing     | Add integration tests for webhook  | Currently only unit tests  |
| 2 | security    | Rate-limit webhook endpoints       | Prevent abuse              |

## Potential Follow-ups

| # | Category     | Title                              | Description                |
|---|-------------|------------------------------------|----------------------------|
| 1 | enhancement | Add webhook analytics dashboard    | Track delivery rates       |
```

Then ask:

> **Found N missing pieces and M potential follow-ups.**
>
> Reply with the numbers you want to add as tasks (e.g., `1, 3, 5` or `all` or `none`).
> Missing pieces will be added to **Todo**. Follow-ups will be added to **Backlog**.

### Process User Selection

If the user selects items:
1. For each selected **missing piece**: Create a task card in `Todo` with full context (same Step 5 process). Add a comment: `"Source: exploration — missing piece"`.
2. For each selected **follow-up**: Create a task card in `Backlog` with full context. Add a comment: `"Source: exploration — follow-up suggestion"`.

If the user says `none` or declines, skip.

---

## Step 7: Final Summary

Output:

```
## Task Creation Complete

**Source:** <prompt text | file path | folder path>
**Space:** $REPO_NAME (ID: $SPACE_ID)
**Board:** monomind-task (ID: $TASK_BOARD_ID)

### Tasks Created

| # | Title                                   | Agent        | Priority | Column  |
|---|----------------------------------------|-------------|----------|---------|
| 1 | <title>                                | backend-dev | high     | Todo    |
| 2 | <title>                                | coder       | medium   | Todo    |
| 3 | <title>                                | Frontend Developer | medium | Backlog |

**Total:** N tasks in Todo, M tasks in Backlog
**Estimated effort:** X points
```

---

## Step 8: Offer to Execute

If there are tasks in Todo, ask:

> **N tasks are ready for execution.** Want me to start `/monomind:do` to process them?
>
> It will pick up tasks one by one, execute them with the assigned agent, review for bugs, and loop until the queue is empty.

If the user agrees, invoke:
```
Skill("monomind-do", "--space $SPACE_ID --board $TASK_BOARD_ID")
```
