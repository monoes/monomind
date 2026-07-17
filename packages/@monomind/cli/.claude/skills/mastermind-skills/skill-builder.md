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

Invoke `Skill("mastermind-skills:[name]")` passing: brain_context, params, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure.

Invoke `Skill("mastermind-skills:_repeat")` now. Required — do not skip.
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

### Descriptive Naming

**Use active voice, verb-first:**
- ✅ `creating-skills` not `skill-creation`
- ✅ `condition-based-waiting` not `async-test-helpers`

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
- Use cross-references: `**REQUIRED BACKGROUND:** Use Skill("mastermind-skills:X")`
- One excellent example beats many mediocre ones

### Cross-Referencing Other Skills

```markdown
# GOOD: Explicit requirement marker
**REQUIRED SUB-SKILL:** Use Skill("mastermind-skills:worktree")
**REQUIRED BACKGROUND:** You MUST understand Skill("mastermind-skills:finish")

# BAD: Unclear if required
See mastermind/worktree.md
```

**Why no @ links:** `@` syntax force-loads files immediately, consuming context before it's needed. Name the skill; let the reader invoke it.

## Flowchart Usage

**Use flowcharts ONLY for:**
- Non-obvious decision points
- Process loops where you might stop too early
- "When to use A vs B" decisions

**Never use flowcharts for:**
- Reference material → tables, lists
- Code examples → markdown blocks
- Linear instructions → numbered lists
- Labels without semantic meaning (step1, helper2)

## Code Examples

**One excellent example beats many mediocre ones.** Choose the most relevant language for the domain.

**Good example:** complete and runnable, well-commented explaining WHY, from a real scenario, ready to adapt.

**Don't:** implement in 5+ languages, create fill-in-the-blank templates, write contrived examples.

## File Organization

Mastermind skills are single files in a flat namespace. Keep everything inline. If a skill genuinely needs heavy reference material (500+ lines of API docs), condense it to what agents actually retrieve — a skill nobody can afford to load teaches nothing. Reusable prompt templates (like taskdev's implementer/reviewer prompts) live as sibling `*-prompt.md` files in the skills directory.

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
- Don't keep untested changes as "reference"
- Don't "adapt" while running tests
- Delete means delete

## Testing All Skill Types

Different skill types need different test approaches:

### Discipline-Enforcing Skills (rules/requirements)

**Examples:** tdd, verify, design-before-code gates

**Test with:** academic questions (do they understand the rules?), pressure scenarios (do they comply under stress?), multiple pressures combined (time + sunk cost + exhaustion). Identify rationalizations and add explicit counters.

**Success criteria:** agent follows the rule under maximum pressure.

### Technique Skills (how-to guides)

**Test with:** application scenarios (can they apply it correctly?), variation scenarios (edge cases?), missing-information tests (do the instructions have gaps?).

**Success criteria:** agent successfully applies the technique to a new scenario.

### Pattern Skills (mental models)

**Test with:** recognition scenarios (do they see when it applies?), application scenarios, counter-examples (do they know when NOT to apply?).

**Success criteria:** agent correctly identifies when/how to apply the pattern.

### Reference Skills (documentation/APIs)

**Test with:** retrieval scenarios (can they find the right information?), application scenarios (can they use it correctly?), gap testing (are common use cases covered?).

**Success criteria:** agent finds and correctly applies the reference information.

## Match the Form to the Failure

Before writing guidance, classify the baseline failure. The form that bulletproofs one failure type measurably backfires on another.

| Baseline failure | Right form | Wrong form |
|---|---|---|
| Skips/violates a rule under pressure (knows better, does it anyway) | Prohibition + rationalization table + red flags (see Bulletproofing below) | Soft guidance ("prefer...", "consider...") |
| Complies, but output has the wrong shape (bloated prompt, buried verdict, restated spec) | Positive recipe or contract: state what the output IS — its parts, in order | Prohibition list ("don't restate", "never narrate") |
| Omits a required element from something they already produce | Structural: REQUIRED field or slot in the template they fill in | Prose reminders near the template |
| Behavior should depend on a condition | Conditional keyed to an observable predicate ("if the brief exists, reference it") | Unconditional rule + exemption clauses |

**Why prohibitions backfire on shaping problems:** under a competing incentive, agents negotiate with "don't X". A recipe leaves nothing to negotiate: the output matches the stated shape or it doesn't.

**Rules for whichever form you pick:**
- **No nuance clauses.** "Don't X unless it matters" reopens the negotiation. Express a real exception as its own conditional on an observable predicate.
- **Exemption clauses don't scope.** "This limit doesn't apply to code blocks" still suppresses code blocks. If part of the output must be exempt, restructure so the rule can't reach it.

## Bulletproofing Skills Against Rationalization

Skills that enforce discipline (like TDD) need to resist rationalization. Agents are smart and will find loopholes when under pressure.

**Scope:** this toolkit is for discipline failures — an agent that knows the rule and skips it under pressure. For wrong-shaped output or omitted elements, prohibition-based bulletproofing backfires; use the forms in Match the Form to the Failure instead.

### Close Every Loophole Explicitly

Don't just state the rule — forbid specific workarounds. "Write code before test? Delete it." becomes: "Delete it. Start over. No exceptions: don't keep it as 'reference', don't 'adapt' it while writing tests, don't look at it. Delete means delete."

### Address "Spirit vs Letter" Arguments

Add the foundational principle early: **"Violating the letter of the rules is violating the spirit of the rules."** This cuts off the entire class of "I'm following the spirit" rationalizations.

### Build Rationalization Table

Capture rationalizations from baseline testing. Every excuse agents make goes in the table as `| Excuse | Reality |` rows.

### Create Red Flags List

Make it easy for agents to self-check when rationalizing: a short list of the exact thoughts that mean STOP, ending with what to do instead.

### Update the Description for Violation Symptoms

Add to the description the symptoms of when you're ABOUT to violate the rule (e.g. "use when implementing any feature or bugfix, **before writing implementation code**").

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

### Micro-Test Wording Before Full Scenarios

Full pressure-scenario runs are the final gate, but they are slow and expensive per iteration. Verify the wording itself first with micro-tests:

1. **One fresh-context sample per call** — a single-shot subagent whose instructions embed the guidance in the realistic context it will live in (the full skill, not the guidance in isolation), given a task that tempts the failure.
2. **Always include a no-guidance control.** If the control doesn't exhibit the failure, there is nothing to fix — stop, don't author the guidance.
3. **5+ reps per variant.** Single samples lie.
4. **Manually read every flagged match.** Template echoes and quoted counter-examples masquerade as hits; automated counts alone overstate both failure and success.
5. **Variance is a metric.** When guidance lands, reps converge on the same shape. Five different interpretations across five reps means the wording isn't binding — tighten the form before adding words.

Micro-tests verify wording; they do not replace pressure scenarios for discipline skills.

## Common Rationalizations for Skipping Testing

| Excuse | Reality |
|--------|---------|
| "Skill is obviously clear" | Clear to you ≠ clear to other agents. Test it. |
| "It's just a reference" | References can have gaps. Test retrieval. |
| "Testing is overkill" | Untested skills have issues. Always. |
| "I'll test if problems emerge" | Test BEFORE deploying. |
| "I'm confident it's good" | Overconfidence guarantees issues. Test anyway. |
| "Academic review is enough" | Reading ≠ using. Test application scenarios. |
| "Too tedious to test" | Testing is less tedious than debugging a bad skill in production. |
| "No time to test" | Deploying an untested skill wastes more time fixing it later. |

**All of these mean: Test before deploying. No exceptions.**

## Anti-Patterns

### ❌ Narrative Example
"In session 2025-10-03, we found empty projectDir caused..."
**Why bad:** Too specific, not reusable

### ❌ Multi-Language Dilution
example-js.js, example-py.py, example-go.go
**Why bad:** Mediocre quality, maintenance burden

### ❌ Code in Flowcharts
Flowchart nodes containing code statements
**Why bad:** Can't copy-paste, hard to read

### ❌ Generic Labels
helper1, helper2, step3, pattern4
**Why bad:** Labels should have semantic meaning

## STOP: Before Moving to Next Skill

**After writing ANY skill, you MUST STOP and complete the deployment process.**

**Do NOT:**
- Create multiple skills in batch without testing each
- Move to the next skill before the current one is verified
- Skip testing because "batching is more efficient"

**The deployment checklist below is MANDATORY for EACH skill.** Deploying untested skills = deploying untested code.

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
- [ ] Guidance form matches the failure type (see Match the Form to the Failure)
- [ ] For behavior-shaping guidance: wording micro-tested against a no-guidance control (5+ reps, every flagged match read manually) — N/A for pure reference skills
- [ ] One excellent example (not multi-language)
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
- [ ] Mirror both files into `packages/@monomind/cli/.claude/` (the npm-shipped copy)

## Discovery Workflow

How future agents find your skill:

1. **Encounters problem** ("tests are flaky")
2. **Searches skills** (greps descriptions, browses the namespace)
3. **Finds the skill** (description matches)
4. **Scans overview** (is this relevant?)
5. **Reads patterns** (quick reference table)
6. **Loads example** (only when implementing)

**Optimize for this flow** — put searchable terms early and often.

## The Bottom Line

**Creating mastermind skills IS TDD for process documentation.**

Same Iron Law: No skill without failing test first.
Same cycle: RED (baseline) → GREEN (write skill) → REFACTOR (close loopholes).
Same benefits: Better quality, fewer surprises, bulletproof results.
