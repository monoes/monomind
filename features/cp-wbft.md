# CP-WBFT — Confidence-Probe Weighted BFT (arXiv:2511.10400)

**Source:** https://arxiv.org/abs/2511.10400 (AAAI 2026)  
**Category:** Distributed Consensus Research  
**Role in Monobrain:** Confidence-weighted voting in hive-mind consensus, tolerating 85.7% fault rate

---

## What It Is

CP-WBFT (Confidence-Probe Weighted Byzantine Fault Tolerance) is a Byzantine consensus protocol that replaces the standard one-node-one-vote model with confidence-weighted voting. In standard BFT, each node has equal vote weight regardless of how certain it is about the correct value. CP-WBFT introduces a **confidence probe** step before voting: each node estimates its own confidence in its proposed value, and votes are weighted by these confidence scores.

Key result: CP-WBFT tolerates up to 85.7% of nodes being faulty (Byzantine) before consensus fails, compared to the standard BFT ceiling of 33% (1/3 of nodes). This dramatic improvement comes from the confidence weighting: a low-confidence faulty node contributes little to the final tally even if it votes incorrectly, while a high-confidence correct node contributes more.

## What We Extracted

### `weightedTally()` in `consensus/vote-signer.ts`

Monobrain's hive-mind consensus system implements CP-WBFT's confidence-weighted voting in `weightedTally()`:

**Standard BFT (before CP-WBFT):**
```
vote_result = majority(votes)  // 1 agent = 1 vote
```

**CP-WBFT (after):**
```
weighted_result = argmax(Σ confidence_i × vote_i)
```

Each agent in the swarm submits:
1. Its vote (a proposed value or decision)
2. Its confidence score (0.0–1.0) — derived from the agent's task completion rate, task similarity to its specialization, and the clarity of the evidence it examined

`weightedTally()` sums the confidence-weighted votes per candidate value and selects the winner by weighted majority rather than raw count.

**Practical effect**: A `security-auditor` agent with high confidence about a security risk carries more weight in a security-related consensus round than a `coder` agent voting with low confidence. An agent that consistently produces low-quality outputs accumulates a low confidence track record and contributes less to future consensus decisions.

**Fault tolerance improvement**: Because low-confidence agents (which are more likely to be wrong or compromised) have proportionally less influence, the system can tolerate a much higher fraction of unreliable agents before consensus breaks down.

## How It Improved Monobrain

The standard BFT 1/3 fault tolerance limit was problematic for large agent swarms: in a 15-agent swarm, only 4 agents need to be wrong or compromised to break consensus. CP-WBFT's 85.7% tolerance means up to 12 of 15 agents can be wrong before the consensus fails — dramatically more robust for the kind of unreliable, varied-quality LLM outputs that real agent swarms produce.

The confidence scoring mechanism also created a useful feedback loop: agents that consistently make wrong predictions in consensus rounds have their confidence scores reduced, effectively demoting them from high-influence to low-influence participants without removing them from the swarm.

## Key Files Influenced

- `packages/@monobrain/cli/src/consensus/vote-signer.ts` — `weightedTally()` implementation
- `packages/@monobrain/cli/src/commands/hive-mind/` — consensus round management
- Agent confidence tracking — score derived from historical task outcomes
- `hook-handler.cjs` `post-task` — outcome data fed into confidence tracker
