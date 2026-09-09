---
name: monograph:monograph-watch
description: Watch for file changes and incrementally rebuild the knowledge graph — keeps the graph fresh during active development or documentation writing
---

# monograph watch

Watch for file changes and incrementally rebuild the knowledge graph. Keeps the graph fresh during active development.

## Usage

```bash
npx monomind monograph watch [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--path` | `-p` | string | cwd | Root path to watch |
| `--llm` | — | boolean | `false` | Enable LLM enrichment on each rebuild (requires `ANTHROPIC_API_KEY`) |

## Examples

```bash
# Watch and rebuild on any file change
npx monomind monograph watch

# Watch with Claude semantic enrichment on each rebuild
npx monomind monograph watch --llm

# Watch a specific path
npx monomind monograph watch -p ./docs
```

## Behavior

- Runs until `Ctrl+C`
- Detects changes to code files, markdown, text, RST, and PDFs
- Triggers incremental rebuild (only changed files re-processed)
- Outputs progress per phase as changes are detected

## When to Use

- During active documentation writing — graph stays current as you write
- During refactoring — relationships update as imports change
- CI environments — run in background to keep graph fresh for search queries

## MCP Tools

```javascript
// Start watch via MCP
mcp__monomind__monograph_watch({ path: "./" })

// Stop watch via MCP
mcp__monomind__monograph_watch_stop()
```

## See Also

- `monograph build` — one-time full build
- `monograph wiki` — doc-focused build
- `monograph stats` — check current graph state
