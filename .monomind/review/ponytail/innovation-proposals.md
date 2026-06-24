# Innovation Proposals: monolean

**Analyst role:** Idea Generator
**Date:** 2026-06-24

These proposals go beyond what ponytail implements. Each leverages a monomind-exclusive capability.

---

## Proposal 1: ReasoningBank Rung Memory

**What ponytail does:** Ladder is stateless — same 7 rungs, same order, every session.

**Proposed extension:** After each session where monolean is active, the SubagentStop hook records which rungs fired and what the outcome was (accepted by user, reverted, caused a bug). The `optimize` worker aggregates these into a per-project rung-affinity profile stored in ReasoningBank. Next session, `monolean-activate.cjs` queries ReasoningBank and prepends a "For this project, rung 2 (codebase reuse) fires frequently — check X, Y, Z modules first" note to the injected instructions.

**Token impact:** Reduces ladder traversal time; first response gets the right rung faster without back-and-forth.

**Implementation hook:** SubagentStop → `monolean-learn.cjs` writes rung+outcome to memory. SessionStart → `monolean-activate.cjs` queries memory before emitting instructions.

---

## Proposal 2: Token Delta Correlation

**What ponytail does:** ponytail-gain shows benchmark medians but cannot measure your own project.

**Proposed extension:** The capture-handler.cjs already snapshots JSONL token data. Add a `monolean-mode` field to the snapshot. The `tokens today` CLI command gains a `--lean` flag that splits sessions by whether monolean was active and shows cost delta. Over time this produces a real per-project savings number, not a benchmark estimate.

**Output:** `monomind hooks token-delta` command prints:
```
Sessions with monolean: 14  avg cost: $0.021
Sessions without:        9  avg cost: $0.038
delta: -45%
```

**Implementation hook:** capture-handler.cjs reads `.monomind/state/monolean-mode` and appends `"leanMode": "full"` to snapshot JSON. `tokens.ts` new subcommand `lean-delta` groups and diffs.

---

## Proposal 3: Monograph Rung-5 Assist

**What ponytail does:** Rung 5 says "already-installed dependency solves it?" — but the AI must recall what's installed.

**Proposed extension:** When monolean mode is active and a UserPromptSubmit fires for a task involving external libraries, `monolean-tracker.cjs` calls `monograph_query` with the task description, extracts matched IMPORT edges to installed packages, and prepends a "Installed deps matching this task: lodash (util/merge), date-fns (format)" hint to the submitted prompt.

**Why this matters:** Most AI over-installs because it doesn't check what's already there. This makes rung 5 concrete and automated rather than aspirational.

**Implementation:** UserPromptSubmit hook calls monograph MCP tool, filters to IMPORT edges with external package targets, injects hint if any found.

---

## Proposal 4: monolean-debt Worker

**What ponytail does:** ponytail-debt skill harvests `ponytail:` markers on demand (manual invocation).

**Proposed extension:** A new `monolean-debt` subcommand of the `worker` system runs as a background worker that:
1. Grep harvests `// monolean:` comments project-wide
2. Parses ceiling and upgrade trigger from each
3. Persists to `.monomind/metrics/monolean-debt.json`
4. StatuslineGenerator reads this file and appends `[LEAN:3]` when 3+ unresolved markers exist

This turns the debt ledger from a one-shot report into a live metric visible in the statusline without any user action.

---

## Proposal 5: monolean-review Inline Hook

**What ponytail does:** ponytail-review is a separate skill invoked manually on diffs.

**Proposed extension:** In `ultra` mode, the post-edit hook runs a lightweight version of the review pass automatically on every file edit. Instead of the full review skill, it runs a single-pass prompt: "In one line each: find delete/stdlib/yagni/shrink opportunities in this diff." The result is appended as a collapsible block in the post-edit hook output.

This makes ultra mode truly automatic — every edit gets a complexity check without user invocation.

**Constraint:** Only in `ultra` mode. full and lite modes skip to avoid noise.

---

## Proposal 6: AGENTS.md Auto-Injection via init

**What ponytail does:** AGENTS.md is a static file users manually copy to their repo.

**Proposed extension:** `monomind init` gains a `--lean` flag. When passed, it copies a `AGENTS.md` fragment (the mono* rebranded ladder condensed to 15 lines) to the project root. The fragment is versioned and can be updated via `monomind hooks monolean-mode update-agents`.

This integrates the "always-on agent injection" path into the existing init workflow rather than requiring users to manually manage a file.
