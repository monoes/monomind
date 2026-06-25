---
name: mastermind-debug
description: Systematic root-cause debugging protocol. Use before ANY fix attempt — for test failures, bugs, unexpected behavior, build failures, performance regressions.
---

# mastermind:debug — Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue:
- Test failures
- Bugs in production or staging
- Unexpected behavior
- Performance regressions
- Build failures
- Integration issues

**Use this ESPECIALLY when:**
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes that didn't work
- Previous fix didn't resolve the issue
- You don't fully understand what's happening

**Don't skip when:**
- Issue seems simple (simple bugs have root causes too)
- You're in a hurry (systematic is faster than thrashing)
- The user wants it fixed immediately (systematic approach finds the real fix faster)

## The Four Phases

You MUST complete each phase before proceeding to the next.

---

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read Error Messages Carefully**
   - Don't skim errors or warnings
   - They often contain the exact solution
   - Read stack traces completely
   - Note line numbers, file paths, error codes

2. **Reproduce Consistently**
   - Can you trigger the issue reliably?
   - What are the exact steps?
   - Does it happen every time?
   - If not reproducible → gather more data, don't guess

3. **Check Recent Changes**
   - What changed that could cause this?
   - `git diff`, recent commits, new dependencies, config changes
   - Environmental differences between working and broken states

4. **Gather Evidence in Multi-Component Systems**

   **WHEN the system has multiple components (CI → build → deploy, API → service → database):**

   **BEFORE proposing fixes, add diagnostic instrumentation:**
   ```
   For EACH component boundary:
     - Log what data enters the component
     - Log what data exits the component
     - Verify config/env propagation at each layer
     - Check state at each boundary

   Run once to gather evidence showing WHERE it breaks
   THEN analyze evidence to identify the failing component
   THEN investigate that specific component
   ```

   **Example:**
   ```bash
   # Layer 1: entry point
   echo "=== Input received: ==="
   echo "VAR: ${VAR:+SET}${VAR:-UNSET}"

   # Layer 2: processing
   echo "=== State after processing: ==="
   env | grep VAR || echo "VAR not in environment"

   # Layer 3: output/result
   echo "=== Final state: ==="
   ```

---

### Phase 2: Pattern Analysis

Once you understand WHERE the break is, find existing working examples:

1. **Find working code that solves the same problem**
   - Search the codebase for similar patterns
   - Check git history for when this worked
   - Find the canonical implementation to compare against

2. **Compare broken vs. working**
   - What's different?
   - List every difference, not just the obvious one
   - Environment, config, data, timing

---

### Phase 3: Form and Test a Hypothesis

1. **State your hypothesis explicitly:**
   > "I believe the root cause is [X] because [evidence Y] and [evidence Z]."

2. **Test the hypothesis minimally**
   - Change one thing and observe the result
   - If it doesn't confirm or deny, gather more evidence
   - A confirmed hypothesis means you understand the root cause

3. **If hypothesis is wrong:** Do NOT add more fixes. Return to Phase 1 with the new information.

---

### Phase 4: Implementation

1. **Write a failing test first** (before touching production code)
   - Automated test where possible
   - Use `Skill("mastermind:build")` with a test-only prompt if needed
   - The test MUST fail before the fix proves it

2. **Implement a single fix**
   - Address the root cause identified in Phase 3
   - ONE change at a time
   - No "while I'm here" improvements
   - No bundled refactoring

3. **Verify the fix**
   - Test passes now?
   - No other tests broken?
   - Issue actually resolved?
   - Use `Skill("mastermind:review")` to verify before declaring done

4. **If the fix doesn't work:**
   - STOP
   - Count: How many fixes have you tried?
   - If < 3: Return to Phase 1, re-analyze with the new information
   - **If ≥ 3: STOP — this is likely an architectural problem (see Phase 4.5 below)**
   - Do NOT attempt a 4th fix without architectural discussion

---

### Phase 4.5 — If 3+ Fixes Have Failed: Question the Architecture

**Pattern indicating an architectural problem:**
- Each fix reveals new coupling or shared state issues in a different place
- Each fix creates new symptoms elsewhere
- Fixes require "massive refactoring" to implement cleanly

**STOP and question fundamentals:**
- Is this design pattern fundamentally sound?
- Are we continuing out of inertia?
- Should we refactor the architecture rather than continue patching?

**Discuss with the user before attempting more fixes.** This is not a failed hypothesis — this is the wrong architecture.

---

## Red Flags — STOP and Return to Phase 1

If you catch yourself thinking or doing any of these:

| Thought / Action | What it means |
|---|---|
| "Quick fix for now, investigate later" | You're skipping root cause. Return to Phase 1. |
| "Just try changing X and see if it works" | Guessing. Return to Phase 1. |
| "Add multiple changes, run tests" | Can't isolate what worked. Return to Phase 1. |
| "It's probably X, let me fix that" | Assumed root cause. Verify it first. Return to Phase 1. |
| "I don't fully understand but this might work" | You don't have a hypothesis. Return to Phase 1. |
| Proposing solutions before tracing data flow | No root cause. Return to Phase 1. |
| "One more fix attempt" (already tried 2+) | 3+ failures = architectural problem. Phase 4.5. |
| Each fix reveals a new problem in a different place | Architectural problem. Phase 4.5. |

## User Signals You're Doing It Wrong

Watch for these redirections from the user:

| Signal | What it means |
|---|---|
| "Is that actually happening?" | You assumed without verifying. Add evidence gathering. |
| "What does the output show?" | You should have checked before proposing a fix. |
| "Stop guessing" | You're proposing fixes without root cause. Phase 1. |
| "We keep going in circles" | 3+ fix attempts = architectural problem. Phase 4.5. |

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "Issue is simple, don't need process" | Simple issues have root causes too. Process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | First fix sets the pattern. Do it right from the start. |
| "I'll write the test after confirming the fix works" | Untested fixes don't stick. Test first proves it. |
| "Multiple fixes at once saves time" | Can't isolate what worked. Creates new bugs. |
| "I can see the problem, let me fix it" | Seeing symptoms ≠ understanding root cause. |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question the pattern. |

## Quick Reference

| Phase | Key Activities | Success Criteria |
|---|---|---|
| **1. Root Cause** | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare | Identified differences |
| **3. Hypothesis** | Form theory, test minimally | Confirmed or new hypothesis |
| **4. Implementation** | Write failing test, fix, verify | Bug resolved, tests pass |

## Impact

Systematic approach vs random fixing:
- Time to fix: 15-30 min vs 2-3 hours of thrashing
- First-time fix rate: ~95% vs ~40%
- New bugs introduced by the fix: near zero vs common
