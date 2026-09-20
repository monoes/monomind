# Making the org cost-effective — a measured deep dive

**Date:** 2026-09-20 · **Subject:** `monomind-dev`, run `run-20260919221725-nb4b`
**Method:** six parallel research agents (two on reference systems, two on literature, one on
production practice, one on our own runtime), with every load-bearing claim re-verified against
primary source before inclusion.

> **This document supersedes the cost addendum in `org-runtime-review-2026-09-20.md`.** That
> addendum's central claim — "81% of messages were broadcast" — is **false**, and its per-token
> figures rest on a counter that under-reports by more than an order of magnitude. Corrections
> are in §1. The per-role *cost* table there was measured from cost and still stands.

---

## 1. What the first analysis got wrong

| Claim, as published | Status | What is actually true |
|---|---|---|
| "2,003 of 2,468 messages (81%) were broadcast to `all`" | **FALSE** | There is no broadcast mechanism. `org_send`'s schema is `to: z.string()` — one recipient, documented in-source as "the only inter-agent channel". `forwarder.ts:249` relabels every assistant *narration* block as `{type:'org:comms', to:'all'}` for the dashboard, and those get appended to the thread log as if they were mail. Real inter-agent traffic: **465 directed messages**. |
| "11.9M tokens" as a denominator | **UNUSABLE** | The counter omits cache traffic and subagents. See §2. |
| "messaging is ~17% of tokens burned" | **WITHDRAWN** | Inter-agent mail is **0.1%** of tool-and-message context mass. |

The error was mine, and it propagated: I briefed all six research agents with the 81% figure as
fact, and three built their headline recommendations on it. Those were withdrawn once the
runtime was read. The lesson is narrow and practical — **a dashboard projection is not a
measurement**, and the thread log conflates an agent talking to itself with an agent sending mail.

---

## 2. The measurement bug — root of everything else

`session.ts:841` and `:879`:

```ts
const turnTokens = (m.input_tokens ?? 0) + (m.output_tokens ?? 0);
```

In the Anthropic API, `cache_read_input_tokens` and `cache_creation_input_tokens` are **siblings
of** `input_tokens`, not subsets of it — `input_tokens` is the *uncached remainder only*. Both
cache fields are billable (~0.1× and ~1.25× input respectively). **Neither is counted.**

In a workload that re-sends a growing prefix every turn, almost all billable input lands in
exactly those two fields. So the counter measures the small, shrinking part of the bill.

A second exclusion compounds it. The Agent SDK's own typings say of the `usage` field monomind
reads: *"MAIN AGENT LOOP ONLY — excludes Task subagent, sidechain, and auxiliary model calls, and
is per-turn in streaming-input sessions. **Prefer `modelUsage` for token/cost accounting.**"* The
run made 46 subagent calls whose usage is invisible.

**Consequences.**
- `run_config.budget_tokens: 160_000_000` never bound — it was metering a fraction of consumption.
- Every per-token figure produced before this was found is wrong.
- The cost-per-*recorded*-token curve rises as the run proceeds (§4), because as the transcript
  grows, more input shifts into the uncounted cache fields while the bill climbs.

**The fix is two lines**, and it is the precondition for everything else:

```ts
const turnTokens = (m.input_tokens ?? 0) + (m.output_tokens ?? 0)
                 + (m.cache_read_input_tokens ?? 0) + (m.cache_creation_input_tokens ?? 0);
```

...plus switching the result-level read from `usage` to `modelUsage`, which is whole-tree and
breaks down by model.

### What the cost figure is worth

`$2,663` comes from the SDK's `total_cost_usd`. monomind has **no local price table** — so it is
not circular with the broken token counter. But the SDK docs are explicit: *"client-side
estimates, not authoritative billing data… computed locally from a price table bundled at build
time… Do not bill end users or trigger financial decisions from these fields."* Treat it as
accurate to within price-table drift, not as an invoice.

**The one measurement that would settle everything** is the Console Usage page for that 3-hour
window, grouped by model and API key. Nobody in this investigation could reach it.

---

## 3. Where the money actually goes

Context mass entering role transcripts, by channel *(agent-measured from `policy.ts`'s
`output_chars`; aggregate independently confirmed at 8.37M chars from the bus)*:

| channel | share |
|---|---|
| **tool results** | **76.4%** |
| inter-agent mail | 15.0% |
| assistant text | 8.6% |

By tool, **Bash (4,387 calls) and Read (420 calls) are 97% of tool mass.** `org_send` — the
channel the original analysis targeted — is **0.1%**.

Tool-result sizes: p50 **451**, p90 3,506, p99 11,739, max 59,805, mean 1,370. **It is a long
tail of small results, not a few monsters**, which matters: a simple per-result size cap would
miss most of the mass.

The runtime already truncates exactly one channel — inbound mail over 4,096 chars spills to
`.mail/<id>.md` with a 1,024-char digest (`cross-org.ts:38-129`). That guard is applied to the
15% and not to the 76%.

---

## 4. Why it compounds: one session, never reset

Each role opens **one** SDK `query()` for its entire life, fed by `mailbox.stream()` as a
streaming-input generator (`session.ts:635`). Verified across the run: **exactly one
`session starting` and zero `session ended` per role**, for ~11 hours. A `maxTurns` restart
*resumes the same transcript*. **Nothing in `orgrt/` truncates, compacts or summarizes.**

So every tool result ever produced is re-sent on every subsequent turn of that role. Cost is
therefore ~quadratic in turns, and the per-turn evidence shows it directly — `dev-lead`'s cost
per *recorded* token:

```
  minutes-in    tokens     cost    $/Mtok
       0.0      22,879    $1.52        67
      32.7      15,391    $1.73       112
     121.0      20,985    $4.70       224
     619.8       7,347   $17.33     2,359   ← first turn after the idle gap
     629.0      34,822   $11.68       335
```

**First third $98/Mtok → last third $430/Mtok (4.4×).** If only deltas were billed, this line
would be flat.

### Residency itself is free — the transcript is not

Verified in the SDK bundle: no `setInterval` anywhere, the input pump is a bare `for await`, and
a parked generator triggers no request. **An idle role costs zero tokens.** The claim that
"eight resident roles pay for residency" is false and is withdrawn.

What residency costs is indirect and larger: it preserves an unbounded transcript, and it lets
the prompt cache lapse across idle gaps.

---

## 5. The wedge and the cost are one failure

Row 619.8 above is the first turn after an **8.3-hour gap** — the run wedged on a `hold` set by a
question whose own author had marked it non-blocking. That turn cost **\$17.33 for 7,347 recorded
tokens: \$2,359/Mtok, 35× the run's opening rate** — a cold-cache re-entry paying full input plus
a cache write on the whole accumulated prefix.

The process bug and the cost bug are the same bug. Fixing the watchdog hold (recommendation 1 of
the process review) is also a cost fix.

---

## 6. What the reference systems do

Both were confirmed real and read from primary source.

**Paperclip** (`github.com/paperclipai/paperclip`) — agents are **never resident**:
> *"Paperclip does not keep an agent process alive between turns. A heartbeat run is finite: it
> starts, performs work, records a terminal result, and exits."*

No `all` channel exists. Writes are subtree-scoped with exactly three canonical report channels;
lateral coordination uses a *courier* pattern (create an issue for the target agent) rather than
sideways comments. A wake is a budgeted unit — *"@-mentions trigger heartbeats… they cost budget"*
— and budget state gates wake eligibility server-side.

**Gas Town** (`github.com/gastownhall/gastown`, Steve Yegge, Go) — splits into three
independently-lived layers what we treat as one object: **Identity** permanent, **Sandbox**
per-assignment, **Session ephemeral per step**.
> *"Session cycling is **normal operation**, not failure."*

Context is *reconstructed* per session by a `gt prime` hook (~300–500 lines injected ephemerally),
not carried. Typed point-to-point mail with per-role message budgets (Dogs: **zero**); two
channels with a stated rule — ephemeral `gt nudge` by default, persisted `gt mail send` only when
the recipient must survive session death. Cost tiers assign **model and reasoning effort** per
role. A GUPP detector alarms at 30 minutes hooked-without-progress — our seven silent hours would
have tripped it.

**Caveat, from the agent that researched it:** Gas Town is widely described as a token burner at
12–30 agents. It is a source of *mechanisms*, not a cost benchmark. No primary-source cost figure
for it exists; an earlier draft of this document quoted a third-party $/hr comparison and it was
withdrawn as unsound.

---

## 7. What the literature says — including against us

**The null hypothesis wins in our domain.** Xia et al., *Agentless* (FSE 2025,
[arXiv:2407.01489](https://arxiv.org/abs/2407.01489)) — *"a simplistic three-phase process of
localization, repair, and patch validation, **without letting the LLM decide future actions or
operate with complex tools**"* — scored **32.00% (96 fixes) at \$0.70/issue**, claiming *"both the
highest performance… and low cost… compared with all existing open-source software agents."*

The transfer caveat cuts against us, not for us: SWE-bench Lite carries a **test oracle**.
Agentless had ground truth and still found the agent layer unnecessary. **Our 223 gate verdicts
are LLM judgments with nothing checking them.**

**Topology.** MacNet ([arXiv:2406.07155](https://arxiv.org/abs/2406.07155)) proves history-replay
context grows O(n²) in agent count while artifact-only passing is O(n). AgentPrune
([arXiv:2410.02506](https://arxiv.org/abs/2410.02506)) reports 28.1–72.8% token reduction and
7.8× cost reduction from pruning redundant communication edges, with accuracy *improving* at
10–30% density reduction. **Neither applies directly to us** — our topology is point-to-point and
messaging is 0.1% of mass. Recorded because they would apply if we ever added broadcast.

**Caching.** Cache read 0.1×, 5-min write 1.25×, 1-hour write 2×
([docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). A cache that never
reads costs **more** than no cache (1.25× vs 1.0×). Mid-conversation `{"role":"system"}` messages
preserve the cached prefix on Opus 5 / Fable 5, 5.1 / Mythos 5, 5.1 / Opus 4.8 — **explicitly not
on Sonnet 5**, which four of our eight roles run. Context editing *"cost more than it saved"* in
Anthropic's own measured run — the item most likely to be applied backwards.

---

## 8. Recommendations, in order

Ranked by (expected saving) ÷ (risk), with verification status.

1. **Fix the meter.** Add the two cache fields to `turnTokens`; read `modelUsage` not `usage`.
   Two lines plus a field switch. **Everything below is unverifiable without it.** `[verified
   in source]`
2. **Bound tool results in the transcript.** 76% of context mass, currently unbounded, while the
   0.1% channel already has a 4,096-char guard. Collapse to one-line extracts at phase
   boundaries. Note the long tail — a per-result cap alone will not do it. `[verified]`
3. **Cycle sessions.** Cost is quadratic in turns against a never-reset transcript. This is Gas
   Town's "session cycling is normal operation" and Paperclip's heartbeats, arrived at
   independently by both. `[verified: one query() per role, zero resets, no compaction]`
4. **Never let a non-blocking question set a watchdog hold.** Process fix *and* the single most
   expensive request of the run. `[verified]`
5. **Meter and cap in dollars.** `maxBudgetUsd` is compared against the running total; the
   runtime has `budgetUsd` plumbing at `agent-exec.ts:78` that the org config does not set. Also
   set subagent depth/concurrency/spend limits. `[verified in docs + source]`
6. **Cost-tier the roster.** Model *and* reasoning effort per role, Gas Town style. Note the
   Sonnet 5 exclusion in §7 constrains any prefix-unification design. `[mechanism verified;
   saving unquantified]`
7. **Cap gate rounds at three, then escalate.** 223 verdicts produced 15 items. `[measured]`

**Not recommended:** per-turn context editing (costs more than it saves); reducing agent count
(does not address any measured driver); topology changes (we have none of the problem they fix).

---

## 9. What remains unmeasured

Stated plainly, because the temptation is to present this as more settled than it is.

- **Actual billed tokens and cost.** Everything here is SDK estimate plus inference. One Console
  lookup would replace the whole of §2.
- **Cache hit rate.** Unknown and unknowable until recommendation 1 ships. The size of every
  caching-related prize depends on it.
- **Whether prefix unification would help.** Diagnosis is sound; magnitude was estimated at
  5.1×, corrected by its own author to 1.1–4× expected case, conditional on a hit rate nobody
  can see.
- **Per-role attribution of context mass.** An earlier draft claimed one role was 59% of the
  bill. That was an artifact of misattributing tool results; measured per-role cost is flat
  (~17% spread). Withdrawn.
- **Whether any of this beats not using an org.** Agentless is the standing null hypothesis and
  nothing here refutes it.

---

## Appendix — method note

Six agents, one brief each, fanned out in parallel. Of the load-bearing claims checked against
primary source: two were confirmed outright, one was overstated ~3× and corrected downward by its
own author when pressed, one was withdrawn entirely, and one I wrongly accused of fabrication —
the file existed; my `find … | head -5` had truncated before reaching it.

Three agents independently flagged that the 81% premise I gave them was unverified, and two
volunteered corrections before I asked. The single most valuable output of the exercise was an
agent contradicting the brief it was given.

Net: parallel research was productive, and **not one report was safe to synthesize unverified.**
