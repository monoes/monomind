# Graphiti / Zep — Bi-Temporal Knowledge Graph (arXiv:2501.13956)

**Source:** https://arxiv.org/abs/2501.13956 | https://github.com/getzep/graphiti  
**Category:** Temporal Knowledge Graph Research  
**Role in Monobrain:** Separating event time from ingestion time in memory entries

---

## What It Is

Graphiti is Zep's knowledge graph framework that introduces **bi-temporal** data modeling to AI memory systems. Standard memory systems record only one timestamp — when the memory was stored. Graphiti separates two distinct time axes:

- **Event time (T)**: When the fact actually occurred in the real world
- **Ingestion time (T')**: When the agent learned about and stored the fact

This separation is critical for correct temporal reasoning. If a user says "last Tuesday I realized the auth bug was caused by a missing null check", the event time is last Tuesday, but the ingestion time is now. A system that only records ingestion time cannot correctly answer "what did you learn about on Tuesday?"

The paper demonstrates 94.8% accuracy on Deep Memory Retrieval benchmarks at 90% lower latency than MemGPT, attributed specifically to the bi-temporal indexing enabling efficient `WHERE event_at BETWEEN ? AND ?` queries without full-table scans.

## What We Extracted

### `MemoryEntry.eventAt` + `event_at` SQLite Column

Monobrain's AgentDB `MemoryEntry` type was extended with an `eventAt` nullable field:

```typescript
interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;    // ingestion time T' — always set
  eventAt?: string;     // event time T — null if unknown
  // ...
}
```

The `SQLiteBackend` adds a corresponding `event_at` column:
```sql
ALTER TABLE memory_entries ADD COLUMN event_at TEXT;
CREATE INDEX idx_event_at ON memory_entries(event_at) WHERE event_at IS NOT NULL;
```

When agents store memories with explicit temporal context ("I fixed the bug on April 12th"), the `eventAt` field is populated with the stated date. When temporal context is absent, `eventAt` remains null and queries fall back to `createdAt`.

**Temporal filtering without index rebuilds**: Because `event_at` is a separate column with its own index (not embedded in the content), filtering by event time is an O(log n) index scan rather than a full-table content search. This is the mechanism behind the 90% latency reduction cited in the paper.

The Memory Palace's `kgQuery(cwd, entity, asOf)` implements the same bi-temporal logic using `valid_from`/`valid_to` fields in `kg.json`.

## How It Improved Monobrain

Before bi-temporal modeling, Monobrain's memory system could only answer "when was this stored?" not "when did this happen?". This caused subtle errors in chronological reasoning: if a user mentioned "the refactor we did last month" six weeks later, the system might retrieve it correctly by content but assign it a timestamp of "6 weeks ago" (ingestion time) rather than "7 weeks ago" (event time), breaking any relative temporal comparisons.

The `eventAt` field fixes this by allowing agents to store the actual event time when known, enabling correct temporal reasoning across sessions.

## Key Files Influenced

- `packages/@monobrain/memory/src/agent-db.ts` — `MemoryEntry.eventAt` field
- `packages/@monobrain/memory/src/sqlite-backend.ts` — `event_at` column and index
- `.claude/helpers/memory-palace.cjs` — `kgQuery(asOf)` bi-temporal triple queries
- Memory search queries — `event_at`-aware temporal filtering
