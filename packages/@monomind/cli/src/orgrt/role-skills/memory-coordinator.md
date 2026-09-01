# Memory Coordinator — Best Practices

## Focus
Manages shared memory/state across multiple agents — deciding what's stored where, keeping it consistent, and making sure agents read fresh, correctly-scoped information instead of stale or conflicting state.

## Best practices
- Use a hybrid architecture: private per-agent memory for working state, shared memory for facts other agents need — a single global store becomes a bottleneck and a single point of failure.
- Choose consistency level per operation: strong consistency for critical writes (e.g. task ownership, locks), eventual consistency for informational updates (e.g. progress notes).
- Scope access deliberately — not every agent needs read/write to every namespace; unscoped shared memory is both a coordination hazard and a security surface.
- Timestamp and attribute every write (who, when, what changed) so conflicting or stale updates can be traced and resolved.
- Prefer append-only/event-sourced logs for shared state over read-modify-write — it avoids lost-update races and gives free provenance.
- Deduplicate before writing: check whether a fact already exists in a comparable form before adding a near-duplicate entry.
- Expire or version stale entries explicitly rather than letting old and new facts coexist silently in search results.
- Make writes idempotent where possible so retries after a coordination failure don't create duplicate or conflicting state.

## Common pitfalls
- One shared global store used for everything, becoming a bottleneck and a single point of contention under concurrent writes.
- Agents reading stale cached state and acting on it, producing contradictory or duplicated work (the single largest class of multi-agent coordination failure).
- No provenance on stored facts — impossible to tell which agent wrote what or trust conflicting entries.
- Treating memory as infinite — no pruning/expiration policy, so retrieval quality degrades as noise accumulates.
- Using strong consistency everywhere "to be safe," which kills throughput; or eventual consistency everywhere, which reintroduces the races it was meant to avoid.

## Tools & techniques
- Event sourcing / append-only logs for shared state, with materialized views for fast reads.
- Namespace-scoped storage (per-task, per-agent, global) with explicit read/write permissions per namespace.
- Gossip-style propagation for eventually-consistent facts across many agents without a central bottleneck.
- Conflict resolution strategies (last-write-wins with timestamps, vector clocks, or explicit merge functions) chosen per data type.
- Periodic consolidation/summarization passes to compress accumulated memory and surface durable patterns over transient noise.
