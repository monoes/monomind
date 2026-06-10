# Graph Report

_Generated: 2026-06-10T22:14:00.734Z_

## Summary

| Metric | Value |
|--------|-------|
| Total nodes | 23208 |
| Total edges | 31106 |
| Communities | 0 |

## Nodes by Type

| Label | Count |
|-------|-------|
| Function | 10659 |
| Method | 4046 |
| Interface | 3027 |
| Variable | 2853 |
| File | 1355 |
| Class | 634 |
| Process | 309 |
| Document | 132 |
| Tool | 87 |
| Route | 38 |
| Field | 29 |
| Struct | 29 |
| Enum | 7 |
| Entity | 3 |

## Edges by Relation

| Relation | Count |
|----------|-------|
| CONTAINS | 22427 |
| CALLS | 7383 |
| IMPORTS | 329 |
| REFERENCES | 318 |
| ENTRY_POINT_OF | 309 |
| STEP_IN_PROCESS | 309 |
| HAS_FIELD | 29 |
| HANDLES_TOOL | 1 |
| RE_EXPORTS | 1 |

## Top Nodes by Degree

| Rank | Name | Type | Degree |
|------|------|------|--------|
| 1 | `Path` | Interface | 273 |
| 2 | `analyzer.ts` | File | 133 |
| 3 | `index.ts` | File | 108 |
| 4 | `index.ts` | File | 106 |
| 5 | `api-quick-reference` | Document | 106 |
| 6 | `teammate-bridge.ts` | File | 97 |
| 7 | `types.ts` | File | 96 |
| 8 | `types.ts` | File | 95 |
| 9 | `memory-bridge.ts` | File | 89 |
| 10 | `index.ts` | File | 89 |

## Communities

_No communities detected._

## Stale Files

_No stale files detected._

## Confidence Audit

| Confidence | Count | Percentage |
|-----------|-------|------------|
| EXTRACTED | 30458 | 97.9% |
| INFERRED | 648 | 2.1% |

## Suggested Questions

- **bridge_node**: `cli.test.ts` bridges community 4 and 5
- **bridge_node**: `commands.test.ts` bridges community 4 and 3
- **bridge_node**: `p1-commands.test.ts` bridges community 4 and 3
- **bridge_node**: `plugins-transfer-deep.test.ts` bridges community 4 and 3
- **bridge_node**: `headless-worker-executor.test.ts` bridges community 4 and 19
- **bridge_node**: `actions.ts` bridges community 4 and 19
- **bridge_node**: `browser.ts` bridges community 4 and 19
- **bridge_node**: `index.ts` bridges community 19 and 33
- **bridge_node**: `network.ts` bridges community 30 and 19
- **bridge_node**: `session.ts` bridges community 4 and 19
- **bridge_node**: `analyze.ts` bridges community 4 and 37
- **bridge_node**: `autopilot.ts` bridges community 4 and 37
- **bridge_node**: `benchmark.ts` bridges community 4 and 37
- **bridge_node**: `browse.ts` bridges community 4 and 37
- **bridge_node**: `doctor.ts` bridges community 4 and 37
- **bridge_node**: `hooks.ts` bridges community 4 and 37
- **bridge_node**: `index.ts` bridges community 4 and 41
- **bridge_node**: `issues.ts` bridges community 4 and 37
- **bridge_node**: `monograph.ts` bridges community 4 and 37
- **bridge_node**: `route.ts` bridges community 4 and 37

## Knowledge Gaps

### Isolated Nodes (20)

Nodes with no edges — may indicate dead code or missing imports:

- **Variable** `CONSTITUTION_MARKERS`
- **Variable** `current`
- **Variable** `toggle`
- **Variable** `SYMBOL_NODE_LABELS`
- **Variable** `CONFIDENCE_SCORE`
- **Variable** `CREATE_NODES`
- **Variable** `CREATE_EDGES`
- **Variable** `CREATE_COMMUNITIES`
- **Variable** `CREATE_INDEX_META`
- **Variable** `CREATE_NODES_FTS`
