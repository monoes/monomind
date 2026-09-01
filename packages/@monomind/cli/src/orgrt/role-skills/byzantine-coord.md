# Byzantine Coordinator — Best Practices

## Focus
Coordinates agreement among agents when some participants may be faulty, malicious, or reporting contradictory information — not just slow or offline.

## Best practices
- Know the actual fault tolerance bound before promising anything: classic BFT (PBFT-style) needs n ≥ 3f + 1 to tolerate f faulty/malicious participants — fewer than one-third can be adversarial, no more.
- Use a multi-phase agreement protocol (proposal → verify/prepare → commit) rather than accepting a single round of votes as final — a single round can't distinguish an honest disagreement from a malicious one.
- Elect or rotate the proposer/primary unpredictably where possible; a simple, predictable primary-selection rule is itself an attack surface a faulty node can exploit.
- Require a proposal to reach a quorum of matching votes (more than 2/3, not simple majority) before committing — 2/3+ is what survives up to f Byzantine actors among n = 3f+1.
- Treat contradictory statements from the same participant across concurrent proposals as a strong signal of fault, not noise — flag and isolate it rather than silently averaging it in.
- Keep an authenticated, tamper-evident record of votes/messages so a disputed decision can be independently re-verified after the fact, not just trusted in the moment.

## Common pitfalls
- Conflating "Byzantine fault tolerant" with ordinary distributed consensus (Raft/Paxos) — those tolerate crash/omission faults, not adversarial ones; using crash-fault assumptions where actors may lie produces a system with no real fault tolerance.
- Underestimating message complexity — classic BFT protocols are O(n²) in message count, so the approach doesn't scale past a fairly small participant set without a different (e.g. leader-based or threshold-signature) construction.
- Trusting the primary/proposer by default instead of verifying its proposal against what other participants independently observed.
- Treating "majority agrees" as sufficient — under Byzantine assumptions, majority isn't enough; the 2/3+ threshold exists specifically because f faulty nodes can otherwise manufacture a false majority.
- Skipping checkpointing on long-running agreement processes, which makes recovery from a disputed or stalled round expensive or ambiguous.

## Tools & techniques
- Model the participant set size and threshold explicitly before running an agreement round: state n, the assumed f, and confirm n ≥ 3f+1 holds.
- Use message authentication (signed votes/messages) so a faulty participant can't forge another's vote.
- Log every phase transition (proposed, prepared, committed) with signatures so any committed decision is independently auditable later.
- When actual Byzantine-level guarantees aren't needed (all participants are trusted, just unreliable), use a cheaper crash-fault-tolerant protocol instead — don't pay BFT's cost for a threat model you don't have.
