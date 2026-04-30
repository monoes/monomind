---
name: monomind-createtask
description: "Monomind — Ingest a prompt, file, or folder, deeply understand it, generate agent-optimized tasks on monotask with smart grouping, prerequisites, and session memory"
---

If `$ARGUMENTS` is empty, output this and STOP:

> **Usage:** `/monomind:createtask <prompt | path-to-file | path-to-folder>`
>
> Examples:
> - `/monomind:createtask Build a webhook delivery system with retries and dead-letter queue`
> - `/monomind:createtask docs/superpowers/specs/2026-04-27-swarm-tab-redesign-design.md`
> - `/monomind:createtask docs/superpowers/specs/`
>
> This command deeply analyzes your input, generates an implementation plan, and creates **agent-optimized** tasks on monotask — grouped so each agent gets full context, with prerequisites ensuring execution order.

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
      "files_likely_affected": ["paths from graphify or educated guesses"],
      "shared_context_with": ["other component names that share state, models, or interfaces"]
    }
  ],
  "technical_constraints": ["any constraints, tech stack requirements, or limitations mentioned"],
  "acceptance_criteria": ["testable conditions for when this is done"],
  "risks": ["potential pitfalls, ambiguities, or unknowns"],
  "context_chains": [
    {
      "chain_name": "descriptive name for this context group",
      "components": ["ordered list of components that share context and should be done by same agent or sequentially"],
      "reason": "why these must share context (shared types, same file, state dependency, etc.)"
    }
  ]
}
```

Store as `ANALYSIS`.

---

## Step 4: Generate Agent-Optimized Implementation Plan

Spawn a `planner` agent via the Agent tool. Provide it with:

- The `ANALYSIS` from Step 3 (including `context_chains`)
- The `FULL_CONTEXT`
- The `REPO_NAME` and project info
- **The Task Grouping Rules and Card Format from `monomind-task-engine` skill (Sections 1 & 2)** — include them verbatim in the agent prompt so it produces correctly structured tasks

The agent MUST produce a `TASKS` array following the `monomind-task-engine` card format (Section 2). Each task must comply with all 7 grouping rules (Section 1).

Store as `TASKS` array.

---

## Step 5: Create Tasks, Store Memory, and Review

Invoke the `monomind-task-engine` skill (Sections 3-7) with these parameters:

| Parameter | Value |
|-----------|-------|
| `TASKS` | The array from Step 4 |
| `TASK_BOARD_ID` | From Step 2 (or let the engine set up the board) |
| `REPO_NAME` | From Step 1c |
| `SOURCE_TAG` | `"monomind-createtask"` |
| `SOURCE_SUMMARY` | First 100 chars of `$ARGUMENTS` |
| `PARENT_CARD_ID` | _(none — createtask has no parent card)_ |

The engine will:
1. Create all cards on the monotask board (Section 4)
2. Store execution strategy in session memory (Section 5)
3. Run the **Final Dependency & Critical Path Review** (Section 6) — a fresh Code Reviewer agent validates prerequisites, context groups, critical path, parallel safety, and agent assignments
4. Fix any blocker issues automatically, present warnings to user
5. Present execution offer with mode recommendation (Section 7)

---

## Step 7: Exploration Session — Suggest Missing Pieces

After all tasks are created, spawn a **second** `Software Architect` agent (fresh context) via the Agent tool. Provide it with:

- The `ANALYSIS` from Step 3
- The complete list of `TASKS` already created (titles + descriptions + context groups)
- The `FULL_CONTEXT`

The agent must act as a **critical reviewer** and identify:

```json
{
  "missing_pieces": [
    {
      "title": "What's missing",
      "description": "Why this matters and what should be done",
      "category": "testing | documentation | error-handling | monitoring | security | performance | accessibility | deployment | migration",
      "context_group": "which existing context group this belongs to, or 'new'"
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

### Present to User

Output the suggestions in a clear format:

```
## Missing Pieces

| # | Category     | Title                              | Context Group | Description                |
|---|-------------|------------------------------------|---------------|----------------------------|
| 1 | testing     | Add integration tests for webhook  | webhook-chain | Currently only unit tests  |
| 2 | security    | Rate-limit webhook endpoints       | independent   | Prevent abuse              |

## Potential Follow-ups

| # | Category     | Title                              | Description                |
|---|-------------|------------------------------------|----------------------------|
| 1 | enhancement | Add webhook analytics dashboard    | Track delivery rates       |
```

Then ask:

> **Found N missing pieces and M potential follow-ups.**
>
> Reply with the numbers you want to add as tasks (e.g., `1, 3, 5` or `all` or `none`).
> Missing pieces will be added to their context group. Follow-ups go to **Backlog**.

### Process User Selection

If the user selects items:
1. For each selected **missing piece**: Create a task card following the same grouping rules (Step 4). If it belongs to an existing context group, add prerequisite links. Add comment: `"Source: exploration — missing piece"`.
2. For each selected **follow-up**: Create a task card in `Backlog`. Add comment: `"Source: exploration — follow-up suggestion"`.

If the user says `none` or declines, skip.

---

## Step 8: Final Summary

Output:

```
## Task Creation Complete

**Source:** <prompt text | file path | folder path>
**Space:** $REPO_NAME (ID: $SPACE_ID)
**Board:** monomind-task (ID: $TASK_BOARD_ID)
**Execution strategy:** <parallel | minimal | sequential>

### Context Groups

| Group              | Tasks | Agent           | Mode       |
|--------------------|-------|-----------------|------------|
| <group name>       | 3     | backend-dev     | sequential |
| <group name>       | 2     | Frontend Developer | sequential |
| independent        | 4     | mixed           | parallel   |

### All Tasks

| # | Title                                   | Agent        | Priority | Group        | Prerequisites |
|---|----------------------------------------|-------------|----------|--------------|---------------|
| 1 | <title>                                | backend-dev | high     | api-chain    | —             |
| 2 | <title>                                | backend-dev | high     | api-chain    | Task 1        |
| 3 | <title>                                | coder       | medium   | independent  | —             |

**Total:** N tasks (X in Todo, Y in Backlog)
**Estimated effort:** Z points
**Recommended mode:** <parallel | minimal | sequential> — <one-line reason>
```

---

## Step 9: Offer to Execute

If there are tasks in Todo, ask:

> **N tasks are ready for execution.** How do you want to run them?
>
> 1. **Parallel** — Spawn one agent per context group + independent tasks run simultaneously. Fastest, best for independent work. (~N agents)
> 2. **Minimal** — 2-3 agents: one per major context group, one for independents. Balanced cost/speed.
> 3. **Sequential** — One agent processes tasks in order. Slowest but cheapest, best for heavy shared state.
>
> Recommended: **<mode>** — <reason>

If the user agrees or picks a mode, invoke:
```
Skill("monomind-do", "--space $SPACE_ID --board $TASK_BOARD_ID --mode <parallel|minimal|sequential>")
```
