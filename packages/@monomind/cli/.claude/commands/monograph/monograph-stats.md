---
name: monograph:monograph-stats
description: Show knowledge graph statistics — node counts by type, edge type breakdown, and top concepts by importance score
---

# monograph stats

Show knowledge graph statistics — node counts by type, edge type breakdown, and top concepts by importance.

## Usage

```bash
npx monomind monograph stats [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--path` | `-p` | string | cwd | Root path (location of `.monomind/monograph.db`) |
| `--top` | — | number | `10` | Number of top concepts to show |

## Examples

```bash
# Show graph statistics
npx monomind monograph stats

# Show top 20 concepts
npx monomind monograph stats --top 20

# Stats for a different project path
npx monomind monograph stats -p ./other-project
```

## Output

- **Nodes table** — count per node type (`File`, `Section`, `Function`, `Class`, `Concept`) with bar chart
- **Edges table** — count per relation type (`IMPORTS`, `TAGGED_AS`, `CO_OCCURS`, `INFERRED`, etc.)
- **Top N Concepts** — ranked by importance score and section count, shown with star ratings
- **Summary line** — CO_OCCURS edge count and LLM-inferred edge count

## MCP Tool

```javascript
mcp__monomind__monograph_stats()
```

## See Also

- `monograph build` — build or rebuild the graph
- `monograph search` — search across nodes
- `monograph watch` — auto-rebuild on changes
