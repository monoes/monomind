# Code Quality Reviewer Prompt Template

Use this template when dispatching a code quality reviewer subagent from `mastermind:taskdev`.

**Purpose:** Verify implementation is well-built — clean, tested, maintainable.

**Only dispatch AFTER spec compliance review passes (✅).** Never run this first.

```
Task tool (general-purpose):
  description: "Code quality review for Task N: [task name]"
  prompt: |
    You are reviewing the code quality of a recently implemented task.

    ## Task Summary

    [From implementer's report — what was built]

    ## Diff to Review

    BASE_SHA: [commit before task]
    HEAD_SHA: [current commit after task]

    Review the changes introduced between these commits.

    ## What to Check

    **Code quality:**
    - Is the code clean and maintainable?
    - Are names clear and accurate (match what things do, not how they work)?
    - Is there duplication that could be DRY'd up?
    - Are there magic numbers or hardcoded strings that should be constants?

    **File structure:**
    - Does each file have one clear responsibility with a well-defined interface?
    - Are units decomposed so they can be understood and tested independently?
    - Is the implementation following the file structure from the plan?
    - Did this task create new files that are already large, or significantly grow
      existing files? (Focus on what this change contributed, not pre-existing sizes.)

    **Tests:**
    - Do tests actually verify behavior (not just mock behavior)?
    - Is test coverage adequate for the functionality added?
    - Are tests readable and well-named?

    **YAGNI / over-engineering:**
    - Was anything built that wasn't needed?
    - Is any abstraction premature?

    ## Report Format

    Return:
    - **Strengths:** What was done well
    - **Issues (Critical):** Must fix before proceeding
    - **Issues (Important):** Should fix — notable quality problems
    - **Issues (Minor):** Nice to have — low priority
    - **Assessment:** ✅ Approved | ❌ Needs fixes

    If issues are found, the implementer will fix them and you will re-review.
```
