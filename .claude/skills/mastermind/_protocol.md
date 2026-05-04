---
name: mastermind-protocol
description: Shared protocol for all mastermind domain skills — brain-load, brain-write, output schema, memory scoring, and task briefing standard. Never invoked directly; referenced by domain skills and master.
type: shared
---

# Mastermind Protocol

This file is a reference loaded by mastermind domain skills and master. It is NEVER invoked directly via the Skill tool.

---

## Brain Load Procedure

Execute at the START of every mastermind run (master or standalone domain command). Load in this order:

**Step A — Tier 3 core principles (all domains):**
Call `mcp__monomind__agentdb_hierarchical-recall` with:
- namespace: `mastermind:principles`
- limit: 20

**Step B — Tier 2 weekly summary for this domain:**
Call `mcp__monomind__agentdb_context-synthesize` with:
- namespace: `mastermind:<domain>:weekly`
- query: [current prompt keywords]

**Step C — Relevant graph nodes:**
Call `mcp__monomind__monograph_query` with:
- query: [3-5 keywords extracted from current prompt]

Combine all results into a **BRAIN CONTEXT** block. Insert this block before any planning, decomposition, or agent spawning step. Format:

```
=== BRAIN CONTEXT ===
[Tier 3 principles]
[Tier 2 domain summary]
[Relevant graph nodes]
=====================
```

If any MCP call fails or returns empty, continue without that tier — do not abort the run.

---

## Brain Write Procedure

Execute at the END of every mastermind run. Always runs even if execution was partial or blocked.

**Step 1 — Score this run:**
```
score = confidence × (1 / (days_since_run + 1)) × log(uses + 1)
```
- `confidence`: average of all decision confidence values from the unified output schema
- `days_since_run`: 0 (this is a fresh run)
- `uses`: 1 (first write)

**Step 2 — Append to Tier 1 raw log:**
Call `mcp__monomind__agentdb_hierarchical-store` with:
- namespace: `mastermind:<domain>:raw`
- content: [full unified output schema YAML from this run, as a string]
- metadata: `{ score, project, run_id, date: ISO8601, domain }`

**Step 3 — Check weekly compaction trigger:**
Call `mcp__monomind__agentdb_health` on namespace `mastermind:<domain>:raw`.
If `entry_count >= 20` OR `days_since_last_compaction >= 7`:
1. Retrieve all Tier 1 entries since last compaction
2. Produce a per-domain weekly summary (use LLM synthesis: "Summarize the key decisions, patterns, and lessons from these run logs in under 300 words")
3. Store summary: `mcp__monomind__agentdb_hierarchical-store` namespace `mastermind:<domain>:weekly`
4. Archive (do not delete) Tier 1 entries with score < 0.1 by updating their metadata: `{ archived: true }`

**Step 4 — Check graph consolidation trigger:**
Call `mcp__monomind__monograph_community` for nodes matching `mastermind:<domain>`.
If 3+ similar memory nodes are detected in a cluster:
1. Merge into a single principle via LLM: "Distill these memories into one clear principle in 1-2 sentences"
2. Store principle: `mcp__monomind__agentdb_hierarchical-store` namespace `mastermind:principles`
3. Add `EXCEPTION` edge in Monograph for any conflicting memory: `mcp__monomind__monograph_add_fact`

---

## Unified Output Schema

Every domain skill MUST return exactly this YAML to its caller. No extra fields. No missing fields.

```yaml
domain: <build|marketing|review|research|content|release|sales|ops|finance|idea>
status: complete | partial | blocked
artifacts:
  - path: /absolute/path/to/file
    type: code | copy | report | config
decisions:
  - what: "description of the decision"
    why: "reasoning behind it"
    confidence: 0.0-1.0
    outcome: shipped | pending | reverted
lessons:
  - what_worked: "description"
  - what_didnt: "description"
next_actions:
  - "suggested follow-up command"
board_url: "monotask://<project>/<domain>"
run_id: "<ISO8601-timestamp>"
```

Empty fields use `[]`. The `status` field reflects the highest-level result: `complete` = all tasks done, `partial` = some tasks done, `blocked` = could not proceed (include reason in `lessons.what_didnt`).

---

## Memory Scoring Formula

```
score = confidence × (1 / (days_since_run + 1)) × log(uses + 1)
```

| Variable | Source |
|---|---|
| `confidence` | Average of `decisions[].confidence` from output schema |
| `days_since_run` | 0 on day of run, increases 1 per calendar day |
| `uses` | Incremented each time this memory is returned by brain load |
| Archive threshold | score < 0.1 |
| Reinforcement | Increment `uses` on every brain load hit |

---

## Monotask Task Briefing Standard

Every task created via `/monomind:createtask` MUST include ALL fields below. Agents read task descriptions cold — no back-channel context exists.

```
CONTEXT: [ISO date] | Project: [name] | Created by: [domain] Manager

BRAIN MEMORY:
[Paste the most relevant 3-5 excerpts from the loaded BRAIN CONTEXT block]

GOAL: [One measurable objective — what success looks like]

SCOPE:
- Files/dirs in scope: [explicit paths]
- Files/dirs out of scope: [explicit exclusions if relevant]

CONSTRAINTS:
- [Must-not-break items]
- [Existing APIs to preserve]
- [Timeline if applicable]

SUCCESS CRITERIA:
- [ ] [Concrete checkable item 1]
- [ ] [Concrete checkable item 2]

AGENT: [agent slug, e.g. backend-dev | sparc-coder | frontend-dev]
SWARM: [topology agent-count consensus, e.g. "hierarchical 4 raft"]
REPORTS TO: [board name, e.g. PaymentSaaS/development]

DEPENDENCIES: [task IDs, or "none"]
OUTPUT FORMAT: Unified output schema (see mastermind _protocol.md)
```
