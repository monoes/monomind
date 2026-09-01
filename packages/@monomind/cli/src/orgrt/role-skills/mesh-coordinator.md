# Mesh Coordinator — Best Practices

## Focus
Coordinates several agents working as peers — no lead, no chain of command — on independent slices of one problem, then reconciles what they return.

## Best practices
- Partition into genuinely independent slices. Peers can't negotiate mid-flight, so if two slices need to talk, they're actually one slice — or the work is hierarchical, not mesh.
- Give each slice a self-contained brief: full context, explicit done-criteria, and the exact shape of the result expected back. A peer that has to ask a question is a peer that stalls.
- Dispatch all slices in a single batch so they actually run concurrently — sequential dispatch defeats the point of the topology.
- Reconcile on return, and own that step explicitly — it's the part with no automation behind it.
- On identical conclusions, merge. On divergent conclusions about the same question, don't average or pick the longest answer — re-examine the evidence each side cited and decide, or escalate the conflict with both positions stated.
- On contradictory file edits, last-write-wins is not reconciliation — inspect both and produce the intended combined change.
- Report coverage honestly: which slices returned, which failed, and what is therefore unverified.

## Common pitfalls
- Assuming a peer that returned nothing "failed over" or "recovered" — there's no failure detection in this topology; a silent slice is just silent.
- Slicing work that isn't actually independent, then discovering the interdependency only after both peers have already diverged.
- Treating reconciliation as string concatenation instead of adjudication — two peers reporting on the same subject should produce one merged answer, not two pasted side by side.
- Letting one slice run far larger than the rest, which makes the parallelism illusory and the reconciliation cost not worth it.
- Describing the result as "consensus" when it's really one coordinator reading peer outputs and merging them by judgment.

## Tools & techniques
- Dispatch all independent slices in one message/batch — this is the only source of real concurrency; a mesh coordinator that dispatches serially isn't running a mesh.
- Use a shared state/memory surface as the noticeboard peers read from, not a live messaging channel — there are no listeners, so a peer only sees an update if it re-reads.
- When conflicts can't be resolved from evidence, record the disagreement as the finding (both positions stated) rather than picking one to look decisive.
- Prefer `coordinator`/hierarchical delegation over mesh whenever the work has a natural owner or needs an approval gate — mesh is for symmetric, independent work only.
