---
name: monomind:createtask
description: "Monomind — Ingest a prompt, file, or folder, deeply understand it, generate agent-optimized tasks on monotask with smart grouping, prerequisites, and session memory"
version: 1.0.0
triggers:
  - /monomind:createtask
  - create tasks from spec
  - decompose into tasks
  - turn this into tasks
  - break this down into tasks
  - create implementation tasks
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

## Step 0: Verify monotask CLI

```bash
command -v monotask || (command -v cargo && cargo install monotask)
```
If neither exists, tell user to install Rust + monotask and STOP.

---

## Step 1: Classify and Ingest Input

Parse `$ARGUMENTS`:
- `test -f` → file: read with Read tool, store as `RAW_CONTENT`, store filename as `INPUT_LABEL`
- `test -d` → folder: `find "$ARGUMENTS" -maxdepth 2 -type f ! -name '.*' | head -30`, read each, concatenate with `--- FILE: <path> ---` separators as `RAW_CONTENT`
- Otherwise → prompt: store text directly as `RAW_CONTENT`

---

## Step 2: Enrich with Project Context

Run ALL in parallel (skip errors):
1. `mcp__monomind__monograph_suggest` with first 200 chars of `RAW_CONTENT`
2. `mcp__monomind__monograph_query` for module/component names found in `RAW_CONTENT` (up to 5)
3. `mcp__monomind__memory_search` with input summary
4. Read `README.md` (first 200 lines)
5. Read first found: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`
6. Repo name from `git remote get-url origin` (strip path, strip `.git`) — store as `REPO_NAME`

Bundle everything into `FULL_CONTEXT`.

---

## Step 3: Setup Monotask Space and Board

**Space**: Find or create space named `$REPO_NAME`. Store `SPACE_ID`.

**Board**: Find `monomind-task` board (identify by checking columns for `Todo`). If missing, create:
```bash
monotask board create "monomind-task" --json
monotask space boards add $SPACE_ID $TASK_BOARD_ID
```
Create columns in order: `Backlog` → `Todo` → `In Progress` → `Review` → `Human in Loop` → `Done`

Store all column IDs mapped by name. Store `TASK_BOARD_ID`.

---

## Step 4: Deep Analysis

Spawn a `Software Architect` agent. Provide `FULL_CONTEXT` + `$ARGUMENTS`.

Required output:
```json
{
  "summary": "2-3 sentence overview",
  "goals": ["high-level goals"],
  "components": [
    {
      "name": "component name",
      "description": "what it does",
      "dependencies": ["other components"],
      "files_likely_affected": ["paths from monograph or educated guesses"]
    }
  ],
  "technical_constraints": ["stack requirements, limitations"],
  "acceptance_criteria": ["testable conditions for when the whole thing is done"],
  "risks": ["pitfalls, ambiguities, unknowns"]
}
```

Store as `ANALYSIS`.

---

## Step 5: Generate Professional Tasks

Spawn a `planner` agent. Provide analysis + `FULL_CONTEXT`.

### Task Grouping Rules (enforce all 7)

1. **Context Affinity**: Work sharing the same files, types, or domain model goes in ONE task. Tests always travel with their implementation.
2. **Size Limit**: If a context group exceeds 30 minutes, split into a prerequisite chain.
3. **Independence**: Work touching different modules with no shared types should be separate (parallelizable).
4. **Test Colocation**: Never create standalone "write tests" tasks — only exception is integration/e2e tests spanning multiple components.
5. **Prerequisite Chains**: Use `prerequisites` to enforce ordering. Same agent picks up the chain in sequence.
6. **Chain Size Limit**: Max 4 tasks per chain. Split larger chains into two sub-chains linked by prerequisite.
7. **Agent Capability**: Agent type must match the domain (no frontend agent on DB migrations, no backend-dev on CSS).

### Task Card Format

For each task, produce:
```json
{
  "title": "Action-oriented title (verb + noun + context)",
  "description": "## What\nExact deliverable.\n\n## Why\nMotivation.\n\n## Where\nFile paths, module boundaries.\n\n## Patterns\nExisting conventions to follow.",
  "context": "All relevant context: patterns, related files, API shapes, data models. Include file paths from monograph.",
  "definition_of_done": ["Specific, binary, verifiable condition"],
  "testing_criteria": {
    "unit_tests": ["function(input) → expected outcome"],
    "integration_tests": ["endpoint + method → status + response shape"],
    "edge_cases": ["boundary condition → expected behavior"]
  },
  "checklist": [
    "Write failing test for [specific behavior]",
    "Implement [function/class] in [file path]",
    "Run tests — verify green",
    "Commit: '[type]: [description]'"
  ],
  "agent_type": "best-fit agent from 230+ roster",
  "priority": "critical | high | medium | low",
  "effort": "1-10",
  "prerequisites": ["titles of tasks that MUST complete first"],
  "parallel_safe": true,
  "context_group": "name of context chain, or 'independent'"
}
```

Store as `TASKS` array.

---

## Step 6: Create Cards on Monotask

For each task, in prerequisite order:

1. **Create card** in `Todo` (no prerequisites) or `Backlog` (has prerequisites):
   ```bash
   monotask card create $TASK_BOARD_ID $COLUMN_ID "<title>" --json
   ```

2. **Set description**:
   ```bash
   monotask card set-description $TASK_BOARD_ID $CARD_ID "<description>\n\n## Context\n<context>\n\n## Context Group\n<context_group>"
   ```

3. **Add DOD comment**:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "## Definition of Done\n- [ ] <condition 1>\n..."
   ```

4. **Add testing criteria comment**:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "## Testing Criteria\n\n### Unit Tests\n- <test 1>\n\n### Integration Tests\n- <test 1>\n\n### Edge Cases\n- <case 1>"
   ```

5. **Add agent assignment + metadata**:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "Assigned agent: <agent_type>\nContext group: <context_group>\nParallel safe: <true|false>\nPriority: <priority>\nEffort: <effort>/10\nPrerequisites: <task titles or none>\nSource: monomind:createtask"
   ```

6. **Set priority**: `monotask card set-priority $TASK_BOARD_ID $CARD_ID <1-4>` (critical=1, high=2, medium=3, low=4)

7. **Create checklist**:
   ```bash
   monotask checklist add $TASK_BOARD_ID $CARD_ID "Implementation Steps" --json
   ```
   Then per step: `monotask checklist item-add $TASK_BOARD_ID $CARD_ID $CHECKLIST_ID "<step>"`

---

## Step 7: Store Session Memory

Call `mcp__monomind__memory_store` with:
```json
{
  "key": "task-strategy:<REPO_NAME>:<timestamp>",
  "content": {
    "source": "monomind:createtask: <first 100 chars of $ARGUMENTS>",
    "total_tasks": "N",
    "context_groups": [
      { "name": "group name", "task_titles": ["..."], "recommended_agent": "agent type", "sequential": true }
    ],
    "independent_tasks": ["titles of parallel-safe tasks"],
    "recommended_execution_mode": "parallel | minimal | sequential",
    "reasoning": "Why this mode fits"
  },
  "tags": ["task-strategy", "monomind:createtask"]
}
```

Mode selection: **parallel** = mostly independent tasks; **minimal** = mixed; **sequential** = heavy shared state.

---

## Step 8: Final Dependency Review

Spawn a fresh `Code Reviewer` agent. Provide the complete `TASKS` array and `REPO_NAME`.

The agent MUST check:
- **Prerequisite integrity**: all referenced prerequisites exist, no circular deps, no orphans
- **Context group consistency**: compatible agent types per group, no group >4 tasks, tasks in group are chained
- **Critical path**: identify longest chain, flag if >6 tasks or any single task >effort 7
- **Parallel safety**: `parallel_safe: true` tasks don't share modified files
- **Agent assignment**: no frontend agent on backend tasks, no agent in >5 context groups

**If APPROVED**: present summary and proceed to execution offer.
**If NEEDS_FIXES**: auto-fix blockers (update card comments), present warnings to user, max 2 fix cycles.

---

## Step 9: Gap Analysis

Spawn a fresh `Software Architect` agent as critical reviewer. Provide `ANALYSIS` + all created tasks.

Identify:
- **Missing pieces**: testing gaps, error handling holes, security oversights, missing migrations
- **Follow-ups**: natural extensions, performance optimizations

Present as tables. Ask user which to add (`numbers`, `all`, or `none`). Selected missing pieces → `Todo`; follow-ups → `Backlog`.

---

## Step 10: Summary and Execution Offer

Output:
```
## Task Creation Complete

**Source:** <input>
**Space:** $REPO_NAME | **Board:** monomind-task

| # | Title | Agent | Priority | Effort | Column | Deps |
|---|-------|-------|----------|--------|--------|------|
| 1 | ...   | ...   | high     | 3      | Todo   | —    |

**Total:** N tasks (X in Todo, Y in Backlog)
```

If there are tasks in Todo:
> **N tasks ready.** Start `/monomind:do` to execute them autonomously?

If yes: `Skill("monomind:do", "--space $SPACE_ID --board $TASK_BOARD_ID")`
