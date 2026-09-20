# Org runtime review — `monomind-dev`, run `run-20260919221725-nb4b`

**Date:** 2026-09-20 · **Reviewer:** owner session, after stopping the run and finishing its work by hand
**Scope:** one run, 00:17→03:05 plus a 6-minute revival at 11:40. 8 roles, 11.9M tokens, **$2,663**.

This is a review of the *runtime and the process*, not of the code the org produced. The code was
largely good; that is the point of the first section.

---

## 1. What genuinely worked

**It found defects that ordinary review does not.** The three highest-value findings of the run were
all discovered, not assigned:

- **o-38** — plain `monomind init --yes` silently deleted user files, reported inside a
  `Files: N created` total. Reproduced three times independently, and a *second* trigger
  (`init --minimal`) was found that needs no version skew at all.
- **i-052** — a live dashboard credential committed to a public GitHub repository, root-caused to a
  glob (`*.token`) that cannot match an extensionless filename.
- **i-032a** — a checked-in `.monomind/enable-terminal.json` arming `terminal_execute`, reproduced
  end-to-end over the real MCP stdio path rather than by reading the predicate.

**The adversarial gate structure paid for itself.** There were three gate divergences where the
verifier FAILED a SHA the reviewer had APPROVED, **and the verifier was right all three times**. A
single-reviewer setup ships those.

**It audited itself harder than most humans would.** It filed five issues against its own runtime,
recorded its own enumeration failure in writing, and — repeatedly — refused to over-claim: the
i-032a `.mcp.json` note explicitly says the channel is "unverified, not merely unclosed."

**Its evidence standard was real.** RED-before-GREEN, measuring on merged trees rather than branches,
running commands rather than reasoning about them. When I re-derived its claims by hand, they held.

---

## 2. What went wrong

### 2.1 The wedge — the single most expensive failure

The run hit a session limit at **03:05**. The limit reset at **04:50**. The org sat idle until
**11:40** — roughly **seven hours** — and only moved when I answered its pending question.

Root cause is in `idle-watchdog.json`:

```json
{ "idle_minutes": 60, "idle_stop_at": null, "hold": "pending-question" }
```

`run_config.idle_minutes` was 60, but a **hold pinned the watchdog open indefinitely**. The question
holding it was explicitly marked non-blocking by its own author:

> "SECURITY DISCLOSURE — no answer needed for the run to continue; I am not blocking on this…"

So a question that declared itself non-blocking disabled the only mechanism that would have stopped
or restarted the run. The org neither worked nor died. **This is the highest-value fix on the list.**

### 2.2 No cost ceiling that can bind

`run_config.budget_tokens` is **160,000,000**. The run used 11.9M — **7%**. The budget could not
bind, and it is denominated in tokens, so it cannot express the constraint an owner actually has
("stop at $500"). $2,663 was spent with nothing capable of stopping it on cost.

Per-role spend was also lopsided in a way nothing flagged:

| role | cost | |
|---|---|---|
| dev-lead | $485 | |
| developer-1 | $467 | |
| verifier | $421 | |
| developer-2 | $395 | |
| product-evaluator | $330 | |
| architect | $324 | |
| reviewer | $227 | |
| **integrator** | **$14** | ← the role that merges to main did almost nothing |

### 2.3 Throughput was poor relative to spend

154 ledger items: **12 done, 37 never triaged at all**. During this run the org itself merged
**two** items (o-18, o-43). The other seven were finished by hand after it was stopped.

Much of the spend went into *re-review*, not review: several items ran three and four revision
rounds (o-09 reached `r3`, o-16 reached `revision 4`, i-078 `revision 3`). Nothing caps that loop.

### 2.4 Five controls that could not fail

By the org's own count, this run produced **five guards that passed without being able to fail** —
two on o-09 alone, where a guard exempted the exact alias the defect used. The org caught them, which
is to its credit, but it caught them *late*, after each had been reported as green.

### 2.5 Enumeration by assumption

`dev-lead` reported the credential exposure as affecting **4 repositories**. The real number is
**7** — it searched `projects/monoes/` and treated that directory as the population. The three it
"could not confirm" all existed one directory up.

This is the same error class the run itself had already caught three times (i-044 two→four→five,
i-074 one→six→nine, i-106 a same-named twin). **The org had derived the rule and still broke it.**

### 2.6 Real work left uncommitted where a stop would destroy it

`i-073` held **313 lines** of finished work — a 259-line test file plus the `server.mjs` fix for a
CSRF preflight bypass — sitting **uncommitted** in a worktree. Ledger item **i-016** (still open)
records that `finishStop` force-removes worktrees. A clean stop would have destroyed it. I recovered
it only because I diffed every worktree before pruning.

### 2.7 Permissions are close to inverted

From the org's own issue #1: `integrator` — the one role whose job is modifying `main` — started with
an **empty tool allowlist** and stayed "responsive" while unable to act. Meanwhile roles forbidden to
touch `main` hold `policy.git: commit`. That matches the $14 spend above: the role could not work.

### 2.8 Stale branches reported as outstanding work

Ten `dev/*` branches showed as unmerged. Their content was **already fully in main** under different
SHAs; main was 230 files and ~12.5k insertions *ahead* of the stack tip. `--no-merged` was reporting
stale pointers. Any run resuming from that signal would redo finished work.

---

## 3. Recommendations, highest value first

1. **A non-blocking question must never set a watchdog hold.** Give `ask_human` an explicit
   `blocking: true|false`; only `blocking: true` may set `hold`. Non-blocking questions get recorded
   and the run carries on. *(Fixes §2.1 — worth ~7 hours of wall-clock on this run alone.)*

2. **Treat a session/usage limit as a scheduled wait, not a death.** The roles received a message
   containing its own reset time ("resets 4:50am") and did nothing with it. Parse it, sleep until
   then, resume. Failing that, the idle watchdog must be able to fire and stop the run.

3. **Add a wall-clock ceiling and a dollar ceiling** alongside `budget_tokens`, and make the default
   something that can actually bind. A 160M-token budget on a run that uses 12M is decoration.

4. **`finishStop` must persist uncommitted worktree state before removing anything** — commit to the
   item branch or write a patch. This is i-016, and §2.6 shows it nearly cost real work.

5. **Fix the role permission matrix.** The integrator needs the tools to integrate; verify at startup
   that every role's allowlist is non-empty and fail loudly if not. A role that cannot act should not
   report as healthy.

6. **Require a RED receipt for every new guard.** No control is accepted without a stated mutation
   and the observed failure it produces. Five vacuous controls in one run is a process gap, not bad
   luck — and the check is cheap.

7. **Encode the enumeration rule the org derived**: *enumerate from the artifact the code actually
   reads, never from a directory you assume is the population.* Put it in the role prompts; it has
   now been violated four times including by the lead.

8. **Cap revision rounds.** After three, escalate to the owner instead of looping. Several items
   consumed more in re-review than they did in being built.

9. **Validate branch state against content, not ancestry.** Before reporting outstanding work, check
   whether the diff against main is empty — §2.8 would have sent a resuming run to redo ten
   finished branches.

---

## 4. The honest summary

The org is **good at finding things and bad at finishing them**. Its defect discovery is genuinely
better than routine human review — o-38, i-052 and i-032a are all real, all severe, and none were on
anyone's list. Its self-criticism is unusual and valuable.

But it converted $2,663 into two merged items, left 37 of 154 items untouched, left finished work
uncommitted where its own stop path would have deleted it, and spent seven hours wedged because a
question that said it was not blocking blocked everything.

Recommendations 1, 2 and 4 are the ones that change the economics. They are all small.
