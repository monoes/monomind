---
name: monograph:monograph-wiki
description: Scan all docs and PDFs and build a searchable knowledge graph — optimized for documentation-heavy projects with Claude LLM semantic extraction
---

# monograph wiki

Scan all docs and PDFs in the project and build a searchable knowledge graph. Optimized for documentation-heavy projects.

## Usage

```bash
npx monomind monograph wiki [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--path` | `-p` | string | cwd | Root path to scan |
| `--llm` | — | boolean | `false` | Enrich with Claude semantic extraction (requires `ANTHROPIC_API_KEY`) |
| `--llm-sections` | — | number | `100` | Max sections for LLM enrichment |
| `--force` | `-f` | boolean | `false` | Force full rebuild |

## Examples

```bash
# Build knowledge graph from all docs and PDFs
npx monomind monograph wiki

# With Claude semantic extraction
npx monomind monograph wiki --llm

# Deep enrichment — process 200 sections with Claude
npx monomind monograph wiki --llm --llm-sections 200

# Specific docs folder
npx monomind monograph wiki -p ./docs

# Force full rebuild
npx monomind monograph wiki --force
```

## What Gets Indexed

Scans for files with extensions: `.md`, `.mdx`, `.txt`, `.rst`, `.pdf`

| Type | Processing |
|---|---|
| `.md` / `.mdx` | Headings → `Section` nodes with hierarchical structure |
| `.txt` / `.rst` | Chunked → `Section` nodes |
| `.pdf` | Text extracted → PDF chunk nodes |

## Difference from `build`

| | `build` | `wiki` |
|---|---|---|
| Code files | Yes | No |
| Documents | Yes | Yes |
| PDFs | Yes | Yes |
| LLM default sections | 50 | 100 |
| Best for | Mixed projects | Doc-heavy / knowledge bases |

## LLM Enrichment

With `--llm`, Claude extracts semantic relationships between sections:
- `DESCRIBES` — section explains a concept
- `CAUSES` — one event leads to another
- `PART_OF` — hierarchical membership
- `CO_OCCURS` — concepts appear together

These `INFERRED` edges make semantic search significantly more accurate.

## After Build

```bash
# Search your wiki
npx monomind monograph search -q "your query"

# View statistics
npx monomind monograph stats

# Auto-rebuild on edits
npx monomind monograph watch
```

## See Also

- `monograph build` — full build including code files
- `monograph search` — search the graph
- `monograph stats` — node/edge breakdown
