---
name: monomind-improve
description: "Monomind — Deeply analyze a project component, research improvements online, and create improvement tasks on monotask boards"
---

If `$ARGUMENTS` is empty, output this and STOP:

> **Usage:** `/monomind:improve <component or concept>`
>
> Examples:
> - `/monomind:improve the authentication flow`
> - `/monomind:improve error handling across the codebase`
> - `/monomind:improve CLI startup performance`
> - `/monomind:improve the MCP server architecture`
>
> This command deeply analyzes the target component inside your project, researches improvement directions online, evaluates them, and decomposes the best ones into professional tasks on monotask boards. All cards are tagged `monomind-improve`.

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

Verify monotask is now available before continuing.

---

## Step 1: Gather Project Context

Collect ALL of the following in parallel (skip any that error):

1. **Repo name**: Run `git remote get-url origin`, extract the last path segment, strip `.git`. Fallback: `basename` of the current working directory. Store as `REPO_NAME`.

2. **README**: Read `README.md` (first 200 lines). Skip if missing.

3. **Package manifest**: Read whichever exists first: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`. Extract name, description, and keywords/tags.

4. **Knowledge graph**: Call `mcp__monomind__graphify_suggest` with the user's prompt (`$ARGUMENTS`). Skip if it errors or returns empty.

5. **Memory search**: Call `mcp__monomind__memory_search` with the user's prompt (`$ARGUMENTS`). Use the top 5 results.

Bundle all gathered information into a single `PROJECT_CONTEXT` string for downstream agents.

---

## Step 2: Deep Component Analysis

This is what differentiates `/monomind:improve` from `/monomind:idea`. Before generating improvement ideas, we must deeply understand the current state of the target component.

Spawn 2 agents in parallel via the Agent tool:

### Agent 1: `feature-dev:code-explorer`

Provide it with `$ARGUMENTS` and `PROJECT_CONTEXT`. It must:

1. **Trace the component** — find all files, functions, classes, and modules related to the target. Use `mcp__monomind__graphify_query` for each key term found.
2. **Map dependencies** — what does the component depend on? What depends on it? Use `mcp__monomind__graphify_shortest_path` for key relationships.
3. **Identify pain points** — look for:
   - Code smells (large files, deep nesting, god objects, duplicated logic)
   - Missing tests or low coverage areas
   - Performance bottlenecks (synchronous I/O, N+1 patterns, unnecessary allocations)
   - Security gaps (unvalidated inputs, missing auth checks, exposed secrets)
   - API inconsistencies (naming, error shapes, response formats)
   - Outdated patterns (callbacks vs async/await, old library versions)
   - Missing error handling or silent failures
4. **Measure complexity** — count files, lines, dependencies, and circular references.

Return a structured analysis:
```json
{
  "component": "name",
  "files": ["list of files touched"],
  "total_lines": N,
  "dependency_count": N,
  "pain_points": [
    { "type": "code-smell|perf|security|api|testing|pattern", "description": "...", "file": "path", "severity": "critical|high|medium|low" }
  ],
  "strengths": ["things that are already well done"],
  "architecture_notes": "how it fits into the larger system"
}
```

### Agent 2: `researcher` (with WebSearch)

Provide it with `$ARGUMENTS` and `PROJECT_CONTEXT`. It must:

1. **Search for best practices** related to the component's domain (e.g., "authentication best practices 2025", "CLI performance optimization techniques").
2. **Find competitor/prior art** — how do similar tools/libraries solve this?
3. **Search for common improvements** — what do blog posts, conference talks, and docs recommend?
4. **Identify emerging patterns** — new libraries, frameworks, or techniques relevant to this area.

Return structured research:
```json
{
  "best_practices": [
    { "title": "...", "description": "...", "source": "url or reference" }
  ],
  "prior_art": [
    { "project": "name", "approach": "how they solve it", "takeaway": "what we can learn" }
  ],
  "emerging_patterns": [
    { "pattern": "name", "description": "...", "relevance": "why it matters for us" }
  ]
}
```

After both agents complete, merge their outputs into `COMPONENT_ANALYSIS`.

---

## Step 3: Setup Monotask Space and Improve Board

### Space
- Run `monotask space list` and check if a space named `$REPO_NAME` already exists.
- If not, create it: `monotask space create "$REPO_NAME"`.
- Store the `SPACE_ID`.

### Improve Board
- List boards via `monotask board list --json`. For each board ID, run `monotask column list <BOARD_ID> --json` to find one whose title is `monomind-improve`. (There is no "board view" command -- column list reveals the board structure.)
- If the `monomind-improve` board does not exist:
  1. Create it: `monotask board create "monomind-improve" --json` — store the returned `BOARD_ID`.
  2. Add it to the space: `monotask space boards add $SPACE_ID $BOARD_ID`.
  3. Create these columns in order:
     - `Discovered`
     - `Evaluated`
     - `Approved`
     - `Tasked`
     - `Deferred`
     - `Rejected`
- Store all column IDs mapped by name.

---

## Step 4: Generate Improvement Ideas

Spawn a single `Software Architect` agent via the Agent tool. Provide it with:
- The user's prompt: `$ARGUMENTS`
- The full `COMPONENT_ANALYSIS` from Step 2
- The `PROJECT_CONTEXT` from Step 1

The agent must synthesize the code analysis and online research into concrete improvement ideas. For each idea, produce:

```json
{
  "title": "Short, action-oriented title",
  "description": "2-3 sentences: what the improvement is, what problem it solves, and the expected benefit.",
  "category": "performance | security | reliability | maintainability | dx | testing | architecture",
  "evidence": "What from the analysis or research supports this (pain point ref, best practice ref, or prior art ref)",
  "estimated_impact": "Concrete expected outcome (e.g., '50% faster CLI startup', 'eliminate 3 code smells', 'cover 5 untested edge cases')"
}
```

**Idea generation rules:**
- Ideas must be grounded in the analysis — no generic "add more tests" without pointing to specific gaps
- Each idea must reference either a pain point from the code analysis or a best practice from the research
- Prefer high-impact, low-effort ideas first
- Include at least one idea from each applicable category (perf, security, testing, etc.)
- No duplicates — each idea must address a distinct improvement

For each idea, create a card in the `Discovered` column:
```bash
monotask card create $BOARD_ID $COL_DISCOVERED "<title>" --json
monotask card comment add $BOARD_ID $CARD_ID "<description>"
monotask card comment add $BOARD_ID $CARD_ID "Category: <category>\nEvidence: <evidence>\nExpected impact: <estimated_impact>"
monotask card tag add $BOARD_ID $CARD_ID "monomind-improve"
```

If zero ideas were generated, report "No improvement opportunities found for this component." and STOP.

---

## Step 5: Evaluate and Prioritize

Spawn a single `Product Manager` agent via the Agent tool. Provide it with:
- All improvement ideas (titles, descriptions, and all comments)
- The `COMPONENT_ANALYSIS`
- The `PROJECT_CONTEXT`

For EACH idea, the agent must return one of three verdicts, along with **impact** (0-10) and **effort** (0-10) scores:

| Verdict | Criteria |
|---------|----------|
| **approved** | High value, feasible, aligns with project direction. Include a `skipElaboration` boolean: `true` if straightforward, `false` if needs deeper investigation. |
| **deferred** | Good idea but wrong timing, blocked by something, or needs more research. Include the reason. |
| **rejected** | Low value, too risky, or out of scope. Include a 1-sentence reason. |

For each verdict, update the monotask board:

- **approved**: Move to `Evaluated`. Set impact and effort. Add value statement.
  ```bash
  monotask card move $BOARD_ID $CARD_ID $COL_EVALUATED --json
  monotask card set-impact $BOARD_ID $CARD_ID <0-10>
  monotask card set-effort $BOARD_ID $CARD_ID <0-10>
  monotask card comment add $BOARD_ID $CARD_ID "Value: <value statement>"
  ```
- **deferred**: Move to `Deferred`. Set impact and effort. Add reason.
  ```bash
  monotask card move $BOARD_ID $CARD_ID $COL_DEFERRED --json
  monotask card set-impact $BOARD_ID $CARD_ID <0-10>
  monotask card set-effort $BOARD_ID $CARD_ID <0-10>
  monotask card comment add $BOARD_ID $CARD_ID "Deferred: <reason>"
  ```
- **rejected**: Move to `Rejected`. Add reason.
  ```bash
  monotask card move $BOARD_ID $CARD_ID $COL_REJECTED --json
  monotask card comment add $BOARD_ID $CARD_ID "Rejected: <reason>"
  ```

If ALL ideas were deferred or rejected, output a summary table and STOP.

---

## Step 6: Elaborate Approved Improvements

Check if ANY approved ideas have `skipElaboration: false`.

**If ALL approved ideas have `skipElaboration: true`:**
- Move each directly from `Evaluated` to `Approved`:
  ```bash
  monotask card move $BOARD_ID $CARD_ID $COL_APPROVED --json
  ```
- Skip spawning agents.

**Otherwise**, spawn two agents in parallel via the Agent tool:

1. A `feature-dev:code-explorer` agent — traces implementation paths, identifies exactly which files/functions need to change, surfaces hidden constraints and breaking changes.
2. A `researcher` agent (with WebSearch) — searches for implementation patterns, migration guides, and gotchas specific to each improvement.

After both complete, for each idea needing elaboration:
1. Add findings as comments:
   ```bash
   monotask card comment add $BOARD_ID $CARD_ID "Implementation path: <files and functions to change>"
   monotask card comment add $BOARD_ID $CARD_ID "Risks: <breaking changes, migration needs>"
   monotask card comment add $BOARD_ID $CARD_ID "Research: <patterns and references found>"
   ```
2. If no blocking issues, move to `Approved`:
   ```bash
   monotask card move $BOARD_ID $CARD_ID $COL_APPROVED --json
   ```
3. If a blocking issue IS found, move to `Deferred`:
   ```bash
   monotask card move $BOARD_ID $CARD_ID $COL_DEFERRED --json
   monotask card comment add $BOARD_ID $CARD_ID "Blocked: <issue>"
   ```

Also move any `skipElaboration: true` ideas directly to `Approved`.

---

## Step 7: Task Decomposer — Break Improvements into Subtasks

### Task Board Setup
- Check if a `monomind-task` board exists in the space (same lookup method as Step 3).
- If not, create it with these columns:
  - `Backlog`
  - `Todo`
  - `In Progress`
  - `Review`
  - `Human in Loop`
  - `Done`
- Store column IDs.

### Decomposition into Professional Task Cards

Spawn a single `Software Architect` agent via the Agent tool. Provide it with:
- All ideas in the `Approved` column (titles, descriptions, and all comments including implementation paths and research)
- The `COMPONENT_ANALYSIS` from Step 2
- The `PROJECT_CONTEXT`

For each approved improvement, the agent must:

1. **Analyze and decompose** into 2-6 subtasks. Each subtask must be a professional task card:

```json
{
  "title": "Action-oriented title (verb + noun + context)",
  "description": "## What\nExact deliverable (new file, modified function, endpoint, etc.).\n\n## Why\nBusiness or technical motivation — what breaks without this?\n\n## Where\nFile paths, module boundaries, related components.\n\n## Patterns\nExisting conventions to follow (naming, error handling, test style).",
  "definition_of_done": [
    "Specific, binary, verifiable condition (include HTTP codes, error shapes, edge cases)",
    "Quantified thresholds where applicable (rate limits, timeouts, sizes)"
  ],
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
  "effort": "1-10 (1=trivial, 10=full day)",
  "dependencies": ["titles of prerequisite tasks, or empty"]
}
```

**Task generation rules:**
- Tasks MUST be ordered so dependencies come first
- Each task: 5-30 minutes for a single agent
- Split anything larger
- Every task starts with writing a test (TDD)
- DOD items must be binary (pass/fail, not "looks good")
- Testing criteria must name specific functions, endpoints, inputs

2. **Create each subtask** as a card in `Backlog` (has deps) or `Todo` (no deps):
   ```bash
   monotask card create $TASK_BOARD_ID $COLUMN_ID "<title>" --json
   monotask card tag add $TASK_BOARD_ID $CARD_ID "monomind-improve"
   ```

3. **Set description** with full context block:
   ```bash
   monotask card set-description $TASK_BOARD_ID $CARD_ID "<description with What/Why/Where/Patterns>"
   ```

4. **Add DOD comment**:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "## Definition of Done\n- [ ] <condition 1>\n- [ ] <condition 2>\n..."
   ```

5. **Add testing criteria comment**:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "## Testing Criteria\n\n### Unit Tests\n- <test 1>\n\n### Integration Tests\n- <test 1>\n\n### Edge Cases\n- <case 1>"
   ```

6. **Add agent assignment + metadata**:
   ```bash
   monotask card comment add $TASK_BOARD_ID $CARD_ID "Assigned agent: <agent_type>\nPriority: <priority>\nEffort: <effort>/10\nDependencies: <dep titles or none>\nSource: monomind-improve"
   ```

7. **Set priority**: `monotask card set-priority $TASK_BOARD_ID $CARD_ID <1-4>`

8. **Create checklist** (TDD implementation steps):
   ```bash
   monotask checklist add $TASK_BOARD_ID $CARD_ID "Implementation Steps" --json
   ```
   Then for each step:
   ```bash
   monotask checklist item-add $TASK_BOARD_ID $CARD_ID $CHECKLIST_ID "<step>"
   ```

9. **Comment on original improvement card** listing all subtask titles:
   ```bash
   monotask card comment add $BOARD_ID $IMPROVE_CARD_ID "Subtasks created:\n- <title> (agent: <type>, effort: <N>/10)\n- <title> (agent: <type>, effort: <N>/10)\n..."
   ```

10. **Move the improvement card** to `Tasked`:
    ```bash
    monotask card move $BOARD_ID $IMPROVE_CARD_ID $COL_TASKED --json
    ```

**If the architect has doubts** about decomposing an improvement (unclear scope, missing info):
- Add a comment with the question
- Move the improvement to `Deferred` instead of `Tasked`

---

## Step 8: Final Summary

Output a component health report:

```
## Improvement Analysis: <component>

### Component Health
- Files analyzed: N
- Pain points found: N (X critical, Y high, Z medium)
- Strengths identified: N

### Improvement Pipeline
| # | Improvement                 | Category       | Status   | Impact | Effort | Subtasks |
|---|-----------------------------|----------------|----------|--------|--------|----------|
| 1 | <title>                     | performance    | Tasked   | 8      | 4      | 3        |
| 2 | <title>                     | security       | Deferred | 7      | 8      | --       |
| 3 | <title>                     | testing        | Rejected | --     | --     | --       |

### Summary
- Improvements discovered: N
- Improvements tasked: N (with M total subtasks)
- Total effort points: X
- Improvements deferred: N
- Improvements rejected: N
```

Output board references:
- Monotask space: `$REPO_NAME` (ID: `$SPACE_ID`)
- Improve board: `monomind-improve` (ID: `$BOARD_ID`)
- Task board: `monomind-task` (ID: `$TASK_BOARD_ID`)

---

## Step 9: Offer to Execute Tasks

If there are any tasked improvements (subtasks in Backlog/Todo), ask the user:

> **M subtasks are ready.** Want me to start executing them now?
>
> Say **yes** to launch `/monomind:do` — it will pick up tasks one by one, execute them with the assigned agent, review for bugs, and loop until the queue is empty.

If the user says yes, invoke:
```
Skill("monomind-do", "--space $SPACE_ID --board $TASK_BOARD_ID")
```
