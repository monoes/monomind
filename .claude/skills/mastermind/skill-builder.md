---
name: mastermind-skill-builder
description: Use when creating new mastermind skills, editing existing mastermind skills, or verifying mastermind skills work before deployment
---

# Writing Mastermind Skills

## Overview

**Writing mastermind skills IS Test-Driven Development applied to process documentation.**

**Mastermind skills live in `.claude/skills/mastermind/` and commands in `.claude/commands/mastermind/`.**

You write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes).

**Core principle:** If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.

## What is a Mastermind Skill?

A **skill** is a reference guide for proven techniques, patterns, or tools. Skills help future Claude instances find and apply effective approaches.

**Skills are:** Reusable techniques, patterns, tools, reference guides

**Skills are NOT:** Narratives about how you solved a problem once

## TDD Mapping for Skills

| TDD Concept | Skill Creation |
|-------------|----------------|
| **Test case** | Pressure scenario with subagent |
| **Production code** | Skill document (`.md`) |
| **Test fails (RED)** | Agent violates rule without skill (baseline) |
| **Test passes (GREEN)** | Agent complies with skill present |
| **Refactor** | Close loopholes while maintaining compliance |
| **Write test first** | Run baseline scenario BEFORE writing skill |
| **Watch it fail** | Document exact rationalizations agent uses |
| **Minimal code** | Write skill addressing those specific violations |
| **Watch it pass** | Verify agent now complies |
| **Refactor cycle** | Find new rationalizations → plug → re-verify |

## When to Create a Skill

**Create when:**
- Technique wasn't intuitively obvious
- You'd reference this again across projects
- Pattern applies broadly (not project-specific)
- Others would benefit

**Don't create for:**
- One-off solutions
- Standard practices well-documented elsewhere
- Project-specific conventions (put in CLAUDE.md)
- Mechanical constraints (if it's enforceable with regex/validation, automate it)

## Skill Types

### Technique
Concrete method with steps to follow

### Pattern
Way of thinking about problems

### Reference
API docs, syntax guides, tool documentation

## Directory Structure

```
.claude/skills/mastermind/
  skill-name.md              # Main skill (required)

.claude/commands/mastermind/
  skill-name.md              # Command entry point (required)
```

**Flat namespace** — all mastermind skills in one searchable namespace.

## Skill File Structure

**Frontmatter (YAML):**
- Two required fields: `name` and `description` (max 1024 characters total)
- `name`: Use letters, numbers, and hyphens only (no parentheses, special chars)
- `description`: Third-person, describes ONLY when to use (NOT what it does)
  - Start with "Use when..." to focus on triggering conditions
  - Include specific symptoms, situations, and contexts
  - **NEVER summarize the skill's process or workflow** (see CSO section)
  - Keep under 500 characters if possible

```markdown
---
name: mastermind-skill-name
description: Use when [specific triggering conditions and symptoms]
---

# Skill Name

## Overview
What is this? Core principle in 1-2 sentences.

## Quick Reference
Table or bullets for scanning common operations

## The Process / Core Pattern
Steps, before/after comparisons

## Common Mistakes
What goes wrong + fixes

## Red Flags
Never / Always lists
```

## Command File Structure

Every skill needs a companion command file:

```markdown
---
name: mastermind-[name]
description: [one-line description of when to use]
---

**First — extract repeat flags:** Follow REPEAT PREAMBLE from `_repeat.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text.

Load brain context (follow `_protocol.md` Brain Load Procedure).

Default mode: **confirm** (or **auto** for low-risk/fast skills).

---

Invoke `Skill("mastermind:[name]")` passing: brain_context, params, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure.

Invoke `Skill("mastermind:_repeat")` now. Required — do not skip.
```

## Claude Search Optimization (CSO)

**Critical for discovery:** Future Claude must FIND your skill.

### Description = When to Use, NOT What the Skill Does

The description should ONLY describe triggering conditions. Do NOT summarize the skill's process or workflow in the description.

**Why this matters:** When a description summarizes the workflow, Claude may follow the description instead of reading the full skill content — the skill body becomes documentation Claude skips.

```yaml
# BAD: Summarizes workflow
description: Use when finishing branches - runs tests, shows 4 options, handles merge/PR/cleanup

# BAD: Too much process detail
description: Use for TDD - write test first, watch it fail, write minimal code, refactor

# GOOD: Just triggering conditions
description: Use when implementation is complete and you need to decide how to integrate the work

# GOOD: Triggering conditions only
description: Use when receiving code review feedback before implementing suggestions
```

### Keyword Coverage

Use words Claude would search for:
- Error messages and symptoms
- Synonyms (timeout/hang/freeze, cleanup/teardown)
- Tools: actual commands, library names

### Token Efficiency (Critical)

**Target word counts:**
- Frequently-loaded skills: under 200 words total
- Other skills: under 500 words (still be concise)

**Techniques:**
- Reference other skills instead of repeating content
- Use cross-references: `**REQUIRED BACKGROUND:** Use Skill("mastermind:X")`
- One excellent example beats many mediocre ones

### Cross-Referencing Other Skills

```markdown
# GOOD: Explicit requirement marker
**REQUIRED SUB-SKILL:** Use Skill("mastermind:worktree")
**REQUIRED BACKGROUND:** You MUST understand Skill("mastermind:finish")

# BAD: Unclear if required
See mastermind/worktree.md
```

## The Iron Law (Same as TDD)

```
NO SKILL WITHOUT A FAILING TEST FIRST
```

This applies to NEW skills AND EDITS to existing skills.

Write skill before testing? Delete it. Start over.
Edit skill without testing? Same violation.

**No exceptions:**
- Not for "simple additions"
- Not for "just adding a section"
- Not for "documentation updates"
- Delete means delete

## RED-GREEN-REFACTOR for Skills

### RED: Write Failing Test (Baseline)

Run pressure scenario with subagent WITHOUT the skill. Document exact behavior:
- What choices did they make?
- What rationalizations did they use (verbatim)?
- Which pressures triggered violations?

### GREEN: Write Minimal Skill

Write skill that addresses those specific rationalizations. Don't add extra content for hypothetical cases.

Run same scenarios WITH skill. Agent should now comply.

### REFACTOR: Close Loopholes

Agent found new rationalization? Add explicit counter. Re-test until bulletproof.

## Common Rationalizations for Skipping Testing

| Excuse | Reality |
|--------|---------|
| "Skill is obviously clear" | Clear to you ≠ clear to other agents. Test it. |
| "It's just a reference" | References can have gaps. Test retrieval. |
| "Testing is overkill" | Untested skills have issues. Always. |
| "I'll test if problems emerge" | Test BEFORE deploying. |
| "I'm confident it's good" | Overconfidence guarantees issues. Test anyway. |

## Skill Creation Checklist

**RED Phase:**
- [ ] Create pressure scenarios (3+ combined pressures for discipline skills)
- [ ] Run scenarios WITHOUT skill — document baseline behavior verbatim
- [ ] Identify patterns in rationalizations/failures

**GREEN Phase:**
- [ ] Name uses only letters, numbers, hyphens
- [ ] YAML frontmatter with `name` and `description` fields
- [ ] Description starts with "Use when..." — triggering conditions only
- [ ] Description written in third person
- [ ] Keywords throughout for search
- [ ] Clear overview with core principle
- [ ] Address specific baseline failures from RED phase
- [ ] Run scenarios WITH skill — verify agents now comply

**REFACTOR Phase:**
- [ ] Identify NEW rationalizations from testing
- [ ] Add explicit counters for discipline skills
- [ ] Build rationalization table from all test iterations
- [ ] Create red flags list
- [ ] Re-test until bulletproof

**Deployment:**
- [ ] Skill file at `.claude/skills/mastermind/<name>.md`
- [ ] Command file at `.claude/commands/mastermind/<name>.md`
- [ ] Commit both files to git

## The Bottom Line

**Creating mastermind skills IS TDD for process documentation.**

Same Iron Law: No skill without failing test first.
Same cycle: RED (baseline) → GREEN (write skill) → REFACTOR (close loopholes).
Same benefits: Better quality, fewer surprises, bulletproof results.
