---
name: mastermind-intake
description: Shared intake protocol for mastermind — rich-prompt detection, comprehensive intake questions asked one at a time, and LLM-decide logic. Never invoked directly; called by master and standalone domain commands.
type: shared
---

# Mastermind Intake Protocol

This file is referenced by `master.md` and domain commands. Never invoke directly.

---

## Rich Prompt Detection

Count the words in `$ARGUMENTS` and scan for domain signals.

**Rich prompt** (skip all intake questions → proceed to execution) if EITHER of these holds:

- **A. Long + domain-signaled:** word count ≥ 20 AND contains at least one domain signal (build, ship, feature, bug, fix, campaign, marketing, SEO, content, review, audit, research, launch, release, sales, outreach, ops, finance, report).
- **B. Concrete imperative:** contains a clear imperative verb (fix, add, remove, rename, update, refactor, migrate, upgrade, revert, patch, bump) AND names something specific enough that no reasonable person would need clarifying questions — a file/path, a function/class/component name, an error message or stack-trace fragment, a bug symptom with a concrete detail (a number, duration, status code, version), or a named third-party service/library. This counts as rich even under 20 words and without a goal/outcome phrase. Examples:
  - "Fix the login bug where sessions expire after 5 minutes instead of 30"
  - "Rename `getUserData` to `fetchUserProfile` in src/api/users.ts"
  - "Update the Stripe webhook handler to retry on 502s"
  - "Remove the unused `legacyAuth` middleware"

**Vague prompt** (run intake): anything that meets neither A nor B.

Even with a rich prompt, if `--confirm` flag is present: skip to execution but show the plan before spawning agents and wait for "go".

---

## Intake Questions

Ask ONE question at a time. Wait for the answer before asking the next. Stop asking as soon as you have enough to proceed.

**Q1 — Goal:**
> "What outcome defines success for this run? Be as specific as you can — what will be done or produced when we're finished? (Or just say 'you decide' at any point and I'll infer the rest.)"

**Q2 — Scope:**

Infer the likely domain(s) from the Q1 answer using this keyword mapping (case-insensitive substring match; a "don't over-engineer" heuristic, not a classifier):

| Domain | Keyword signals |
|---|---|
| build | build, ship, feature, implement, code, bug, fix, develop |
| idea | idea, brainstorm, concept, pivot, explore |
| marketing | marketing, campaign, SEO, ads, brand, positioning |
| review | review, audit, evaluate, assess, critique |
| research | research, investigate, analyze, study, benchmark |
| content | content, blog, copy, article, docs, documentation |
| release | release, launch, deploy, version, publish |
| sales | sales, outreach, deal, pipeline, prospect |
| ops | ops, operations, process, workflow, infra |
| finance | finance, budget, cost, revenue, pricing |

If one or more domains match, ask a single yes/no-shaped confirmation instead of the raw menu:
> "This looks like <inferred domain(s), comma-joined> work — sound right, or something else?"

If the user confirms, use the inferred domain(s) and move on. If the user says "something else" (or nothing matched in the first place), fall back to the raw menu:
> "Which business domains should this touch? Options: build, idea, marketing, review, research, content, release, sales, ops, finance — or should I decide based on the goal?"

**Q3 — Constraints:**
> "Any constraints I should know about? Examples: don't touch production, stay within this codebase, only content work this week, timeline by end of sprint."

**Q4 — Mode:**
> "Should I execute automatically once I have a plan, or show you the plan first and wait for your approval before spawning agents?"

**Q5 — Project:**
> "Which project is this for? I'll create or find a workspace with that name. (Or I can infer it from context.)"

Skip Q4 if `--auto` or `--confirm` flag was provided. Skip Q5 if `--project <name>` flag was provided.

---

## LLM-Decide Rule

If the user responds with any of: "decide yourself", "you decide", "your call", "whatever you think", "up to you" — to any intake question:

1. Make an explicit decision. State it clearly:
   > "I'm choosing [X] because [one-sentence reason]."
2. Log this as a decision in the run's output schema with `confidence: 0.7` and `outcome: pending`.
3. Continue immediately. Do NOT ask a follow-up on the same question.

---

## Mode Resolution

After intake (or skip), resolve the execution mode:

| Flag / Answer | Mode |
|---|---|
| `--auto` flag | auto — spawn immediately after planning |
| `--confirm` flag | confirm — show plan, wait for "go" |
| Q4 answer: "auto" or "yes go ahead" | auto |
| Q4 answer: "show me first" or "confirm" | confirm |
| No flag, vague prompt | confirm (default for vague) |
| No flag, rich prompt | auto (default for rich) |

---

## Project Name Resolution

Priority order:
1. `--project <name>` flag — use exactly as provided
2. Q5 answer — use as provided
3. Infer from prompt: extract the most prominent product/project noun
4. Fallback: use today's date as `session-YYYY-MM-DD`
