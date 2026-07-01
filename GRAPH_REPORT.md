# Graph Report

_Generated: 2026-07-01T15:26:02.343Z_

## Summary

| Metric | Value |
|--------|-------|
| Total nodes | 27865 |
| Total edges | 37330 |
| Communities | 0 |

## Nodes by Type

| Label | Count |
|-------|-------|
| Function | 13622 |
| Method | 4267 |
| Variable | 3540 |
| Interface | 3485 |
| File | 1579 |
| Class | 661 |
| Process | 334 |
| Document | 176 |
| Tool | 93 |
| Route | 38 |
| Field | 29 |
| Struct | 29 |
| Enum | 9 |
| Entity | 3 |

## Edges by Relation

| Relation | Count |
|----------|-------|
| CONTAINS | 27330 |
| CALLS | 8569 |
| IMPORTS | 388 |
| REFERENCES | 344 |
| ENTRY_POINT_OF | 334 |
| STEP_IN_PROCESS | 334 |
| HAS_FIELD | 29 |
| HANDLES_TOOL | 1 |
| RE_EXPORTS | 1 |

## Top Nodes by Degree

| Rank | Name | Type | Degree |
|------|------|------|--------|
| 1 | `Path` | Interface | 329 |
| 2 | `analyzer.ts` | File | 133 |
| 3 | `index.ts` | File | 111 |
| 4 | `index.ts` | File | 106 |
| 5 | `api-quick-reference` | Document | 106 |
| 6 | `teammate-bridge.ts` | File | 97 |
| 7 | `types.ts` | File | 96 |
| 8 | `types.ts` | File | 95 |
| 9 | `memory-bridge.ts` | File | 91 |
| 10 | `interfaces.ts` | File | 89 |

## Communities

_No communities detected._

## Stale Files

_No stale files detected._

## Confidence Audit

| Confidence | Count | Percentage |
|-----------|-------|------------|
| EXTRACTED | 36597 | 98.0% |
| INFERRED | 733 | 2.0% |

## Suggested Questions

- **bridge_node**: `actions.ts` bridges community 4 and 0
- **bridge_node**: `browser.ts` bridges community 4 and 0
- **bridge_node**: `cdp.ts` bridges community 9 and 0
- **bridge_node**: `index.ts` bridges community 0 and 11
- **bridge_node**: `network.ts` bridges community 3 and 0
- **bridge_node**: `screenshot.ts` bridges community 0 and 4
- **bridge_node**: `session.ts` bridges community 4 and 0
- **bridge_node**: `commands.test.ts` bridges community 4 and 22
- **bridge_node**: `mcp-tools-deep.test.ts` bridges community 4 and 28
- **bridge_node**: `p1-commands.test.ts` bridges community 4 and 22
- **bridge_node**: `headless-worker-executor.test.ts` bridges community 4 and 9
- **bridge_node**: `engine.ts` bridges community 4 and 0
- **bridge_node**: `store.ts` bridges community 4 and 0
- **bridge_node**: `autopilot.ts` bridges community 4 and 47
- **bridge_node**: `benchmark.ts` bridges community 4 and 0
- **bridge_node**: `browse-platform.ts` bridges community 4 and 47
- **bridge_node**: `daemon.ts` bridges community 4 and 47
- **bridge_node**: `deployment.ts` bridges community 4 and 47
- **bridge_node**: `design-detect.ts` bridges community 4 and 47
- **bridge_node**: `design-palette.ts` bridges community 0 and 4

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
