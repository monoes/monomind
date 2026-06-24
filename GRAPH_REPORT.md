# Graph Report

_Generated: 2026-06-24T13:13:34.289Z_

## Summary

| Metric | Value |
|--------|-------|
| Total nodes | 26835 |
| Total edges | 35867 |
| Communities | 0 |

## Nodes by Type

| Label | Count |
|-------|-------|
| Function | 13092 |
| Method | 4192 |
| Variable | 3415 |
| Interface | 3245 |
| File | 1548 |
| Class | 654 |
| Process | 319 |
| Document | 175 |
| Tool | 87 |
| Route | 38 |
| Field | 29 |
| Struct | 29 |
| Enum | 9 |
| Entity | 3 |

## Edges by Relation

| Relation | Count |
|----------|-------|
| CONTAINS | 26224 |
| CALLS | 8242 |
| IMPORTS | 388 |
| REFERENCES | 344 |
| ENTRY_POINT_OF | 319 |
| STEP_IN_PROCESS | 319 |
| HAS_FIELD | 29 |
| HANDLES_TOOL | 1 |
| RE_EXPORTS | 1 |

## Top Nodes by Degree

| Rank | Name | Type | Degree |
|------|------|------|--------|
| 1 | `Path` | Interface | 329 |
| 2 | `analyzer.ts` | File | 133 |
| 3 | `index.ts` | File | 110 |
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
| EXTRACTED | 35134 | 98.0% |
| INFERRED | 733 | 2.0% |

## Suggested Questions

- **bridge_node**: `index.ts` bridges community 2 and 14
- **bridge_node**: `browser-handlers.ts` bridges community 0 and 2
- **bridge_node**: `commands.ts` bridges community 2 and 0
- **bridge_node**: `engine.ts` bridges community 0 and 2
- **bridge_node**: `cli.test.ts` bridges community 2 and 32
- **bridge_node**: `commands.test.ts` bridges community 2 and 31
- **bridge_node**: `mcp-tools-deep.test.ts` bridges community 2 and 38
- **bridge_node**: `p1-commands.test.ts` bridges community 2 and 31
- **bridge_node**: `plugins-transfer-deep.test.ts` bridges community 2 and 31
- **bridge_node**: `browse-builtin-handlers.test.ts` bridges community 2 and 0
- **bridge_node**: `browse-dashboard.test.ts` bridges community 2 and 0
- **bridge_node**: `browse-store.test.ts` bridges community 2 and 0
- **bridge_node**: `server.ts` bridges community 59 and 60
- **bridge_node**: `autopilot.ts` bridges community 2 and 63
- **bridge_node**: `benchmark.ts` bridges community 2 and 0
- **bridge_node**: `browse-platform.ts` bridges community 6 and 2
- **bridge_node**: `daemon.ts` bridges community 2 and 63
- **bridge_node**: `deployment.ts` bridges community 2 and 63
- **bridge_node**: `design-detect.ts` bridges community 2 and 63
- **bridge_node**: `design-palette.ts` bridges community 0 and 2

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
