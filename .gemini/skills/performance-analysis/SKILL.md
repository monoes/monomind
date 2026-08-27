---
name: performance-analysis
description: Comprehensive performance analysis, bottleneck detection, and optimization recommendations for Monomind swarms
---

# performance-analysis — Measure, Don't Guess

## Overview

Performance work without measurement is superstition. This skill wires a disciplined
methodology to monomind's real `performance` and `analyze` command surfaces.

**Core principle:** ALWAYS measure before optimizing. ALWAYS confirm a bottleneck is
real before fixing it. Symptoms are not root causes.

**Iron Law:**
```
NO OPTIMIZATION WITHOUT A MEASURED BOTTLENECK FIRST
```

## When to Use

- Something feels slow (swarm run, memory search, build, MCP tool call)
- Before/after a change that could affect performance
- A regression report or user complaint about latency
- Capacity planning — picking `maxAgents`, topology, or memory backend
- Token burn higher than expected

**Use ESPECIALLY when:** the fix "feels obvious". Obvious fixes without measurement
are the most common source of fake optimizations.

## The Real Command Surface

These are the ONLY performance/analysis commands. Anything else is wrong.

| Command | What it does |
|---|---|
| `monomind performance benchmark` | Run benchmarks (wasm/neural/memory/search) |
| `monomind performance profile` | Profile CPU/memory/IO over a window |
| `monomind performance metrics` | View/export metrics (1h/24h/7d/30d) |
| `monomind performance bottleneck` | Identify bottlenecks (quick or full) |
| `monomind analyze diff` | Git diff risk + change classification |
| `monomind analyze code` | Static code analysis |
| `monomind analyze deps` | Dependency analysis (`--security` for CVEs) |
| `monomind analyze ast` | AST analysis via tree-sitter |
| `monomind analyze complexity` | Code complexity metrics |
| `monomind analyze symbols` | Extract functions/classes/types |
| `monomind analyze imports` | Import dependency graph |
| `monomind doctor` | 28 health-check categories |
| `monomind hooks metrics` | Learning metrics dashboard |
| `monomind tokens dashboard` | Token usage (`today`/`week`/`30days`/`month`) |

> Use `npx monomind@latest ...` from outside the repo; inside the repo `node packages/@monomind/cli/bin/cli.js ...` works too. Never use `monomind@alpha`.

## The Four Phases

Complete each phase before moving on. Skipping a phase produces fake optimizations.

---

### Phase 1: Establish a Baseline

Before changing anything, capture the current state so later comparison is honest.

```bash
# Benchmark the subsystems you care about
npx monomind@latest performance benchmark -s all -i 100 -o json > baseline-bench.json

# Snapshot current metrics for the relevant window
npx monomind@latest performance metrics -t 24h -f json > baseline-metrics.json

# Capture a profile so you know where time is going today
npx monomind@latest performance profile -t all -d 60 -o baseline-profile.json
```

**Success criteria:** you have numbers on disk for "before". No before, no after.

---

### Phase 2: Find the Bottleneck (don't guess, ask the system)

`performance bottleneck` answers the question "where is time being spent?".

```bash
# Quick triage across the whole system
npx monomind@latest performance bottleneck

# Deep dive when quick confirms something is off
npx monomind@latest performance bottleneck -d full

# Scope to a suspected component (e.g. network, memory, search)
npx monomind@latest performance bottleneck -c memory
```

**Map symptoms to components:**

| Symptom | First component to check |
|---|---|
| Slow swarm coordination | network (inter-agent messages) |
| Memory search slow | memory (SQLite vs. WASM fallback path) |
| Token burn surprise | cpu / model invocation |
| Boot/startup slow | io (file reads, graph load) |
| MCP tool latency | network (server round-trip) |

**If `bottleneck` reports nothing:** the problem may be code-level, not system-level.
Move to Phase 2b.

#### Phase 2b: Code-Level Analysis

When the system is healthy but the code is slow, switch to `analyze`:

```bash
# Riskiest recent change — most likely regression source
npx monomind@latest analyze diff --risk --classify -v

# Flag high-complexity hotspots (default threshold 10)
npx monomind@latest analyze complexity src/ -t 15 -f json

# Inspect import graph for accidental heavy dependencies
npx monomind@latest analyze imports src/ --external

# Dependency audit (CVEs and bloat both hurt performance)
npx monomind@latest analyze deps --security
```

**Heuristic:** a regression that appeared in the last N commits is almost always
visible in `analyze diff --risk`. Start there before going deeper.

---

### Phase 3: Interpret the Metrics

Numbers without interpretation are noise. Read the dashboard, then explain it.

```bash
# Pull a metrics view for the affected window
npx monomind@latest performance metrics -t 7d -f text

# Prometheus export for Grafana / long-term storage
npx monomind@latest performance metrics -t 30d -f prometheus > metrics.prom

# Cross-check learning hooks (these run in the background and affect timings)
npx monomind@latest hooks metrics

# Token spend — high burn often correlates with perf pain
npx monomind@latest tokens dashboard -p week --no-interactive
```

**Interpretation rules:**

- A single high number is not a bottleneck. A high number *with user-visible pain*
  is. Always tie metrics back to a symptom.
- Compare like-for-like: same window, same load, same machine. A 7d average next to
  a 1h spike is meaningless.
- Latency has tails. Always look at p95/p99, not just mean — means hide outliers.
- Cache hit rate below ~80% usually means the working set is bigger than the cache
  OR the eviction policy is wrong. Both are fixable.

---

### Phase 4: Apply One Fix, Re-measure, Decide

One change. One measurement. Then decide.

```bash
# Apply the single fix you hypothesized from Phase 2/3 evidence

# Re-run the EXACT same baseline commands
npx monomind@latest performance benchmark -s all -i 100 -o json > after-bench.json
npx monomind@latest performance metrics -t 24h -f json > after-metrics.json
npx monomind@latest performance profile -t all -d 60 -o after-profile.json

# Diff before vs after. Did the targeted metric move? Did anything else regress?
```

**Decision rules:**

- Target metric improved, nothing regressed → ship it.
- Target metric improved, something else regressed → weigh tradeoffs explicitly.
  Don't ship on hope.
- Target metric unchanged → the bottleneck was misdiagnosed. Return to Phase 2 with
  new evidence. Do not apply a second fix on top of a failed one.
- 3+ fixes in a row with no movement → this is architectural (see below).

---

## Methodology: Regression Detection

Performance regressions slip in through code changes. Catch them at the diff, not in
production.

```bash
# Before merging any change that touches a hot path:
npx monomind@latest analyze diff --risk -v

# Classify the change so reviewers know what they're looking at
npx monomind@latest analyze diff --classify --reviewers

# Compare the current branch against main explicitly
npx monomind@latest analyze diff main..HEAD --risk --format json
```

**CI integration (GitHub Action):**

```yaml
name: Performance Gate
on: [pull_request]
jobs:
  perf:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Risk-classify the diff
        run: npx monomind@latest analyze diff main..HEAD --risk --format json > diff-risk.json
      - name: Snapshot metrics
        run: npx monomind@latest performance metrics -t 24h -f json > metrics.json
      - uses: actions/upload-artifact@v4
        with:
          name: perf-gate
          path: |
            diff-risk.json
            metrics.json
```

> Don't fail CI on a raw number threshold unless you have a stable baseline. Prefer
> *risk classification* (qualitative) over *latency thresholds* (fragile) for the
> gate, and use metrics for trend analysis offline.

---

## Methodology: Optimization Recommendations

When `performance bottleneck` reports findings, map them to actions in this order:

| Bottleneck type | First-action recommendation |
|---|---|
| network | Check topology (`hierarchical` vs `mesh`); reduce message round-trips |
| memory | Confirm SQLite bridge is up (not the WASM/JSON fallback); widen cache |
| cpu | Profile (`performance profile -t cpu`) to find the hot function |
| io | Batch file reads; lazy-load graphs; check for sync I/O on hot path |
| search | Rebuild monograph; verify BM25 index is current |
| coordination | Lower `maxAgents` if utilization is low; raise it if queue is deep |

**Always:** state the recommendation as a hypothesis, apply it as a single change,
and verify with Phase 4. Recommendations without re-measurement are guesses.

---

## Continuous Monitoring

```bash
# Weekly metrics snapshot for trend analysis
npx monomind@latest performance metrics -t 7d -f json > "perf-$(date +%Y%m%d).json"

# Doctor runs 28 health categories — include it in weekly review
npx monomind@latest doctor

# Hooks metrics show what the background workers are costing you
npx monomind@latest hooks metrics
```

For long-term storage, pipe `performance metrics -f prometheus` into a Prometheus
instance and let Grafana draw the trends.

---

## Red Flags — STOP and Return to Phase 1

| Thought / Action | What it means |
|---|---|
| "This is obviously slow, let me optimize it" | No measured bottleneck. Phase 1 first. |
| "I'll add a cache, that always helps" | Cache without a measured miss rate is bloat. |
| "Let me try a few optimizations together" | Can't isolate what worked. One change. |
| "Benchmark improved so we're done" | Did anything else regress? Check, don't assume. |
| "It feels faster now" | Feeling is not measurement. Re-run baseline. |
| 3+ fixes applied, no movement | Architectural problem. Stop, discuss design. |

## Integration with Other Skills

- **`mastermind-debug`** — Phase 1 root-cause methodology underpins this skill
- **`swarm-orchestration`** — topology decisions driven by bottleneck findings
- **`verification-quality`** — confirm the optimization actually held
- **`mastermind-verify`** — evidence-before-claims for "is it faster?"

## Quick Reference

| Phase | Key command | Success criteria |
|---|---|---|
| 1. Baseline | `performance benchmark` + `metrics` | Numbers on disk |
| 2. Bottleneck | `performance bottleneck -d full` | Named component or code hotspot |
| 2b. Code-level | `analyze diff --risk`, `analyze complexity` | Risky change or hotspot file found |
| 3. Interpret | `performance metrics`, `tokens dashboard` | Metric tied to a symptom |
| 4. Fix + re-measure | same baseline commands | Target moved, nothing regressed |

## See Also

- [Systematic Debugging](../mastermind-debug/SKILL.md)
- [Swarm Orchestration](../swarm-orchestration/SKILL.md)
- [Verification & Quality](../verification-quality/SKILL.md)

---

**Version**: 2.0.0
**Last Updated**: 2026-08-12
