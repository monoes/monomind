---
name: verification-quality
description: Comprehensive truth scoring, code quality verification, and automatic rollback system with a 0.95 confidence threshold for ensuring high-quality agent outputs and codebase reliability.
---

# verification-quality — Evidence Before Claims

## Overview

Claims without evidence are noise. "It works", "tests pass", "I fixed it" — none of
these mean anything until verified against the codebase, the test suite, and the build.

This skill wires four concepts to monomind's real command surface: **truth scoring**
(a 0.0–1.0 confidence score from citable evidence), an **evidence-before-claims
protocol** (require `file:line`, test names, or build output before marking done),
**auto-rollback** (regression detection via `analyze diff`, revert via git), and a
**multi-angle quality workflow** (correctness, tests, security, performance, docs).

**Core principle:** NO CLAIM IS TRUE UNTIL VERIFIED AGAINST EVIDENCE.

**Iron Law:**
```
NO "DONE" WITHOUT A TRUTH SCORE ≥ 0.95 BACKED BY CITABLE EVIDENCE
```

If you cannot point to a `file:line`, a passing test name, or a green build, you
have not finished. You have started.

## When to Use

Use for ANY task that ends in a claim of completion: "I implemented X", "the bug is
fixed", "tests pass", "ready to ship", or any agent-returned work.

**Use this ESPECIALLY when:** the agent (or you) is in a hurry — that's when false
claims slip in; the change touches security, money, auth, or data integrity; a
previous attempt already failed; you're about to commit, push, open a PR, or merge.

**Don't skip when:** "it's a tiny change" (tiny changes break tests too) or "I'm sure"
(confidence without evidence is the failure mode this skill prevents).

## The Real Command Surface

These are the ONLY commands this skill wires to. Anything else is invented.

| Command | What it does | Phase |
|---|---|---|
| `monomind analyze diff` | Git diff risk + change classification | Evidence, regression |
| `monomind analyze code` | Static code analysis | Verification |
| `monomind analyze deps --security` | Dependency CVEs | Verification |
| `monomind analyze complexity` | Cyclomatic complexity | Verification |
| `monomind analyze symbols` | Extract functions/classes/types | Evidence |
| `monomind analyze imports` | Import graph | Verification |
| `monomind security scan` | Vulnerability + secret scan | Verification |
| `monomind security secrets` | Dedicated secret detection | Verification |
| `monomind security audit` | Security audit log | Verification |
| `monomind performance benchmark` | Run benchmarks (wasm/memory/search) | Evidence |
| `monomind performance metrics` | View/export metrics | Monitoring |
| `monomind performance bottleneck` | Identify bottlenecks | Verification |
| `monomind doctor` / `doctor --fix` | 28 health-check categories | Baseline, monitoring |
| `monomind hooks metrics` | Learning-hook metrics | Monitoring |
| `monomind hooks intelligence` | Neural/MoE/HNSW status | Monitoring |
| `monomind monograph search` | Knowledge graph search (BM25/semantic/hybrid) | Evidence |
| `monomind monograph build` | Build/rebuild the knowledge graph | Baseline |
| `monomind tokens dashboard` | Token spend | Monitoring |

> Use `npx monomind@latest ...` from outside the repo; inside the repo
> `node packages/@monomind/cli/bin/cli.js ...` works too. **Never use `monomind@alpha`** —
> it does not exist.

### MCP tools (called by Claude Code, not the CLI)

| Tool | Use |
|---|---|
| `mcp__monomind__hooks_pre-task` | Capture task intent + acceptance criteria before work |
| `mcp__monomind__hooks_post-task` | Record outcome + evidence after work |
| `mcp__monomind__monograph_query` | Find `file:line` for a symbol before citing it |
| `mcp__monomind__monograph_impact` | Blast radius before risky edits |
| `mcp__monomind__monograph_context` | 360° callers/callees for the change site |
| `mcp__monomind__system_health` | Snapshot system health before declaring done |
| `mcp__monomind__system_metrics` | Objective metrics for the verification record |

---

## Core Concept: The Truth Score

A truth score is a 0.0–1.0 confidence value derived from **evidence you can cite**,
not a feeling. The default ship threshold is **0.95**. The score is computed in
Phase 3 from real command output; the action mapping lives in Phase 4. You do not
invent it.

---

## The Four Phases

Complete each phase before moving on. Skipping a phase produces unverified claims.

### Phase 1: Evidence Collection

BEFORE claiming work is done, gather evidence it actually works.

**1a. State the claim precisely:**
> "I claim X is done. Acceptance criteria: [list]. Evidence required: [list]."

**1b. Capture task intent (MCP) and cite the change site via the knowledge graph:**
```
mcp__monomind__hooks_pre-task({ task: "...", acceptance: ["...", "..."] })
mcp__monomind__monograph_query(symbol: "refreshToken")     # cite before editing
mcp__monomind__monograph_impact(file: "src/auth/refresh.ts")
```
Every cited location must be `file:line`. "Somewhere in auth" is not a citation.

**1c. Capture the diff as evidence:**
```bash
npx monomind@latest analyze diff --risk --classify -v > evidence-diff.json
npx monomind@latest analyze imports src/auth --external    # import-graph blast radius
```

**Success criteria:** acceptance criteria written, diff classified on disk, every
changed symbol cited as `file:line`.

---

### Phase 2: Multi-Angle Verification

Run each angle that applies. **All applicable angles must pass** or the truth score
drops. Skip an angle only when it genuinely does not apply (and say so).

**Angle 1 — Correctness (always applies):**
```bash
npx monomind@latest analyze code src/auth/    # static analysis on touched paths
npm run build && npm run typecheck            # use the project's real commands
```

**Angle 2 — Tests (always applies when tests exist):**
```bash
npm test -- --reporter=spec
```
The evidence is **test names + counts**, not "tests passed".

**Angle 3 — Security (applies to auth, crypto, input boundaries, deps):**
```bash
npx monomind@latest security scan
npx monomind@latest security secrets
npx monomind@latest analyze deps --security
```

**Angle 4 — Performance (applies to hot paths, queries, bundles):**
```bash
npx monomind@latest performance benchmark -s all -i 100 -o json > bench.json
npx monomind@latest performance bottleneck
npx monomind@latest analyze complexity src/auth/ -t 10
```

**Angle 5 — Documentation (applies to public APIs, behavior changes):**
```bash
npx monomind@latest analyze symbols src/auth/refresh.ts   # did docs track changes?
```
If exported symbols changed and docs didn't, this angle fails.

**Angle 6 — System health:**
```bash
npx monomind@latest doctor
```
A red doctor category blocks the claim, even if the code looks fine.

---

### Phase 3: Truth Score Computation

Score each applicable angle — judgment against a checklist, not a vibe:

| Angle | 1.0 (full) | 0.5 (partial) | 0.0 (fail/no evidence) |
|---|---|---|---|
| Correctness | Build + typecheck + analyze code clean | Typecheck clean, build warnings | Build or typecheck fails |
| Tests | All relevant tests pass, names captured | New tests pass, one pre-existing flake | Any relevant test fails |
| Security | `security scan`, `secrets`, `deps --security` clean | One informational finding, no exploit path | Any HIGH/CRITICAL or leaked secret |
| Performance | Benchmark within baseline, no new hotspot | Within ±5% of baseline | Regression vs. baseline |
| Documentation | All changed symbols documented | Minor export undocumented | Public API change with no doc update |
| System health | `doctor` green | Yellows acknowledged | Any red category |

**Composite score formula:**
```
truth_score = (sum of angle scores) / (number of applicable angles)
```

A failing angle zeroes its row. **Any 0.0 angle caps the composite at 0.85** —
critical findings always block shipping regardless of the average.

Write the score and per-angle evidence to the task record:
```
mcp__monomind__hooks_post-task({
  task: "Fix auth refresh race", outcome: "complete", truth_score: 0.96,
  evidence: {
    diff: "evidence-diff.json",
    tests: "auth.test.ts: 42 passed, 0 failed",
    security: "scan clean; deps --security 0 HIGH",
    performance: "benchmark within 1.2% of baseline",
    health: "doctor green",
    citations: ["src/auth/refresh.ts:87", "src/auth/refresh.ts:134"]
  }
})
```

---

### Phase 4: Decision — Ship, Fix, or Rollback

Use the composite score from Phase 3:

| Score | Decision | Required action |
|---|---|---|
| `≥ 0.95` | **Ship** | Record evidence via `hooks_post-task`; proceed to commit/PR |
| `0.85–0.94` | **Ship with caveats** | Record the gaps explicitly in the PR description |
| `0.75–0.84` | **Fix** | Return to Phase 1 with the failing angle as the new task |
| `< 0.75` | **Rollback** | See Auto-Rollback below; do not leave broken code on the branch |

**3 or more fix loops without reaching 0.95 → architectural problem.** Stop, discuss
with the user. Do not attempt a 4th loop. (Same rule as `mastermind-debug` Phase 4.5.)

---

## Methodology: Auto-Rollback

When a change scores below 0.75, or a regression is detected after merge, revert.
monomind does not have a magic `verify rollback` subcommand — rollback is **git +
evidence from `analyze diff`**.

**1. Confirm the regression is real:**
```bash
npx monomind@latest analyze diff --risk -v              # was it high-risk at review?
npx monomind@latest analyze complexity src/ -t 15 -f json
npx monomind@latest performance benchmark -s all -i 100 -o json > now.json
# diff now.json against the saved baseline
```

**2. Roll back to the last known-good state:**
```bash
git log --oneline -10
git revert <bad-commit> --no-edit          # preserves the diagnosis in history
# or, if nothing downstream depends on it:
git reset --hard <last-good-commit>
```

**3. Prevent recurrence:**
```bash
# Add a regression test for the failure mode BEFORE re-attempting (see mastermind-debug Phase 4)
npx monomind@latest doctor                  # re-verify the rolled-back state
npx monomind@latest security scan
```

**Rules:**
- Never rollback silently — record what failed and why in the postmortem.
- Selective rollback (revert one file, keep another) is fine **if** `analyze diff`
  shows the changes are independent. Otherwise revert as a unit.
- Always re-verify the rolled-back state passes the failing angle.

---

## Methodology: CI/CD Integration

Wire the same four phases into CI so unverified work cannot merge.

**GitHub Action — quality gate on PRs:**
```yaml
name: Quality Verification
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # analyze diff needs history
      - run: npm ci
      - name: Build + typecheck + tests   # Angle 1 + 2
        run: |
          npm run build
          npm run typecheck
          npm test
      - name: Diff risk + security        # Angle 3
        run: |
          npx monomind@latest analyze diff main..HEAD --risk --classify --format json > diff-risk.json
          npx monomind@latest security scan
          npx monomind@latest analyze deps --security
      - name: Health + benchmark          # Angle 4 + 6
        run: |
          npx monomind@latest doctor
          npx monomind@latest performance benchmark -s all -i 50 -o json > bench.json
      - uses: actions/upload-artifact@v4
        with: { name: verification-evidence, path: "diff-risk.json\nbench.json" }
```

> Prefer **risk classification** (qualitative, stable) over **hard latency thresholds**
> (fragile, flaky) for the gate. Use metrics for trend analysis offline.

---

## Methodology: Continuous Monitoring

Verification is not just a PR gate. Keep watching after merge:

```bash
npx monomind@latest doctor                                          # daily health
npx monomind@latest performance metrics -t 7d -f json > "metrics-$(date +%Y%m%d).json"
npx monomind@latest hooks metrics                                   # what hooks learned
npx monomind@latest hooks intelligence                              # neural/HNSW status (usually not-loaded)
npx monomind@latest tokens dashboard -p week --no-interactive       # spend surprises → quality problems
```

For long-term storage, pipe `performance metrics -f prometheus` into Prometheus and
alert on trend, not on single values.

---

## Red Flags — STOP and Return to Phase 1

| Thought / Action | What it means |
|---|---|
| "It works" with no test names or file:line | No evidence. Phase 1. |
| "Tests pass" with no output captured | Untested claim. Re-run and capture. |
| "It's a tiny change, skip verification" | Tiny changes break tests too. Phase 2. |
| "Security probably isn't affected" | Probably ≠ verified. If auth/crypto/input touched, run `security scan`. |
| "Performance feels fine" | Feeling is not measurement. Run `performance benchmark`. |
| Skipping an angle without saying why | Silent skips are how bugs ship. State "N/A because…". |
| "Doctor has a red but it's unrelated" | Verify the unrelated-ness, don't assume. |
| 3+ fix loops, still < 0.95 | Architectural problem. Stop, discuss design. |
| Merging with score 0.85 "to unblock" | Below threshold is below threshold. Fix the gap. |
| "The agent said it's done" / "it compiled" | Agent claims and clean compiles are inputs to verify, not conclusions. |

---

## Related Skills

- [`mastermind-debug`](../mastermind-debug/SKILL.md) — root-cause methodology when verification finds a failure; Phase 4 covers failing-test-first evidence collection
- [`performance-analysis`](../performance-analysis/SKILL.md) — Phase 2 Angle 4 deep-dive
- [`mastermind-receive-review`](../mastermind-receive-review/SKILL.md) — same rigor applied to incoming review feedback
- [`swarm-orchestration`](../swarm-orchestration/SKILL.md) — every agent output runs through Phase 1–4 before merge

## Quick Reference

| Phase | Key commands | Success criteria |
|---|---|---|
| **1. Evidence** | `analyze diff --risk`, `monograph query/impact`, `hooks_pre-task` | Acceptance criteria + cited `file:line` on disk |
| **2. Verification** | `analyze code`, `security scan`, `performance benchmark`, `analyze complexity`, `doctor` | Every applicable angle scored |
| **3. Truth score** | Composite formula above | Numeric score + per-angle evidence recorded via `hooks_post-task` |
| **4. Decision** | `git` (rollback when `< 0.75`) | Ship ≥ 0.95, fix 0.75–0.94, rollback `< 0.75` |

---

**Version**: 2.0.0 · **Last Updated**: 2026-08-12
