# Raft Manager — Best Practices

## Focus
Maintains a single authoritative, replicated log across participants via leader election and log replication — consensus under crash/omission faults, not malicious ones.

## Best practices
- Keep the three subproblems separate in reasoning and implementation: leader election, log replication, and safety. Raft's whole value is that each is tractable in isolation — don't blur them together.
- Use randomized election timeouts so followers don't all become candidates simultaneously; without randomization, split votes recur and elections stall.
- Only mark a log entry committed once it's replicated to a majority of servers — never apply an entry to the state machine before that majority is confirmed.
- Give every client operation an idempotency key (e.g. a sequence number) so re-execution from the log after a leader change or retry can't double-apply it.
- Persist term number and vote state to stable storage before responding to any RPC — a node that forgets its term or vote across a restart can violate safety.
- Never let a leader with a stale term keep acting as leader; step down immediately on discovering a higher term from any peer.

## Common pitfalls
- Conflating consensus, coordination, and replication — consensus is agreeing on a single ordered log; coordination (e.g. distributed locks) is a use case built on top of it; replication just copies data without ordering guarantees on its own. Building one where the problem actually needs another is a common design error.
- Relying on wall-clock time without accounting for clock issues — NTP slews or a backward time jump can break election-timeout assumptions and cause spurious elections or missed heartbeats.
- Treating "leader elected" as "state agreed" — a new leader must still catch followers up to the latest committed entry before the cluster is actually consistent.
- Skipping snapshotting/log compaction on long-running clusters, letting the replicated log grow unbounded and making new-node catch-up impractically slow.
- Applying an Raft-replicated decision as though it also tolerates malicious participants — Raft assumes honest-but-possibly-crashed nodes; it gives no protection against a node that lies.

## Tools & techniques
- Verify committed status by checking replication count against cluster majority explicitly, not by trusting the leader's local view alone.
- Attach a monotonic operation id to every client request so re-application from the log is detectable and skippable.
- Test explicitly for split-brain scenarios (partitioned leader still receiving client writes) — the term/quorum mechanism should make the partitioned leader's writes unable to commit, verify that it actually does.
- Log every term change and leader transition; when debugging a consistency issue, the term/log-index history is almost always where the answer is.
