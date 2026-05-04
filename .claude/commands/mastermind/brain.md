---
name: mastermind-brain
description: Mastermind brain management — inspect, compact, refresh, and control the three-tier business memory (AgentDB + Monograph)
---

Parse `$ARGUMENTS` to determine the sub-command and flags.

## Sub-Commands

### `status` (default if no sub-command given)

Show the current state of all brain tiers across all domains.

For each domain that has data, call:
- `mcp__monomind__agentdb_health` on namespace `mastermind:<domain>:raw` → Tier 1 entry count, last write date, archived count
- `mcp__monomind__agentdb_health` on namespace `mastermind:<domain>:weekly` → Tier 2 summary count, last compaction date
- `mcp__monomind__agentdb_health` on namespace `mastermind:principles` → Tier 3 principle count

Display as a table:

```
MASTERMIND BRAIN STATUS
════════════════════════════════════════════════
Domain     │ Tier 1 (raw) │ Tier 2 (weekly) │ Tier 3 (principles)
───────────┼──────────────┼─────────────────┼────────────────────
build      │ 14 entries   │ 2 summaries     │ shared (see below)
marketing  │ 8 entries    │ 1 summary       │
...        │              │                 │
───────────┼──────────────┼─────────────────┼────────────────────
PRINCIPLES │              │                 │ 7 core principles
════════════════════════════════════════════════
Last compaction: 2026-04-28 | Next due: 2026-05-05
Avg memory score: 0.64 | Entries below archive threshold: 3
```

---

### `compact`

Force immediate weekly distillation across all domains (or `--domain <name>` for one domain).

For each domain (or the specified domain):
1. Retrieve all Tier 1 raw entries since last compaction via `mcp__monomind__agentdb_hierarchical-recall` (namespace `mastermind:<domain>:raw`)
2. Produce per-domain weekly summary: synthesize decisions, patterns, and lessons into ≤300 words
3. Store to Tier 2 via `mcp__monomind__agentdb_hierarchical-store` (namespace `mastermind:<domain>:weekly`)
4. Archive Tier 1 entries with score < 0.1 (update metadata: `{ archived: true }`)
5. Report: "Compacted <domain>: <N> entries → <M> summary, <K> archived"

---

### `refresh --domain <name>`

Re-cluster the knowledge graph for a specific domain and rebuild Tier 3 principles from it.

1. Call `mcp__monomind__monograph_community` for nodes matching `mastermind:<domain>`
2. For any cluster of 3+ similar nodes: merge into a single principle (LLM synthesis)
3. Store merged principle: `mcp__monomind__agentdb_hierarchical-store` namespace `mastermind:principles`
4. For conflicting nodes: add `EXCEPTION` edge via `mcp__monomind__monograph_add_fact`
5. Report: "Refreshed <domain>: <N> clusters found, <M> principles updated, <K> exceptions noted"

---

### `inspect --tier <1|2|3> [--domain <name>] [--limit <N>]`

Show raw contents of a specific brain tier.

- Tier 1: Call `mcp__monomind__agentdb_hierarchical-recall` on `mastermind:<domain>:raw`, display each entry with its score and date.
- Tier 2: Call `mcp__monomind__agentdb_hierarchical-recall` on `mastermind:<domain>:weekly`, display summaries with dates.
- Tier 3: Call `mcp__monomind__agentdb_hierarchical-recall` on `mastermind:principles`, display all principles.

Default limit: 10. Use `--limit N` to override.

---

### `forget --query "<text>"`

Find and archive all brain entries semantically matching the query.

1. Call `mcp__monomind__agentdb_pattern-search` with query text across all mastermind namespaces
2. Display matching entries with their scores and domains
3. Ask: "Archive these N entries? (yes/no)"
4. If yes: update each entry's metadata to `{ archived: true }`
5. Report: "Archived N entries matching '<query>'"

---

### `reset --domain <name> --confirm`

**Destructive.** Wipes all brain data for a specific domain. Requires `--confirm` flag explicitly — refuse if missing.

If `--confirm` is present:
1. Delete all Tier 1 entries: `mcp__monomind__memory_delete` on namespace `mastermind:<domain>:raw`
2. Delete all Tier 2 entries: `mcp__monomind__memory_delete` on namespace `mastermind:<domain>:weekly`
3. Remove domain nodes from Monograph graph
4. Report: "Reset complete for domain <name>. All memory wiped."

If `--confirm` is missing:
> "This will permanently delete all brain memory for domain '<name>'. To confirm, run: `/mastermind:brain reset --domain <name> --confirm`"
