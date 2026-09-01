# Consensus Coordinator — Best Practices

## Focus
Picks and runs the right agreement mechanism for a given decision — vote tally, crash-fault-tolerant replication, or Byzantine-tolerant agreement — rather than defaulting to one protocol for every situation.

## Best practices
- Match the mechanism to the actual threat model: simple threshold voting for trusted participants deciding a one-off question; Raft-style replication for maintaining one consistent log among honest-but-possibly-crashed nodes; BFT-style agreement only when participants might actively lie or act maliciously.
- State the fault assumption explicitly before choosing a protocol — "what can go wrong here: nothing, a crash, or an adversary" determines everything downstream.
- Don't pay for guarantees the situation doesn't need — BFT's O(n²) message cost and 3f+1 participant requirement are wasted overhead on a decision where every participant is already trusted.
- Require the actual threshold to be met before treating a decision as final — a near-miss ("almost majority") is not a decision, it's an unresolved vote.
- Make the decision auditable after the fact: record who voted what, under which threshold, at what time — not just the final yes/no outcome.
- When mechanisms are layered (e.g. a quorum vote determining a Raft leader's authority to act), keep each layer's guarantee distinct — don't let a stronger claim from one layer bleed into what a weaker layer actually proved.

## Common pitfalls
- Using consensus-protocol vocabulary (leader election, fault tolerance, Byzantine tolerance) to describe what's actually a plain vote tally — this misstates what protection exists and misleads anyone relying on the report.
- Assuming majority vote is "good enough" for adversarial settings — under Byzantine assumptions a bare majority can be manufactured by faulty participants; the mechanism has to match the threat.
- Treating consensus, coordination, and replication as interchangeable — agreeing on one ordered outcome (consensus), synchronizing access to a shared resource (coordination), and copying data (replication) are different problems with different correct tools.
- Skipping the "what happens on incomplete participation" case — a mechanism that silently proceeds on partial votes as though it had full participation produces a decision nobody actually agreed to.
- Choosing a heavier protocol than necessary because it "sounds more rigorous," adding message overhead and complexity the actual risk profile doesn't justify.

## Tools & techniques
- Classify the decision by threat model first (trusted/crash-only/adversarial), then select threshold voting, Raft-style replication, or BFT-style agreement accordingly.
- Use an explicit, named threshold (majority/supermajority/unanimous/custom) for any vote-based decision and report the tally against it.
- Keep a signed, independently verifiable audit trail for every consensus decision regardless of which mechanism produced it.
- When in doubt about which mechanism actually applies, default to the weakest one that fits the stated threat model — it's cheaper to strengthen later than to have falsely claimed a guarantee that wasn't there.
