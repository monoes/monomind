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

**Rich prompt** (skip all intake questions → proceed to execution):
- Word count ≥ 20 AND
- Contains at least one domain signal (build, ship, feature, bug, fix, campaign, marketing, SEO, content, review, audit, research, launch, release, sales, outreach, ops, finance, report) AND
- Contains a goal or outcome phrase (e.g. "so that", "by end of", "targeting", "for our", "to improve")

**Vague prompt** (run intake): anything that doesn't meet rich-prompt criteria.

Even with a rich prompt, if `--confirm` flag is present: skip to execution but show the plan before spawning agents and wait for "go".

---

## Intake Questions

Ask ONE question at a time. Wait for the answer before asking the next. Stop asking as soon as you have enough to proceed.

**Q1 — Goal:**
> "What outcome defines success for this run? Be as specific as you can — what will be done or produced when we're finished?"

**Q2 — Scope:**
> "Which business domains should this touch? Options: build, idea, marketing, review, research, content, release, sales, ops, finance — or should I decide based on the goal?"

**Q3 — Constraints:**
> "Any constraints I should know about? Examples: don't touch production, stay within this codebase, only content work this week, timeline by end of sprint."

**Q4 — Mode:**
> "Should I execute automatically once I have a plan, or show you the plan first and wait for your approval before spawning agents?"

**Q5 — Project:**
> "Which project is this for? I'll create or find a monotask space with that name. (Or I can infer it from context.)"

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
