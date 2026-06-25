---
name: monograph:monograph-build
description: Build the knowledge graph from code, docs (md/txt/rst), and PDFs — full index with optional Claude LLM semantic extraction
---

# monograph build

Build the knowledge graph from code, docs (md/txt/rst), and PDFs.

## Usage

```bash
npx monomind monograph build [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--path` | `-p` | string | cwd | Root path to index |
| `--code-only` | — | boolean | `false` | Index only code files, skip documents |
| `--llm` | — | boolean | `false` | Enable Claude semantic extraction (requires `ANTHROPIC_API_KEY`) |
| `--llm-sections` | — | number | `50` | Max sections to enrich with LLM |
| `--force` | `-f` | boolean | `false` | Force full rebuild even if index is fresh |

## Examples

```bash
# Build code + all documents (default)
npx monomind monograph build

# Code only — skip docs and PDFs
npx monomind monograph build --code-only

# With Claude semantic extraction
npx monomind monograph build --llm

# Enrich up to 200 sections with Claude
npx monomind monograph build --llm --llm-sections 200

# Index a specific path
npx monomind monograph build -p ./src

# Force full rebuild
npx monomind monograph build --force
```

## What Gets Indexed

- **Code files** — functions, classes, imports, exports → structured graph nodes
- **Markdown/MDX** — headings become `Section` nodes; links become edges
- **Plain text / RST** — chunked into `Section` nodes
- **PDFs** — text extracted and chunked into nodes

Ignored directories: `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.cache`, `coverage`, `.monomind`, `vendor`, `target`

## LLM Enrichment

When `--llm` is passed and `ANTHROPIC_API_KEY` is set, Claude extracts typed semantic relationships between sections (e.g. `DESCRIBES`, `CAUSES`, `PART_OF`). These become `INFERRED` edges in the graph, enabling richer semantic search.

## Output

After build, the graph is stored at `.monomind/monograph.db`. Run `monograph stats` to see node/edge counts.

## MCP Tool

```javascript
mcp__monomind__monograph_build({
  path: "./",
  codeOnly: false,
  force: false
})
```

## See Also

- `monograph wiki` — doc/PDF-focused build with better output for documentation projects
- `monograph stats` — view what was indexed
- `monograph watch` — auto-rebuild on file changes
