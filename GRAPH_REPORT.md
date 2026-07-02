# Graph Report

_Generated: 2026-07-02T21:35:57.812Z_

## Summary

| Metric | Value |
|--------|-------|
| Total nodes | 19912 |
| Total edges | 26462 |
| Communities | 0 |

## Nodes by Type

| Label | Count |
|-------|-------|
| Function | 10090 |
| Variable | 2575 |
| Method | 2530 |
| Interface | 2426 |
| File | 1293 |
| Class | 446 |
| Process | 300 |
| Document | 107 |
| Tool | 65 |
| Route | 38 |
| Field | 29 |
| Struct | 6 |
| Enum | 4 |
| Entity | 3 |

## Edges by Relation

| Relation | Count |
|----------|-------|
| CONTAINS | 18963 |
| CALLS | 5993 |
| IMPORTS | 620 |
| ENTRY_POINT_OF | 300 |
| STEP_IN_PROCESS | 300 |
| REFERENCES | 255 |
| HAS_FIELD | 29 |
| HANDLES_TOOL | 1 |
| RE_EXPORTS | 1 |

## Top Nodes by Degree

| Rank | Name | Type | Degree |
|------|------|------|--------|
| 1 | `path` | Variable | 321 |
| 2 | `fs` | Variable | 243 |
| 3 | `analyzer.ts` | File | 133 |
| 4 | `index.ts` | File | 107 |
| 5 | `api-quick-reference` | Document | 102 |
| 6 | `types.ts` | File | 96 |
| 7 | `intelligence.ts` | File | 81 |
| 8 | `memory-bridge.ts` | File | 69 |
| 9 | `claim-service.ts` | File | 68 |
| 10 | `claudemd-generator.ts` | File | 65 |

## Communities

_No communities detected._

## Stale Files

_No stale files detected._

## Confidence Audit

| Confidence | Count | Percentage |
|-----------|-------|------------|
| EXTRACTED | 25586 | 96.7% |
| INFERRED | 876 | 3.3% |

## Suggested Questions

- **bridge_node**: `analyzer.ts` bridges community 2 and 0
- **bridge_node**: `actions.ts` bridges community 2 and 0
- **bridge_node**: `browser.ts` bridges community 2 and 0
- **bridge_node**: `cdp.ts` bridges community 9 and 0
- **bridge_node**: `index.ts` bridges community 0 and 11
- **bridge_node**: `network.ts` bridges community 4 and 0
- **bridge_node**: `screenshot.ts` bridges community 0 and 2
- **bridge_node**: `session.ts` bridges community 2 and 0
- **bridge_node**: `cli.test.ts` bridges community 2 and 23
- **bridge_node**: `commands.test.ts` bridges community 2 and 22
- **bridge_node**: `init-e2e.test.ts` bridges community 9 and 27
- **bridge_node**: `mcp-tools-deep.test.ts` bridges community 2 and 31
- **bridge_node**: `p1-commands.test.ts` bridges community 2 and 22
- **bridge_node**: `headless-worker-executor.test.ts` bridges community 2 and 9
- **bridge_node**: `browse-analyzer.test.ts` bridges community 2 and 9
- **bridge_node**: `server.ts` bridges community 9 and 50
- **bridge_node**: `engine.ts` bridges community 2 and 0
- **bridge_node**: `store.ts` bridges community 2 and 0
- **bridge_node**: `benchmark.ts` bridges community 2 and 0
- **bridge_node**: `design-palette.ts` bridges community 0 and 2

## Knowledge Gaps

### Isolated Nodes (20)

Nodes with no edges — may indicate dead code or missing imports:

- **Variable** `fence`
- **Variable** `result`
- **Variable** `CONSTITUTION_MARKERS`
- **Variable** `AGENT_TYPES`
- **Variable** `backend`
- **Variable** `current`
- **Variable** `fs`
- **Variable** `TEMPLATE_RE`
- **Variable** `cache`
- **Variable** `DB_PATH`
