# monomind:idea Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/monomind:idea <prompt>` slash command that researches ideas via a mesh swarm, evaluates and elaborates them, and decomposes approved ideas into subtasks — all tracked on monotask boards.

**Architecture:** A single Claude Code slash command (`.claude/commands/monomind-idea.md`) containing declarative instructions that orchestrate 4 pipeline stages via the Agent tool. Each stage uses monotask CLI for board/card management. No TypeScript code — pure markdown command with embedded Bash for monotask operations.

**Tech Stack:** Claude Code slash commands (markdown + YAML frontmatter), monotask CLI, Agent tool (researcher, Product Manager, Software Architect agents), monomind MCP tools (graphify, memory)

---

### Task 1: Create the slash command file with frontmatter and prerequisite check

**Files:**
- Create: `.claude/commands/monomind-idea.md`

- [ ] **Step 1: Create the command file with frontmatter and monotask check**

```markdown
---
name: monomind-idea
description: Research ideas from a prompt, evaluate them, and decompose into subtasks on monotask boards
---

**If `$ARGUMENTS` is empty**, output this and STOP:

```
Usage: /monomind:idea <prompt>

Example: /monomind:idea improve developer onboarding experience

Researches ideas from your prompt, evaluates them against the project,
and creates subtasks on monotask boards.
```

---

## Step 0: Check monotask CLI

Run this immediately:

```bash
if ! command -v monotask &>/dev/null; then
  echo "monotask CLI not found. Installing..."
  if command -v cargo &>/dev/null; then
    cargo install monotask
  else
    echo "ERROR: monotask requires cargo (Rust). Install Rust first:"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    echo "Then: cargo install monotask"
    exit 1
  fi
fi
echo "monotask CLI ready."
```

If the install fails, report the error and STOP. Do not proceed without monotask.
```

- [ ] **Step 2: Verify the file exists and frontmatter is valid**

Run: `head -5 .claude/commands/monomind-idea.md`
Expected: YAML frontmatter with `name: monomind-idea`

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/monomind-idea.md
git commit -m "feat: scaffold monomind:idea slash command with monotask prerequisite check"
```

---

### Task 2: Add project context gathering

**Files:**
- Modify: `.claude/commands/monomind-idea.md`

- [ ] **Step 1: Append context gathering section after Step 0**

Append this content after the monotask check section:

```markdown
## Step 1: Gather Project Context

Collect project context by running these in parallel:

1. **Repo name**: Run `git remote get-url origin 2>/dev/null` — extract the repo name (last path segment, strip `.git`). If git fails, use the basename of the current directory.

2. **README**: Read `README.md` (first 200 lines). If it doesn't exist, skip.

3. **Project manifest**: Read `package.json` (or `Cargo.toml`, `pyproject.toml`, `go.mod` — whichever exists). Extract name, description, and keywords.

4. **Graphify context**: Call `mcp__monomind__graphify_suggest` with `$ARGUMENTS` as the query. If it errors or returns empty, skip — the graph may not be built.

5. **Memory context**: Call `mcp__monomind__memory_search` with `$ARGUMENTS` as the query. Use top 5 results.

Bundle all collected context into a single string called `PROJECT_CONTEXT`. This will be passed to every agent in subsequent stages. Format it as:

```
PROJECT: <repo-name>
DESCRIPTION: <from manifest>
README EXCERPT: <first 200 lines>
RELEVANT FILES: <from graphify>
PROJECT MEMORIES: <from memory search>
```

Store the repo name as `REPO_NAME` — it's used for space/board setup.
```

- [ ] **Step 2: Verify the section was added**

Run: `grep -c "Gather Project Context" .claude/commands/monomind-idea.md`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/monomind-idea.md
git commit -m "feat: add project context gathering to monomind:idea"
```

---

### Task 3: Add monotask space and idea board setup

**Files:**
- Modify: `.claude/commands/monomind-idea.md`

- [ ] **Step 1: Append space and board setup section**

Append after the context gathering section:

```markdown
## Step 2: Setup Monotask Space and Idea Board

Output: `"Setting up monotask space and idea board..."`

### Space Setup

Run:
```bash
SPACE_LIST=$(monotask space list 2>&1)
```

Check if a space with the name `$REPO_NAME` exists in the output. If it does, extract its ID. If not:

```bash
monotask space create "$REPO_NAME"
```

Extract the space ID from the output. Store as `SPACE_ID`.

Output: `"  Space: $REPO_NAME (existing)"` or `"  Space: $REPO_NAME (created)"`

### Idea Board Setup

List boards in the space:
```bash
monotask space boards list $SPACE_ID
```

For each board ID returned, check its title. You need to inspect each board to find one titled `monomind-idea`. If none match, create it:

```bash
IDEA_BOARD=$(monotask board create "monomind-idea" --json | jq -r .id)

# Create columns in order
NEW_COL=$(monotask column create $IDEA_BOARD "New" --json | jq -r .id)
EVALUATED_COL=$(monotask column create $IDEA_BOARD "Evaluated" --json | jq -r .id)
ELABORATED_COL=$(monotask column create $IDEA_BOARD "Elaborated" --json | jq -r .id)
TASKED_COL=$(monotask column create $IDEA_BOARD "Tasked" --json | jq -r .id)
ICED_COL=$(monotask column create $IDEA_BOARD "Iced" --json | jq -r .id)
REJECTED_COL=$(monotask column create $IDEA_BOARD "Rejected" --json | jq -r .id)

# Associate board with space
monotask space boards add $SPACE_ID $IDEA_BOARD
```

If the board already exists, list its columns with `monotask column list $IDEA_BOARD --json` and store the column IDs by matching titles: `NEW_COL`, `EVALUATED_COL`, `ELABORATED_COL`, `TASKED_COL`, `ICED_COL`, `REJECTED_COL`.

Output: `"  Board: monomind-idea (created)"` or `"  Board: monomind-idea (existing)"`
```

- [ ] **Step 2: Verify the section was added**

Run: `grep -c "Setup Monotask Space" .claude/commands/monomind-idea.md`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/monomind-idea.md
git commit -m "feat: add monotask space and idea board setup to monomind:idea"
```

---

### Task 4: Add Stage 1 — Research Swarm

**Files:**
- Modify: `.claude/commands/monomind-idea.md`

- [ ] **Step 1: Append the research swarm stage**

Append after the board setup section:

```markdown
## Step 3: Research Swarm — Generate Ideas

Output: `"Researching ideas with mesh swarm (3-5 agents)..."`

Spawn 3–5 `researcher` agents in parallel using the Agent tool. Each agent gets the same prompt but is instructed to explore different angles. Send all Agent calls in ONE message.

**Prompt for each researcher agent:**

```
You are researching ideas for a software project. Your goal is to generate creative, actionable ideas based on the user's prompt.

PROJECT CONTEXT:
$PROJECT_CONTEXT

USER'S PROMPT: $ARGUMENTS

Generate 2-4 unique ideas. For each idea, provide:
- title: A short, clear title (under 80 chars)
- description: 2-3 sentences explaining the idea, why it's valuable, and roughly how it would work

Output ONLY a JSON array:
[{"title": "...", "description": "..."}, ...]

Focus on ideas that are:
- Relevant to this specific project (not generic advice)
- Actionable (could be implemented)
- Varied (don't repeat similar ideas)
```

After all agents return, merge their results into a single deduplicated list. Remove ideas with very similar titles (keep the one with the richer description).

### Create Cards in New Column

For each idea in the merged list:

```bash
CARD_ID=$(monotask card create $IDEA_BOARD $NEW_COL "$IDEA_TITLE" --json | jq -r .id)
monotask card comment add $IDEA_BOARD $CARD_ID "$IDEA_DESCRIPTION"
```

Store the list of `{title, description, cardId}` for the next stage.

Output: `"  Generated X ideas → New column"`

If no ideas were generated, output `"No ideas generated for this prompt."` and STOP.
```

- [ ] **Step 2: Verify the section was added**

Run: `grep -c "Research Swarm" .claude/commands/monomind-idea.md`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/monomind-idea.md
git commit -m "feat: add research swarm stage to monomind:idea"
```

---

### Task 5: Add Stage 2 — Evaluator Agent

**Files:**
- Modify: `.claude/commands/monomind-idea.md`

- [ ] **Step 1: Append the evaluator stage**

Append after the research swarm section:

```markdown
## Step 4: Evaluator — Assess Each Idea

Output: `"Evaluating ideas..."`

Spawn a single `Product Manager` agent using the Agent tool.

**Prompt for the evaluator agent:**

```
You are evaluating ideas for a software project. For each idea, decide whether it's worth pursuing.

PROJECT CONTEXT:
$PROJECT_CONTEXT

IDEAS TO EVALUATE:
$IDEAS_JSON

For EACH idea, provide a verdict:

1. **"evaluated"** — The idea is doable and adds value to this project.
   - Write a "valueStatement" (1-2 sentences on how it adds value)
   - Set "skipElaboration": true if the idea is clear and needs no further research
   - Set "skipElaboration": false if the idea needs edge cases, technical research, or more context

2. **"iced"** — The idea is unclear, needs user feedback, or has unresolved questions.
   - Write a "question" with the specific thing that needs clarification

3. **"rejected"** — The idea is not useful for this project right now.
   - Write a "reason" explaining why

Output ONLY a JSON array:
[
  {"title": "...", "cardId": "...", "verdict": "evaluated", "valueStatement": "...", "skipElaboration": true},
  {"title": "...", "cardId": "...", "verdict": "iced", "question": "..."},
  {"title": "...", "cardId": "...", "verdict": "rejected", "reason": "..."},
  ...
]

Be pragmatic. Don't reject ideas just because they're ambitious — reject only if they genuinely don't fit this project's direction.
```

### Process Verdicts

For each evaluated idea:

**If verdict = "evaluated":**
```bash
monotask card comment add $IDEA_BOARD $CARD_ID "VALUE: $VALUE_STATEMENT"
monotask card move $IDEA_BOARD $CARD_ID $EVALUATED_COL
```
Output: `"  $TITLE → Evaluated (clear)"` or `"  $TITLE → Evaluated (needs elaboration)"`

**If verdict = "iced":**
```bash
monotask card comment add $IDEA_BOARD $CARD_ID "QUESTION: $QUESTION"
monotask card move $IDEA_BOARD $CARD_ID $ICED_COL
```
Output: `"  $TITLE → Iced (question: $QUESTION)"`

**If verdict = "rejected":**
```bash
monotask card comment add $IDEA_BOARD $CARD_ID "REJECTED: $REASON"
monotask card move $IDEA_BOARD $CARD_ID $REJECTED_COL
```
Output: `"  $TITLE → Rejected ($REASON)"`

Store the evaluated ideas (verdict = "evaluated") with their `skipElaboration` flag for the next stage.

If ALL ideas were rejected or iced, output the final summary table and STOP — do not proceed to elaboration or task decomposition.
```

- [ ] **Step 2: Verify the section was added**

Run: `grep -c "Evaluator" .claude/commands/monomind-idea.md`
Expected: at least `1`

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/monomind-idea.md
git commit -m "feat: add evaluator stage to monomind:idea"
```

---

### Task 6: Add Stage 3 — Elaborator Agent (conditional)

**Files:**
- Modify: `.claude/commands/monomind-idea.md`

- [ ] **Step 1: Append the elaborator stage**

Append after the evaluator section:

```markdown
## Step 5: Elaborator — Add Edge Cases and Context (conditional)

Check if any evaluated ideas have `skipElaboration: false`. If none do, output `"All ideas are clear, skipping elaboration."` and move all evaluated ideas directly to the Elaborated column:

```bash
# For each idea with skipElaboration: true
monotask card move $IDEA_BOARD $CARD_ID $ELABORATED_COL
```

If there ARE ideas needing elaboration, output: `"Elaborating X ideas..."`

Spawn a single `researcher` agent using the Agent tool.

**Prompt for the elaborator agent:**

```
You are elaborating on software feature ideas that need more context before they can be turned into tasks.

PROJECT CONTEXT:
$PROJECT_CONTEXT

IDEAS NEEDING ELABORATION:
$IDEAS_NEEDING_ELABORATION_JSON

For each idea, research and add:
1. Edge cases that the implementation should handle
2. Technical considerations (dependencies, APIs, patterns to use)
3. Any context from the internet or the project codebase that would help an implementer

Use WebSearch to find relevant technical references, best practices, or similar implementations.

If during elaboration you discover the idea is actually unclear or has a fundamental problem, mark it as "iced" with a specific question.

Output ONLY a JSON array:
[
  {"cardId": "...", "verdict": "elaborated", "edgeCases": ["...", "..."], "technicalNotes": "..."},
  {"cardId": "...", "verdict": "iced", "question": "..."},
  ...
]
```

### Process Results

**If verdict = "elaborated":**
```bash
monotask card comment add $IDEA_BOARD $CARD_ID "EDGE CASES:
- $EDGE_CASE_1
- $EDGE_CASE_2

TECHNICAL NOTES: $TECHNICAL_NOTES"
monotask card move $IDEA_BOARD $CARD_ID $ELABORATED_COL
```
Output: `"  $TITLE → Elaborated"`

**If verdict = "iced":**
```bash
monotask card comment add $IDEA_BOARD $CARD_ID "QUESTION (from elaboration): $QUESTION"
monotask card move $IDEA_BOARD $CARD_ID $ICED_COL
```
Output: `"  $TITLE → Iced (question: $QUESTION)"`

Also move any `skipElaboration: true` ideas directly to Elaborated:
```bash
monotask card move $IDEA_BOARD $CARD_ID $ELABORATED_COL
```

If no ideas remain in Elaborated after this stage, output the summary table and STOP.
```

- [ ] **Step 2: Verify the section was added**

Run: `grep -c "Elaborator" .claude/commands/monomind-idea.md`
Expected: at least `1`

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/monomind-idea.md
git commit -m "feat: add elaborator stage to monomind:idea"
```

---

### Task 7: Add Stage 4 — Task Decomposer Agent

**Files:**
- Modify: `.claude/commands/monomind-idea.md`

- [ ] **Step 1: Append the task decomposer stage**

Append after the elaborator section:

```markdown
## Step 6: Task Decomposer — Break Ideas into Subtasks

Output: `"Decomposing X ideas into tasks..."`

### Task Board Setup

First, check if the `monomind-task` board exists in the space (same logic as idea board). If not, create it:

```bash
TASK_BOARD=$(monotask board create "monomind-task" --json | jq -r .id)

BACKLOG_COL=$(monotask column create $TASK_BOARD "Backlog" --json | jq -r .id)
monotask column create $TASK_BOARD "Todo" --json
monotask column create $TASK_BOARD "In Progress" --json
monotask column create $TASK_BOARD "Review" --json
monotask column create $TASK_BOARD "Human in Loop" --json
monotask column create $TASK_BOARD "Done" --json

monotask space boards add $SPACE_ID $TASK_BOARD
```

If the board exists, find the `Backlog` column ID from `monotask column list $TASK_BOARD --json`.

Output: `"  Creating monomind-task board..."` (only if newly created)

### Decompose Ideas

Spawn a single `Software Architect` agent using the Agent tool.

**Prompt for the decomposer agent:**

```
You are decomposing approved feature ideas into concrete, actionable subtasks for a development team.

PROJECT CONTEXT:
$PROJECT_CONTEXT

IDEAS TO DECOMPOSE:
$ELABORATED_IDEAS_JSON

For each idea, create 2-6 subtasks. Each subtask should be:
- Small enough to complete in one work session (1-4 hours)
- Self-contained with a clear definition of done
- Ordered logically (dependencies first)

If you encounter any ambiguity or doubt about how to decompose an idea, mark it as "iced" with a specific question instead of guessing.

Output ONLY a JSON array:
[
  {
    "ideaCardId": "...",
    "ideaTitle": "...",
    "verdict": "tasked",
    "subtasks": [
      {"title": "...", "description": "..."},
      {"title": "...", "description": "..."}
    ]
  },
  {
    "ideaCardId": "...",
    "ideaTitle": "...",
    "verdict": "iced",
    "question": "..."
  },
  ...
]
```

### Process Results

**If verdict = "tasked":**
For each subtask:
```bash
SUBTASK_ID=$(monotask card create $TASK_BOARD $BACKLOG_COL "$SUBTASK_TITLE" --json | jq -r .id)
monotask card comment add $TASK_BOARD $SUBTASK_ID "$SUBTASK_DESCRIPTION"
```

Then comment on the idea card and move it:
```bash
monotask card comment add $IDEA_BOARD $IDEA_CARD_ID "SUBTASKS CREATED:
- $SUBTASK_1_TITLE
- $SUBTASK_2_TITLE
..."
monotask card move $IDEA_BOARD $IDEA_CARD_ID $TASKED_COL
```
Output: track count of subtasks per idea for the summary table.

**If verdict = "iced":**
```bash
monotask card comment add $IDEA_BOARD $IDEA_CARD_ID "QUESTION (from decomposition): $QUESTION"
monotask card move $IDEA_BOARD $IDEA_CARD_ID $ICED_COL
```
```

- [ ] **Step 2: Verify the section was added**

Run: `grep -c "Task Decomposer" .claude/commands/monomind-idea.md`
Expected: at least `1`

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/monomind-idea.md
git commit -m "feat: add task decomposer stage to monomind:idea"
```

---

### Task 8: Add Final Summary Output

**Files:**
- Modify: `.claude/commands/monomind-idea.md`

- [ ] **Step 1: Append the summary section**

Append at the very end of the command file:

```markdown
## Step 7: Final Summary

After all stages complete, output a summary table:

```
┌─────────────────────────────────┬────────────┐
│ Idea                            │ Status     │
├─────────────────────────────────┼────────────┤
│ <idea title>                    │ Tasked (N) │
│ <idea title>                    │ Iced       │
│ <idea title>                    │ Rejected   │
└─────────────────────────────────┴────────────┘

X subtasks created in monomind-task backlog.
```

Where:
- `Tasked (N)` means N subtasks were created in the monomind-task backlog
- `Iced` means the idea was moved to Iced at any stage (with a question commented)
- `Rejected` means the evaluator rejected the idea

Sort the table: Tasked ideas first, then Iced, then Rejected.
```

- [ ] **Step 2: Verify the complete command file has all 8 steps (0-7)**

Run: `grep -c "^## Step" .claude/commands/monomind-idea.md`
Expected: `8`

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/monomind-idea.md
git commit -m "feat: add final summary output to monomind:idea"
```

---

### Task 9: End-to-End Smoke Test

**Files:**
- Test: `.claude/commands/monomind-idea.md` (read-only verification)

- [ ] **Step 1: Verify the command file structure**

Run: `wc -l .claude/commands/monomind-idea.md`
Expected: file exists and is non-trivial (100+ lines)

- [ ] **Step 2: Verify frontmatter**

Run: `head -4 .claude/commands/monomind-idea.md`
Expected:
```
---
name: monomind-idea
description: Research ideas from a prompt, evaluate them, and decompose into subtasks on monotask boards
---
```

- [ ] **Step 3: Verify all pipeline stages are present**

Run: `grep "^## Step" .claude/commands/monomind-idea.md`
Expected output (8 lines):
```
## Step 0: Check monotask CLI
## Step 1: Gather Project Context
## Step 2: Setup Monotask Space and Idea Board
## Step 3: Research Swarm — Generate Ideas
## Step 4: Evaluator — Assess Each Idea
## Step 5: Elaborator — Add Edge Cases and Context (conditional)
## Step 6: Task Decomposer — Break Ideas into Subtasks
## Step 7: Final Summary
```

- [ ] **Step 4: Verify monotask commands are correct**

Run: `grep "monotask " .claude/commands/monomind-idea.md | head -20`
Expected: commands match monotask CLI syntax (space create, board create, column create, card create, card comment add, card move)

- [ ] **Step 5: Verify agent types are specified**

Run: `grep -i "agent" .claude/commands/monomind-idea.md | grep -i "type\|spawn\|product manager\|researcher\|software architect" | head -10`
Expected: references to researcher (swarm), Product Manager (evaluator), researcher (elaborator), Software Architect (decomposer)

- [ ] **Step 6: Test the command invocation**

Run `/monomind:idea` with no arguments — should show usage message.
Then run `/monomind:idea improve CLI error messages` — should execute the full pipeline.

- [ ] **Step 7: Final commit (if any fixes were needed)**

```bash
git add .claude/commands/monomind-idea.md
git commit -m "fix: polish monomind:idea command after smoke test"
```
