---
name: mastermind-plan
description: Write comprehensive implementation plans from specs or requirements before touching code. Saves plans to docs/mastermind/plans/. No placeholders — every step has exact file paths, complete code, and expected output.
type: domain-skill
default_mode: confirm
---

# Mastermind Plan

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the mastermind:plan skill to create the implementation plan."

**Context:** If working in an isolated worktree, it should have been created via the git worktrees workflow at execution time.

**Save plans to:** `docs/mastermind/plans/YYYY-MM-DD-<feature-name>.md`
- (User preferences for plan location override this default)

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (loaded via _protocol.md brain load)
- `params`: spec text, feature description, or path to spec file
- `mode`: auto | confirm

---

## Scope Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

---

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure — but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

---

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" — step
- "Run it to make sure it fails" — step
- "Implement the minimal code to make the test pass" — step
- "Run the tests and make sure they pass" — step
- "Commit" — step

---

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `Skill("mastermind:taskdev")` (recommended) or `Skill("mastermind:execute")` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

---

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

---

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

---

## Remember
- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

---

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

---

## User Review Gate

After self-review:

**In confirm mode (default):** Ask the user to review the written plan before proceeding:

> "Plan written and saved to `docs/mastermind/plans/<filename>.md`. Please review it and let me know if you'd like any changes before we start execution."

Wait for the user's response. If they request changes, make them inline and re-run the self-review. Only proceed once the user approves.

**In auto mode:** Skip the wait. Proceed directly to execution handoff.

---

## Execution Handoff

After the plan is approved (or in auto mode, after self-review):

**In confirm mode (default):** Ask the user to choose execution mode:

**"Plan complete and saved to `docs/mastermind/plans/<filename>.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Invoke `Skill("mastermind:taskdev")`: dispatches a fresh subagent per task, reviews between tasks, fast iteration.

**2. Inline Execution** — Invoke `Skill("mastermind:execute")`: batch execution with checkpoints.

**Which approach?"**

**In auto mode:** Skip the question. Default to subagent-driven — invoke `Skill("mastermind:taskdev")` immediately.

**If Subagent-Driven chosen (or auto mode):**
- Invoke `Skill("mastermind:taskdev")`
- Fresh subagent per task + two-stage review

**If Inline Execution chosen:**
- Invoke `Skill("mastermind:execute")`
- Batch execution with checkpoints for review
