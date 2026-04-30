---
name: monomind-createtask
description: Ingest a prompt, file, or folder — deeply analyze it, generate a professional implementation plan, and create self-contained task cards on monotask with DOD, testing criteria, and checklists
version: 1.0.0
triggers:
  - /monomind:createtask
  - create tasks from spec
  - decompose into tasks
  - turn this into tasks
  - break this down into tasks
  - create implementation tasks
---

# /monomind:createtask — Spec-to-Tasks Pipeline

Transforms a prompt, file, or folder into professional, self-contained task cards on a monotask board. Each card carries enough context that a coder agent with zero prior knowledge can execute it.

## Task Card Quality Standard

Every task card produced by this skill MUST meet this bar — no exceptions:

### 1. Self-Contained Context
The card description alone must answer: What am I building? Why? Where does it fit? What patterns exist?

Include:
- **What**: Exact deliverable (new file, modified function, new endpoint, etc.)
- **Why**: Business or technical motivation — what breaks without this?
- **Where**: File paths, module boundaries, related components
- **Patterns**: Existing conventions to follow (naming, error handling, test style)
- **Data shapes**: Relevant types, interfaces, API contracts, DB schemas

### 2. Definition of Done (DOD)
Concrete, binary conditions — not vague "it works" statements.

Bad DOD:
- "Authentication works"
- "Tests pass"
- "Error handling is complete"

Good DOD:
- "POST /auth/login returns 200 with JWT when credentials valid, 401 when invalid, 429 after 5 failed attempts within 15 minutes"
- "Unit tests cover: valid login, invalid password, expired account, rate limit hit, missing fields — all green"
- "Invalid email format returns 422 with `{ error: 'INVALID_EMAIL', field: 'email' }` shape"

Rules:
- Every DOD item must be verifiable by running code or reading output
- Include specific HTTP codes, error shapes, edge cases
- Quantify where possible (rate limits, timeouts, thresholds)

### 3. Testing Criteria
Explicit test cases — not "write tests."

Each task must specify:
- **Unit tests**: What functions, what inputs, what assertions
- **Integration tests**: What endpoints, what sequences, what state transitions
- **Edge cases**: What breaks, what's empty, what's too large, what's concurrent

Format:
```
## Testing Criteria

### Unit Tests
- `createUser({valid})` → returns user with generated ID and hashed password
- `createUser({duplicate_email})` → throws ConflictError with code DUPLICATE_EMAIL
- `createUser({missing_name})` → throws ValidationError listing missing fields

### Integration Tests
- POST /users with valid body → 201, response matches UserSchema
- POST /users with duplicate email → 409, idempotent (no side effects)
- GET /users/:id after create → returns same user

### Edge Cases
- Empty string fields → validation rejects before DB call
- 10,000 char name → truncated or rejected at boundary
- Concurrent duplicate creates → exactly one succeeds
```

### 4. Implementation Checklist
Ordered steps that a coder follows mechanically. Each step is one action (5 minutes max).

Rules:
- Start with the test (TDD: red → green → refactor)
- Include the exact file to create or modify
- Include the function signature or interface shape
- End with "run tests, verify green, commit"

### 5. Dependencies and Ordering
- Explicit: "Blocked by: [Card Title]" or "No dependencies"
- Tasks ordered so foundations come first
- Parallel-safe tasks identified

---

## Pipeline Steps

### Step 0: Verify monotask CLI
```bash
command -v monotask || (command -v cargo && cargo install monotask)
```
If neither exists, tell user to install Rust + monotask and STOP.

### Step 1: Classify and Ingest Input

Parse `$ARGUMENTS`:
- `test -f` → file: read with Read tool
- `test -d` → folder: `find` up to 30 files, read each, concatenate with `--- FILE: <path> ---` separators
- Otherwise → prompt: store text directly

### Step 2: Enrich with Project Context

Run ALL in parallel (skip errors):
1. `mcp__monomind__graphify_suggest` with first 200 chars of input
2. `mcp__monomind__graphify_query` for module/component names found in input (up to 5)
3. `mcp__monomind__memory_search` with input summary
4. Read `README.md` (first 200 lines)
5. Read first found: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`
6. Repo name from `git remote get-url origin` (strip path, strip `.git`)

Bundle everything into `FULL_CONTEXT`.

### Step 3: Setup Monotask Space and Board

**Space**: Find or create space named `$REPO_NAME`.

**Board**: Find `monomind-task` board (identify by checking columns for `Todo`). If missing, create with columns:
- `Backlog` → `Todo` → `In Progress` → `Review` → `Human in Loop` → `Done`

### Step 4: Deep Analysis

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
      "files_likely_affected": ["paths from graphify or educated guesses"]
    }
  ],
  "technical_constraints": ["stack requirements, limitations"],
  "acceptance_criteria": ["testable conditions for when the whole thing is done"],
  "risks": ["pitfalls, ambiguities, unknowns"]
}
```

### Step 5: Generate Professional Tasks

Spawn a `planner` agent. Provide analysis + `FULL_CONTEXT`.

For each task, produce:

```json
{
  "title": "Action-oriented title (verb + noun + context)",
  "description": "## What\nExact deliverable.\n\n## Why\nMotivation.\n\n## Where\nFile paths, module boundaries.\n\n## Patterns\nExisting conventions to follow.",
  "definition_of_done": [
    "Specific, binary, verifiable condition 1",
    "Specific, binary, verifiable condition 2"
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
  "agent_type": "coder | backend-dev | Frontend Developer | Security Engineer | etc.",
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
- Agent type chosen from the 230+ available roster based on domain fit
- DOD items must be binary (pass/fail, not "looks good")
- Testing criteria must name specific functions, endpoints, inputs

### Step 6: Create Cards on Monotask

For each task, in dependency order:

1. **Create card** in `Todo` (no deps) or `Backlog` (has deps):
   ```bash
   monotask card create $BOARD_ID $COLUMN_ID "<title>" --json
   ```

2. **Set description** with full context block:
   ```bash
   monotask card set-description $BOARD_ID $CARD_ID "<description>"
   ```

3. **Add DOD comment**:
   ```bash
   monotask card comment add $BOARD_ID $CARD_ID "## Definition of Done\n- [ ] <condition 1>\n- [ ] <condition 2>\n..."
   ```

4. **Add testing criteria comment**:
   ```bash
   monotask card comment add $BOARD_ID $CARD_ID "## Testing Criteria\n\n### Unit Tests\n- <test 1>\n\n### Integration Tests\n- <test 1>\n\n### Edge Cases\n- <case 1>"
   ```

5. **Add agent assignment**:
   ```bash
   monotask card comment add $BOARD_ID $CARD_ID "Assigned agent: <agent_type>"
   ```

6. **Add dependencies** (if any):
   ```bash
   monotask card comment add $BOARD_ID $CARD_ID "Dependencies: <task title 1>, <task title 2>"
   ```

7. **Set priority**: `monotask card set-priority $BOARD_ID $CARD_ID <1-4>`

8. **Create checklist**:
   ```bash
   monotask checklist add $BOARD_ID $CARD_ID "Implementation Steps" --json
   ```
   Then for each step:
   ```bash
   monotask checklist item-add $BOARD_ID $CARD_ID $CHECKLIST_ID "<step>"
   ```

### Step 7: Gap Analysis

Spawn a fresh `Software Architect` agent as critical reviewer. Provide analysis + all created tasks.

Must identify:
- **Missing pieces**: testing gaps, error handling holes, security oversights, missing migrations, documentation needs
- **Follow-ups**: natural extensions, performance optimizations, monitoring additions

Present as tables. Ask user which to add (numbers, `all`, or `none`).

Selected missing pieces → `Todo` column. Selected follow-ups → `Backlog` column.

### Step 8: Summary

```
## Task Creation Complete

**Source:** <input>
**Space:** $REPO_NAME | **Board:** monomind-task

| # | Title | Agent | Priority | Effort | Column | Deps |
|---|-------|-------|----------|--------|--------|------|
| 1 | ...   | ...   | high     | 3      | Todo   | —    |

**Total:** N tasks (X in Todo, Y in Backlog)
**Estimated effort:** Z points
```

### Step 9: Offer Execution

> **N tasks ready.** Start `/monomind:do` to execute them autonomously?

If yes: `Skill("monomind-do", "--space $SPACE_ID --board $BOARD_ID")`
