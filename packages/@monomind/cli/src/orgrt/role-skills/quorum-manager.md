# Quorum Manager — Best Practices

## Focus
Runs vote tallies over participating agents' votes and decides whether a proposal has met an explicit threshold — this is vote counting, not distributed consensus with leader election or fault tolerance.

## Best practices
- Establish the participant set before tallying anything — the denominator for any threshold is the current roster; state it explicitly rather than inferring it from however many votes happened to arrive.
- Name the threshold strategy explicitly for every decision: majority (floor(n/2)+1), supermajority (floor(2n/3)+1), unanimous (n), or a caller-supplied custom threshold — don't leave it implicit.
- Treat each vote as a boolean from one identified roster member; don't accept an unweighted "sentiment" in place of an actual cast vote.
- Flag the same voter casting opposite votes across two still-pending proposals of the same type — that's a genuine double-vote signal worth surfacing, even in a single-process tally.
- Write the decision through a tamper-evident audit path (signed record) so it can be independently re-verified later, not just trusted at decision time.
- Report the raw split (e.g. "4 of 6 approved") alongside the required threshold — the number alone without the threshold it was measured against is not a decision record.

## Common pitfalls
- Describing a vote tally as "consensus" or "fault-tolerant" when it's a threshold count in a single process — no leader election, no log replication, no Byzantine tolerance actually happened.
- Extrapolating a decision from partial participation — if votes are missing, report the decision as blocked on incomplete participation rather than assuming the missing votes would have gone a particular way.
- Silently changing the participant roster mid-tally (an agent joins or leaves) without re-stating the new denominator.
- Using "gossip" or "CRDT" language for what's actually a synchronous vote collection with no network-partition tolerance — name the mechanism that exists, not one that sounds more sophisticated.
- Skipping the audit write on low-stakes decisions — a decision without a recorded trail can't be disputed or verified later even if it turns out to matter.

## Tools & techniques
- Check the current roster immediately before tallying, not from a cached count that may be stale.
- Compute the required-votes threshold from the chosen strategy programmatically rather than eyeballing it — off-by-one errors in majority/supermajority math are easy to make by hand.
- Record decisions with an HMAC-signed or similarly tamper-evident record so `verify` can later detect any alteration.
- Keep a duplicate-vote check scoped to same-type pending proposals — broader duplicate detection tends to produce false positives across unrelated decisions.
