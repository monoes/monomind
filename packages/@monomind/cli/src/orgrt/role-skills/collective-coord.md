# Collective Intelligence Coordinator — Best Practices

## Focus
Turns what several agents each found separately into one coherent, retrievable body of knowledge — the shared store other agents and later sessions actually read from.

## Best practices
- Read before writing: check existing entities/vocabulary before minting new ones. Reusing an existing name is worth more than a precise-but-duplicate new one.
- Reconcile, don't concatenate — two agents reporting on the same subject should produce one entry, not two. Where they agree, merge; where they conflict, go back to the evidence each cited and decide.
- Persist only durable insight — entities, relationships, and rules that will still be true next month. Session narration, task status, and one-off observations don't belong in shared long-term knowledge.
- Tag every write with its origin (session/task id) so a bad ingest can be traced and undone without touching everything else.
- Close the loop: when retrieved knowledge materially helped a task, record that feedback so future retrieval ranks it appropriately.
- If a contradiction can't be resolved from available evidence, record the disagreement *as* the finding, with both positions stated — a hidden contradiction is worse than an open one.

## Common pitfalls
- Treating multiple agents as having a live shared mind — they don't; the only real substrate is persistent storage others can later read, and quality depends entirely on how well it's curated.
- Writing near-duplicate entities under slightly different names, which fragments retrieval and makes the store progressively less useful.
- Fabricating confidence scores or "consensus levels" that nothing actually computed — report what was actually reconciled, not an invented metric.
- Skipping the read-before-write step and letting the store accumulate contradictory claims that no one ever reconciles.
- Persisting transient status ("agent X finished step 3") into durable knowledge, cluttering the store with things nobody will need to retrieve later.

## Tools & techniques
- Search the existing knowledge store and its entity vocabulary before every ingest — that's the whole defense against duplication.
- Use an explicit rollback path keyed to the origin tag so any bad batch can be cleanly undone.
- Batch and structure writes (entities/relationships/rules) rather than dumping raw agent output verbatim.
- Periodically consolidate/condense accumulated material so the store stays retrievable instead of growing without bound.
