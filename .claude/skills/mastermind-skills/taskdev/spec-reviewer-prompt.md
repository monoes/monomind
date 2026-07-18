# Spec Compliance Reviewer Prompt Template

Use this template when dispatching a spec compliance reviewer subagent from `mastermind:taskdev`.

**Purpose:** Verify implementer built what was requested — nothing more, nothing less.

**Dispatch BEFORE code quality review.** Spec compliance always runs first.

```
Task tool (general-purpose):
  description: "Review spec compliance for Task N"
  prompt: |
    You are reviewing whether an implementation matches its specification.

    ## What Was Requested

    Read this file first — it is the task's requirements, with the exact
    values that bind the implementation:

    [TASK_BRIEF_PATH — e.g. .monomind/taskdev/task-N-brief.md]

    ## Global Constraints

    [Copied verbatim from the plan's Global Constraints section — exact
    values, formats, and cross-component relationships that bind this task]

    ## What Implementer Claims They Built

    Read the implementer's report file:

    [REPORT_FILE_PATH — e.g. .monomind/taskdev/task-N-report.md]

    ## Diff to Review

    Read this file — it contains the commit list, stat summary, and full
    diff for the task:

    [DIFF_FILE_PATH — e.g. .monomind/taskdev/task-N-review.diff]

    ## CRITICAL: Do Not Trust the Report

    The implementer may have finished quickly or missed things. Their report may be
    incomplete, inaccurate, or optimistic. You MUST verify everything independently.

    **DO NOT:**
    - Take their word for what they implemented
    - Trust their claims about completeness
    - Accept their interpretation of requirements

    **DO:**
    - Read the actual code they wrote
    - Compare actual implementation to requirements line by line
    - Check for missing pieces they claimed to implement
    - Look for extra features they didn't mention

    ## Your Job

    Read the implementation code and verify:

    **Missing requirements:**
    - Did they implement everything that was requested?
    - Are there requirements they skipped or missed?
    - Did they claim something works but didn't actually implement it?

    **Extra/unneeded work:**
    - Did they build things that weren't requested?
    - Did they over-engineer or add unnecessary features?
    - Did they add "nice to haves" that weren't in spec?

    **Misunderstandings:**
    - Did they interpret requirements differently than intended?
    - Did they solve the wrong problem?
    - Did they implement the right feature the wrong way?

    **Verify by reading code, not by trusting the report.**

    Report:
    - ✅ Spec compliant (if everything matches after code inspection)
    - ❌ Issues found: [list specifically what's missing or extra, with file:line references]
```
