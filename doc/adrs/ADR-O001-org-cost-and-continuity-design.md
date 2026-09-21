# ADR-O001 — Org cost, continuity and specialisation design

**Status:** proposed · **Date:** 2026-09-20
**Evidence:** `doc/reports/org-cost-deep-dive-2026-09-20.md` (measured), `org-runtime-review-2026-09-20.md` (process)
**Applies to:** the Org Runtime v2 (`packages/@monomind/cli/src/orgrt/`) and org configs under `.monomind/orgs/`

---

## Context

One `monomind-dev` run was measured end to end. The findings that drive this ADR:

| measurement | value |
|---|---|
| billed tokens (from local SDK transcripts, 10,271 usage records) | **2,765M** |
| of which `cache_read_input_tokens` | **2,728.5M** (98.7%) |
| `input_tokens` (uncached remainder) | **0.0M** |
| recorded by `policy.usage` | **8.1M** — misses 99.7% |
| tool results as share of context mass | **76%** (Bash + Read = 97% of that) |
| inter-agent mail as share of context mass | **0.1%** |
| gate verdicts → finished items | **223 → 15** |
| controls shipped that could not fail | **5** |
| longest silent stall | **8.3 hours** |

Two structural facts behind them: each role opens **one** SDK `query()` for its whole life with
**no truncation, compaction or summarisation anywhere in `orgrt/`**; and continuity lived in eight
live processes, so a single `hold` flag froze all of them.

---

## Decisions

### D1 — Meter in dollars, whole-tree, cache-aware

`session.ts:841` sums `input_tokens + output_tokens`. `cache_read_input_tokens` and
`cache_creation_input_tokens` are **siblings** of `input_tokens`, not subsets, and both are
billable. Because `input_tokens` is the *uncached remainder*, the better caching works the less
the meter sees — it reported 0.3% of consumption precisely because caching was near-perfect.

- Include both cache fields in `turnTokens`.
- Read result-level usage from `modelUsage`, not `usage` (the SDK documents `usage` as
  "MAIN AGENT LOOP ONLY — excludes Task subagent… Prefer `modelUsage`"). 46 subagent calls were
  invisible.
  > **CAVEAT found during implementation, omitted above and load-bearing:** `modelUsage` is
  > **cumulative across turns** in streaming-input sessions, where `usage` is per-turn. Naively
  > substituting one for the other compounds every result into a runaway overcount. It needs the
  > same per-session-delta treatment `total_cost_usd` already gets (`session.ts:429`). Field
  > names are camelCase (`cacheReadInputTokens`).
- **Enforce budgets in USD** (`budget_usd`, already in the role schema). A token budget of 160M
  never bound against a counter seeing 0.3%.
  > **AMENDED during implementation.** The literal reading — "drop token budgets" — is wrong, and
  > the implementation correctly refused it. `run_config.budget_tokens` **defaults to 1,000,000
  > in the schema**, so every org has one whether it asked or not. Driving that ceiling from an
  > honest (now ~100× larger) meter would close every mailbox within a couple of turns, including
  > orgs resuming from a checkpoint; and simply removing it would leave every org without an
  > explicit `budget_usd` with no ceiling at all. **Metering and enforcement are therefore
  > split:** the meter is always billable and no flag can make it under-report, while
  > `budget_tokens` keeps the basis it was written against, with
  > `run_config.budget_tokens_basis: 'billable'` to opt in. `budget_usd` remains the recommended
  > control.
- Record `sessionIdBefore` / `sessionIdAfter` per run so session reuse is auditable. We currently
  cannot tell whether a resume worked.

### D2 — Bound what enters context; tool results first

Tool output is 76% of context mass and nothing bounds it. The mechanism already exists and is
aimed at the wrong channel: inbound mail over 4,096 chars spills to `.mail/<id>.md` with a
1,024-char digest (`cross-org.ts:38-129`) — applied to the 0.1% channel.

- Spill tool results over a threshold to disk; put a reference plus a short digest in context.
- Note the shape: p50 451 chars, p90 3,506, p99 11,739, max 59,805. It is a **long tail of small
  results**, so a size cap alone recovers little — phase-boundary collapsing matters more.
- Neither reference system solves this (verified negative for Gas Town via exhaustive grep), so
  this part is ours to design.

### D3 — Cycle the process, keep the model session

An idle role costs **zero tokens** (verified: no `setInterval` in the SDK bundle, the input pump
is a bare `for await`). Residency is not the cost. What costs is the unbounded transcript it
preserves, and the cache that dies in idle gaps — the first turn after the 8.3-hour stall cost
**$17.33 for 7,347 recorded tokens, 35× the run's opening rate**.

Both reference systems separate three levels and make only the first ephemeral:

| level | decision |
|---|---|
| OS process | ephemeral — exit between wakes |
| **provider/model session** | **warm, task-keyed, resumed** |
| control-plane state | durable |

Paperclip's reason is in its code as a ticketed cost decision: *"reuse their task session to avoid
paying the full session-start and re-orientation cost on every heartbeat."* Gas Town's warm path
emits ~5 lines where a cold prime emits ~1,200.

**Do not adopt fresh-context-per-step.** On our profile it would convert 0.1× cache reads into
1.0× input plus 1.25× writes. Modelled: cutting 50% of re-sent context while sending 30% of the
remainder cold costs **$1,948 against a $1,050 baseline** — an 86% increase.

### D4 — Continuity is a property of durable state, not of a process

The invariant, already described by the `mastermind-liveness` skill:

> **Every non-terminal item must have a valid action path** — an active run, a queued wake, an
> explicit recorded blocker, or a filed recovery action.

- A supervisor tick scans for violations and re-dispatches. An agent exiting is **normal**.
- **Every hold carries a deadline.** A question that declares itself non-blocking must never be
  able to set one — that is precisely what cost 8.3 hours.
- A no-progress detector (Gas Town alarms at 30 minutes hooked-without-progress).
- **Correction loop:** when an acceptance command fails, the item returns to the queue with the
  failure output attached. That is the "keep going and re-fix direction" path, and being
  queue-driven it survives any agent dying, being killed, or hitting a session limit.
- Bound retries (3) and escalate — to stop infinite retry on the structurally impossible, not to
  stop retrying.

### D5 — Oracles before judges

Every acceptance criterion should be **a command with an exit code**. If one cannot be written,
the criterion is vague — that is not a licence to substitute an LLM opinion.

Steal Gas Town's hard property (`internal/cmd/done.go:498-526`): `done` **fatally errors** unless
the item carries a fresh evidence comment that is authored by the assignee, posted after work
started, machine-parseable, and **pinned to the current `HEAD` sha**. Against 223 verdicts that
nothing could check, this is the highest-value single import.

### D6 — Reviewer sessions are cold and artifact-only

A reviewer that watched the work absorbs the doer's framing. Our run produced 223 verdicts and
still shipped **five controls that could not fail**; in three cases the verifier failed a SHA the
reviewer had approved, and the verifier was right each time.

- **Doer:** warm session, task-keyed, resumes across wakes.
- **Reviewer:** **cold — a new session per verdict.** Pay the cache miss; reviewers are a small
  share of turns and this is the one place fresh context is worth real money.
- Give the reviewer the diff, the acceptance commands and their output, and the issue text.
  **Not** the doer's reasoning, the thread, prior rounds, or the attempt count.

### D7 — Specialisation via a small catalog of stable loadouts

`buildRolePrompt` is called once per session (`session.ts:636`), so role text is a **stable
prefix**: one cache write, then 0.1× forever. Specialisation is cheap; *variety* is expensive,
because each distinct system prompt is its own cache namespace.

- **Layer 1 — loadout** (system prompt, cached): a named bundle of role + skills. The boss
  *selects*, never composes. Target **5–15 loadouts**, not 96.
- **Layer 2 — task guidance** (message, not cached): which diff, which criteria, what failed last
  time. All per-task dynamism lives here, where appending never invalidates a cache.
- **The loadout is a function of the task, recorded on the task row.** Re-dispatch must reuse it,
  or a retry is a re-roll and the "three failures then escalate" rule means nothing.
- Never edit the system prompt mid-session. If work needs a different skill set, that is a
  different task and a different session.
- Keep tool lists uniform where practical — tools render at prefix position 0, so any
  add/remove/reorder invalidates everything.

Test: two sessions doing the same *kind* of work should produce a **byte-identical system
prompt**.

### D8 — Tier models, and tier reasoning effort with them

Modelled on the measured volume: all-Haiku **$349** vs as-run blended **$1,050** vs all-Opus
**$1,744**. Tiering is a ~3× win, low risk, and independent of everything else.

Gas Town tiers both together (`internal/config/cost_tier.go`), noting *"patrol roles drop effort
since they do simpler, more repetitive work."*

**As implemented** (`packages/@monomind/cli/src/orgrt/cost-tier.ts`, wired at the single model
choke point `session.ts`'s `resolveModel` call site). An org grows an optional `cost_tiers` block:

```jsonc
{
  "cost_tiers": {
    "default": "economy",                              // tier for every role
    "roles": {
      "patrol":    { "tier": "economy", "effort": "low" },  // Gas Town's "patrol drops effort"
      "reviewer":  "standard",
      "architect": "exempt"                            // never tiered — see below
    },
    "tiers": {                                          // extends the built-in catalog
      "economy": { "codex": { "model": "gpt-5.6-mini", "effort": "medium" } }
    },
    "providers": {                                      // how a provider expresses effort
      "codex": { "effort_env": { "medium": { "SOME_VAR": "medium" } } }
    }
  }
}
```

Four properties this design commits to:

- **Provider-agnostic.** A tier is a table keyed by *provider key* — a Vercel vendor slug when
  the role has one, else the role's runtime id. A provider nobody has heard of is declared in
  config, not in code. The built-in catalog ships **Claude only** (`standard` → opus/high,
  `economy` → sonnet/medium, `budget` → haiku/low): those are the model ids and the effort
  mechanism this repo can actually verify, and inventing the rest would be the silent downgrade
  this decision exists to prevent.
- **Effort is part of the tier**, as an abstract level (`off | low | medium | high | xhigh |
  max`). Claude maps it natively to the Agent SDK's `effort` option (`off` →
  `thinking: {type:'disabled'}`). Any other provider maps it through config-declared env vars,
  or by naming an effort-encoding model id per tier (`gemini-3.6-flash-high`). A provider with
  no mechanism ignores it. *Known gap:* the vendor CLI runners take only `--model`, so codex's
  `-c model_reasoning_effort=…` and its peers are reachable today only via the model id.
- **Precedence:** explicit `adapter_config.model` > tier > named-provider default > runtime
  default. The tier's *effort* applies even when the model was pinned — which model to run and
  how hard to think are separate axes.
- **Defaulted off, and loud when wrong.** No `cost_tiers` = today's behaviour exactly (asserted
  by a test, not a comment). A tier with no entry for a role's provider fails `org validate` and
  `org run` at start rather than picking a cheaper model at runtime.

**`"exempt"` is the deliberative escape hatch** required by the table below: a role whose value
is the quality of its disagreement opts out of tiering entirely and is controlled by budget (D1)
instead.

**Decompose selectively, not by default.** Splitting a task out only pays when its context is
genuinely small and separate. If a subtask needs the parent's large warm context, splitting
re-pays for it at 12.5× (cache write vs cache read). Break-even requires cutting 28–83% of volume
depending on how much goes cold. **Decompose along context boundaries, not work boundaries.**

---

## What this does NOT apply to — deliberation and debate

The decisions above are tuned for **execution** work: a task with a definable done-state, a
correction loop, and an artifact to check. Deliberative work — debates, design arguments,
multi-perspective review, red-teaming — has a different shape, and applying these rules bluntly
would damage it. Explicitly:

| decision | execution work | deliberative work |
|---|---|---|
| **D5 oracles before judges** | required — every AC is a command | **does not apply.** The absence of an oracle is the *point*. Be explicit that the output is opinion, and do not manufacture a fake exit code to satisfy a gate. |
| **D4 cap 3 retries** | applies to fix→check→fix loops | **does not apply to deliberation rounds.** A retry is "the same attempt again after a failure"; a debate round is "a new position given what was said". Cap revisions, not turns of argument. |
| **D6 cold, artifact-only reviewer** | applies to verdicts on artifacts | **partially inverts.** Independent *positions* should be fresh, to avoid anchoring — but the **synthesiser must see every position in full**, and that is legitimately a large context. Budget for it. |
| **D7 few loadouts** | 5–15, reused heavily | **a debate wants distinct perspectives**, which may mean several loadouts used once each. Accept the cache cost; it is the product, not waste. |
| **D8 tier down** | mechanical roles → cheap models | **do not tier a debate participant into a weak voice.** Tier by *difficulty of the judgement*, not by role label. A cheap model in a debate produces cheap arguments and the synthesiser cannot tell. |
| **D3 warm sessions** | keep warm, task-keyed | applies equally — a deliberation thread is exactly the case where a warm cached prefix pays. |
| **D2 bound tool output** | applies | applies — orthogonal to deliberation. |
| **D1 meter in dollars** | applies | applies, and matters more: deliberation has no oracle to tell you when to stop, so the budget *is* the stopping rule. |

**Rule of thumb:** if the work has a checkable done-state, optimise it. If the work's value is the
disagreement itself, protect the disagreement and control cost with the budget instead.

A practical consequence: an org config should be able to declare a role or a phase as
`deliberative`, and the runtime should not apply the retry cap or the artifact-only reviewer
restriction to it. That flag does not exist yet; until it does, keep deliberative work in a
separate org with its own budget rather than bolting it onto an execution org.

---

## Consequences

**Cheaper, on the measured profile:** D1 makes spend visible, D8 is ~3× on its own, D2 shrinks the
dominant 76% term, D3 protects the 98.7% that is already cached.

**More reliable:** D4 removes the class of failure that cost 8.3 hours, D5 and D6 attack the class
that shipped five unfailable controls.

**Costs accepted:** cold reviewer sessions pay a cache miss each (deliberate, D6). Fewer loadouts
means less bespoke specialisation (deliberate, D7). Evidence gating makes `done` stricter and will
initially fail work that would previously have closed (that is the point, D5).

**Not decided here:** roster size. Residency is free, so 8 roles cost nothing to have. Whether 8
roles *should* be producing verdicts about each other's work is a separate question, and the
honest answer from the literature is that a no-agent pipeline (Agentless, FSE 2025) took both the
best performance and the lowest cost on the only public benchmark in this domain. That remains
the standing null hypothesis for any org.
