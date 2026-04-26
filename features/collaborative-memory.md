# Collaborative Memory Promotion (arXiv:2505.18279)

**Source:** https://arxiv.org/abs/2505.18279  
**Category:** Multi-Agent Memory Research  
**Role in Monomind:** Auto-promotion of private memories to team-shared when accessed by multiple agents

---

## What It Is

Collaborative Memory Promotion is a paper describing how memory access patterns in multi-agent systems can be used to automatically determine when a private memory should be promoted to team-level access. The core insight: if multiple distinct agents independently find the same memory useful, it is evidence that the memory contains general knowledge rather than agent-specific knowledge, and should be made available to the whole team.

The proposed rule: promote `access_level` from `private` → `team` when **3+ distinct agents** read the same entry within a **24-hour window**.

## What We Extracted

### Auto-Promotion via `agent_reads` Table

Monomind implements collaborative memory promotion in `SQLiteBackend`:

**Tracking reads**: Every time an agent retrieves a memory entry, a row is written to the `agent_reads` table:
```sql
INSERT INTO agent_reads (entry_id, agent_id, read_at) VALUES (?, ?, ?)
```

**Promotion check**: `checkAndPromoteEntry()` runs after each read. It queries:
```sql
SELECT COUNT(DISTINCT agent_id) as unique_readers
FROM agent_reads
WHERE entry_id = ? AND read_at > datetime('now', '-24 hours')
```

If `unique_readers >= 3`, the entry's `access_level` is updated from `private` to `team`, making it accessible to agents that would not previously have seen it.

**Why this matters**: In a multi-agent swarm working on a complex task, the coder, tester, and reviewer agents might all independently retrieve the same memory about a project's authentication architecture. The promotion system recognizes this as a signal that the memory is genuinely important to the task and promotes it, so future agents (the security auditor, the architect) inherit it without having to discover it themselves.

## How It Improved Monomind

Before collaborative memory promotion, memories were either fully private (only the creating agent could see them) or manually tagged as shared. This meant important cross-cutting knowledge — security patterns, architectural decisions, learned conventions — stayed siloed even when multiple agents would benefit from it.

The auto-promotion mechanism creates an emergent shared knowledge layer: the memories that multiple agents independently find valuable bubble up to team-level, while agent-specific memories (personal style preferences, specific tool configurations) remain private.

## Key Files Influenced

- `packages/@monomind/memory/src/sqlite-backend.ts` — `agent_reads` table and `checkAndPromoteEntry()`
- `packages/@monomind/memory/src/agent-db.ts` — `access_level` field on `MemoryEntry`
- `packages/@monomind/cli/src/swarm/` — agent identity for read attribution
- Background `consolidate` worker — reads promotion check results
