---
name: monomind-task-engine
description: Unified task creation engine — grouping rules, card format, board setup, card creation, dependency review, session memory. Called by /monomind:createtask, /monomind:idea, and /monomind:improve.
version: 1.0.0
triggers:
  - unified task creation
  - task engine
  - create tasks on board
---

# Monomind Task Engine — Unified Task Creation

This skill is the single source of truth for how tasks are created across all monomind slash commands. It is invoked by `monomind:createtask`, `monomind:idea`, and `monomind:improve` — never directly by the user.

**Caller provides:**
- `TASKS` array (the raw task objects from the planner/architect agent)
- `TASK_BOARD_ID` and column IDs
- `REPO_NAME`
- `SOURCE_TAG` (e.g. `"monomind-createtask"`, `"monomind-idea"`, `"monomind-improve"`)
- `SOURCE_SUMMARY` (one-line description of what generated these tasks)
- `PARENT_CARD_ID` (optional — the idea/improvement card to annotate)
- `PARENT_BOARD_ID` (optional — the idea/improve board)
- `PARENT_DONE_COLUMN` (optional — column to move parent to, e.g. `Tasked`)

**This skill handles:**
1. Task Grouping Rules (validation)
2. Card Creation on monotask
3. Session Memory storage
4. Final Dependency & Critical Path Review

---

## Section 1: Task Grouping Rules

These rules MUST be followed by whatever agent generates the `TASKS` array. Include them in the agent's prompt.

### Rule 1: Context Affinity — Group what shares context.
Work that modifies the same files, shares types/interfaces, or requires understanding the same domain model belongs in ONE task. A new agent spinning up cold should not need to re-read what a previous agent just wrote.

Examples of what to group together:
- Creating a new type/interface AND the first function that uses it
- Adding a database migration AND the model code that uses the new schema
- Modifying a shared config AND all code that reads that config
- Writing a function AND its unit tests (always together)

### Rule 2: Size Limit — Split large context groups into prerequisite chains.
If a context group would take >30 minutes, split it into sequential tasks linked by `prerequisites`. The `monomind:do` executor ensures prerequisite tasks are picked up by the same agent, preserving context.

### Rule 3: Independence — Split what has no shared context.
Work that touches completely different modules, has no shared types, and can be understood in isolation should be separate tasks. These can run in parallel on different agents.

### Rule 4: Test Colocation — Tests live with their implementation.
Never create standalone "write tests" tasks. Tests for a piece of code belong in the same task as that code. The only exception is integration/e2e tests that span multiple components — those get their own task after all component tasks.

### Rule 5: Prerequisite Chains for Ordering.
Use `prerequisites` (not just `dependencies`) to enforce execution order. Prerequisites guarantee:
- The prerequisite task completes before the dependent starts
- The same agent picks up the chain (preserving context)
- If a prerequisite is blocked, dependents stay in Backlog

### Rule 6: Chain Size Limit — Max 4 tasks per chain prompt.
Anthropic research shows accuracy degrades when context exceeds 60-70% utilization. If a context group has >4 tasks, split it into two sub-chains. The first sub-chain's last task becomes a prerequisite for the second sub-chain's first task.

### Rule 7: Agent Capability Validation.
After assigning agent types, cross-check: does the agent type match the files/tools the task requires? A `Frontend Developer` should not be assigned database migration work. A `backend-dev` should not be assigned CSS/styling tasks. If a task spans multiple domains, either split it or assign the agent type that covers the majority of the work.

---

## Section 2: Task Card Format

Every task in the `TASKS` array MUST follow this schema:

```json
{
  "title": "Action-oriented title (verb + noun + context)",
  "description": "## What\nExact deliverable.\n\n## Why\nBusiness or technical motivation.\n\n## Where\nFile paths, module boundaries.\n\n## Patterns\nExisting conventions to follow.",
  "context": "All relevant context a coder needs: existing patterns, related files, API shapes, data models. Include file paths from graphify. Include output/changes from prerequisite tasks if any.",
  "definition_of_done": [
    "Specific, binary, verifiable condition"
  ],
  "testing_criteria": {
    "unit_tests": ["function(input) → expected outcome"],
    "integration_tests": ["endpoint + method → status + response shape"],
    "edge_cases": ["boundary condition → expected behavior"]
  },
  "acceptance_criteria": ["list of testable conditions that prove this task is done"],
  "checklist": [
    "Write failing test for [specific behavior]",
    "Implement [function/class] in [file path]",
    "Run tests — verify green",
    "Commit: '[type]: [description]'"
  ],
  "agent_type": "best-fit agent from 230+ roster",
  "priority": "critical | high | medium | low",
  "effort": "1-10 (1=trivial, 10=full day)",
  "prerequisites": ["titles of tasks that MUST complete first — same agent picks these up in order"],
  "parallel_safe": true,
  "context_group": "name of the context chain this belongs to, or 'independent'"
}
```

### Field requirements:
- **`parallel_safe`**: `true` if this task can run simultaneously with other `parallel_safe` tasks. `false` if it modifies shared state that other tasks read.
- **`context_group`**: Tasks in the same group share state and should be executed by the same agent. The executor uses this to batch assignments.
- **`prerequisites`**: Titles of tasks that MUST complete first. Same agent picks these up in order.
- All DOD items must be binary (pass/fail, not "looks good")
- Testing criteria must name specific functions, endpoints, inputs
- Each task: 5-30 minutes for a single agent

---

## Section 3: Task Board Setup

If the calling command hasn't already set up the `monomind-task` board:

1. Check if a `monomind-task` board exists in the space:
   ```bash
   monotask board list --json
   ```
   For each board ID, run `monotask column list <BOARD_ID> --json` to find one with a `Todo` column.

2. If not, create it:
   ```bash
   monotask board create "monomind-task" --json
   monotask space boards add $SPACE_ID $TASK_BOARD_ID
   ```

3. Create columns in order:
   - `Backlog`
   - `Todo`
   - `In Progress`
   - `Review`
   - `Human in Loop`
   - `Done`

4. Store all column IDs mapped by name.

---

## Section 4: Create Cards on Monotask Board

For each task in the `TASKS` array, in prerequisite order:

1. **Create the card** in `Todo` (no prerequisites) or `Backlog` (has prerequisites):
   ```bash
   monotask card create $TASK_BOARD_ID $COLUMN "<title>" --json
   ```
   Store the returned `CARD_ID`.

2. **Set description** with full context:
   ```bash
   monotask card set-description $TASK_BOARD_ID $CARD_ID "<description>\n\n## Context\n<context>\n\n## Context Group\n<context_group>"
   ```

3. **Add DOD comment** (if `definition_of_done` exists):
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "## Definition of Done\n- [ ] <condition 1>\n- [ ] <condition 2>\n..."
   ```

4. **Add testing criteria comment** (if `testing_criteria` exists):
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "## Testing Criteria\n\n### Unit Tests\n- <test 1>\n\n### Integration Tests\n- <test 1>\n\n### Edge Cases\n- <case 1>"
   ```

5. **Add acceptance criteria comment** (if `acceptance_criteria` exists):
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "Acceptance criteria:\n- <criterion 1>\n- <criterion 2>\n..."
   ```

6. **Add agent assignment + context group metadata**:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "Assigned agent: <agent_type>\nContext group: <context_group>\nParallel safe: <true|false>\nPriority: <priority>\nEffort: <effort>/10\nPrerequisites: <task titles or none>\nSource: <SOURCE_TAG>"
   ```

7. **Tag the card**:
   ```bash
   monotask card tag add $TASK_BOARD_ID $CARD_ID "<SOURCE_TAG>"
   ```

8. **Set priority**:
   ```bash
   monotask card set-priority $TASK_BOARD_ID $CARD_ID <1-4>
   ```
   Map: critical=1, high=2, medium=3, low=4.

9. **Create checklist** with implementation steps:
   ```bash
   monotask checklist add $TASK_BOARD_ID $CARD_ID "Implementation Steps" --json
   ```
   Then for each step:
   ```bash
   monotask checklist item-add $TASK_BOARD_ID $CARD_ID $CHECKLIST_ID "<step>"
   ```

10. **Annotate parent card** (if `PARENT_CARD_ID` provided):
    After all tasks are created, comment on the parent card:
    ```bash
    monotask card comment add $PARENT_BOARD_ID $PARENT_CARD_ID "Subtasks created:\n- <title> (agent: <type>, group: <context_group>, effort: <N>/10)\n- <title> (agent: <type>, group: <context_group>, effort: <N>/10)\n..."
    ```
    Then move the parent to `PARENT_DONE_COLUMN`:
    ```bash
    monotask card move $PARENT_BOARD_ID $PARENT_CARD_ID $PARENT_DONE_COLUMN --json
    ```

Batch card creation commands where possible to reduce round-trips.

---

## Section 5: Store Session Memory — Execution Strategy

After all cards are created, store the execution strategy in monomind memory:

Call `mcp__monomind__memory_store` with:
```json
{
  "key": "task-strategy:<REPO_NAME>:<timestamp>",
  "content": {
    "source": "<SOURCE_TAG>: <SOURCE_SUMMARY>",
    "total_tasks": N,
    "context_groups": [
      {
        "name": "group name",
        "task_titles": ["ordered list of task titles in this group"],
        "recommended_agent": "agent type best suited for this group",
        "sequential": true
      }
    ],
    "independent_tasks": ["titles of tasks safe to parallelize"],
    "recommended_execution_mode": "parallel | minimal | sequential",
    "reasoning": "Why this mode fits the task distribution"
  },
  "tags": ["task-strategy", "<SOURCE_TAG>"]
}
```

**Mode selection logic:**
- **parallel**: Most tasks are independent (`parallel_safe: true`), different modules, different agents. Best throughput.
- **minimal**: Mix of independent and chained tasks. Use 2-3 agents — one per context group, plus one for independent tasks.
- **sequential**: Heavy shared state, most tasks are prerequisites of each other. One agent does everything in order.

---

## Section 6: Final Dependency & Critical Path Review

**This is mandatory.** After all cards are created and session memory is stored, spawn a fresh `Code Reviewer` agent via the Agent tool to perform a final review of the entire task graph.

### Review Agent Prompt

Provide the agent with:
- The complete `TASKS` array (all titles, prerequisites, context groups, agent types, effort scores)
- The `REPO_NAME` and project context summary

The agent MUST check all of the following:

### 6a: Prerequisite Integrity
- [ ] Every task referenced in a `prerequisites` field actually exists in the task list
- [ ] No circular prerequisites (A → B → C → A)
- [ ] Prerequisites are in correct order (prerequisite comes before dependent in the list)
- [ ] No orphaned tasks (task with prerequisites where the prerequisite doesn't exist)

### 6b: Context Group Consistency
- [ ] All tasks in the same `context_group` have compatible `agent_type` values (same agent can handle all of them)
- [ ] No context group has >4 tasks (Rule 6 violation)
- [ ] Tasks within a group are correctly linked by prerequisites (forming a chain, not disconnected)
- [ ] No task belongs to two different context groups

### 6c: Critical Path Analysis
- [ ] Identify the longest prerequisite chain (critical path) and report its total effort
- [ ] Flag if the critical path has >6 tasks (risk of context degradation even with sub-chains)
- [ ] Flag if any single task on the critical path has effort >7 (should be split further)
- [ ] Report estimated wall-clock time: `critical_path_effort * 10 minutes` for sequential, `max(group_effort) * 10 minutes` for parallel

### 6d: Parallel Safety Validation
- [ ] Tasks marked `parallel_safe: true` don't modify files that other parallel tasks also modify
- [ ] Tasks marked `parallel_safe: false` are in a context group or have prerequisites that serialize them
- [ ] Independent tasks don't have hidden dependencies (same file path in different tasks)

### 6e: Agent Assignment Sanity
- [ ] No frontend agent assigned to backend-only tasks (and vice versa)
- [ ] No agent type appears in >5 different context groups (agent overload)
- [ ] Integration/e2e test tasks are scheduled after all component tasks they test

### Review Output Format

The agent MUST return:

```json
{
  "status": "APPROVED | NEEDS_FIXES",
  "critical_path": {
    "chain": ["task title 1", "task title 2", "..."],
    "total_effort": N,
    "estimated_minutes": M
  },
  "issues": [
    {
      "severity": "blocker | warning",
      "category": "prerequisite | context_group | critical_path | parallel_safety | agent_assignment",
      "description": "What's wrong",
      "fix": "What to change"
    }
  ],
  "summary": {
    "total_tasks": N,
    "context_groups": M,
    "independent_tasks": K,
    "critical_path_length": L,
    "estimated_parallel_minutes": P,
    "estimated_sequential_minutes": S
  }
}
```

### Handling Review Results

**If `APPROVED`:**
- Output the summary to the user
- Proceed to execution offer

**If `NEEDS_FIXES`:**

For each **blocker** issue:
1. Apply the fix (update the card on monotask):
   - Fix prerequisites: add/remove prerequisite comments
   - Fix context groups: update metadata comments
   - Split oversized tasks: create new cards, update prerequisites
   - Reassign agents: update agent assignment comments
2. After all fixes applied, re-run the review (max 2 fix cycles)

For each **warning** issue:
1. Present to user with the fix suggestion
2. Ask: "Apply these fixes? (y/n/select numbers)"
3. Apply selected fixes

If still `NEEDS_FIXES` after 2 fix cycles, present remaining issues to user and proceed anyway with a warning.

---

## Section 7: Execution Offer

After review passes, present the execution options:

```
[monomind] N tasks ready. Critical path: M tasks, ~P minutes parallel / ~S minutes sequential.

How do you want to execute?

1. **Parallel** — One agent per context group + independent tasks simultaneously. Fastest. (~X agents)
2. **Minimal** — One agent per context group + one shared agent for independents. Balanced. (~Y agents)
3. **Sequential** — One agent processes everything in order. Cheapest.

Recommended: **<mode>** — <reason>
```

If the user picks a mode, invoke:
```
Skill("monomind-do", "--space $SPACE_ID --board $TASK_BOARD_ID --mode <parallel|minimal|sequential>")
```
