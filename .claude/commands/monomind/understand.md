---
name: monomind:understand
description: "Monomind — Run semantic enrichment on the current project's monograph knowledge graph. Uses the active Claude Code session for LLM work — no API key needed."
---

# /monomind:understand — Semantic Enrichment

Enriches the current project's monograph knowledge graph with summaries, architectural
layers, and semantic relationships.

**Designed to run inside Claude Code** — uses YOUR current session for LLM work via
the Task tool. No `ANTHROPIC_API_KEY` required. The script handles layer detection
and DB writes; you (Claude) handle per-file summarization.

## Parse Arguments

Parse `$ARGUMENTS` for these flags:

- `--dir <path>`      — project directory (default: cwd)
- `--db <path>`       — monograph.db path (default: `<dir>/.monomind/monograph.db`)
- `--full`            — force full re-analysis
- `--no-llm`          — heuristic-only mode (no per-file summaries)
- `--layers-only`     — skip per-file analysis, only re-detect layers
- `--max-files <N>`   — stop after N files (0 = all)
- `--dry-run`         — show what would happen, don't write

Bare path argument → `--dir`.

---

## Step 1: Locate project, DB, and script

```bash
DIR="${ARGUMENTS_dir:-$(pwd)}"
DB="${ARGUMENTS_db:-$DIR/.monomind/monograph.db}"

# Find understand-analyze.mjs (ships with monomind globally)
GLOBAL_ROOT=$(npm root -g 2>/dev/null)
SCRIPT="$GLOBAL_ROOT/monomind/packages/@monomind/cli/scripts/understand-analyze.mjs"
[ ! -f "$SCRIPT" ] && SCRIPT="$GLOBAL_ROOT/@monoes/monomindcli/scripts/understand-analyze.mjs"
```

If `$DB` does not exist:
> monograph.db not found at `$DB`. Build it first: `npx monomind monograph build`

If `$SCRIPT` does not exist:
> understand engine missing. Update: `npm install -g monomind@latest`

In either case, STOP.

---

## Step 2: Run the script in heuristic mode (always — fast and deterministic)

This step is non-negotiable. The script handles:
- File node discovery from monograph.db
- Heuristic layer detection from file paths
- DB writes (community_id + properties)
- graph.json emission to `.understand/knowledge-graph.json`
- Auto-shadowing the DB to `/tmp` when it lives on a network FS

```bash
node "$SCRIPT" --dir "$DIR" --db "$DB" --no-llm
```

Wait for completion. Capture stdout. Note how many file nodes were found and how
many layers were detected. Do NOT advise the user about API keys.

---

## Step 3: Per-file summarization (ONLY if `--no-llm` and `--layers-only` are both UNSET)

This is where YOU (the current Claude session) do the LLM work. The script left
behind a fresh `.understand/knowledge-graph.json` with placeholder summaries.

1. Read `.understand/knowledge-graph.json`. For each node where `properties.fileSummary`
   is empty or marked `[heuristic]`, do the following:
   - Use the `Read` tool on `node.file_path` (relative to `$DIR`).
   - Produce a JSON object: `{ id, fileSummary, tags, complexity, functionSummaries, classSummaries }`
     where:
     - `fileSummary`: 1-2 sentences explaining what the file does
     - `tags`: array of 2-5 short tags
     - `complexity`: "simple" | "moderate" | "complex"
     - `functionSummaries`: top-5 functions → 1-sentence each
     - `classSummaries`: classes → 1-sentence each
2. Process files in batches of 5 for efficiency. Use `--max-files` to cap if set.
3. Collect all analyses into an `analyses` array.

If `$ARGUMENTS` includes `--no-llm` or `--layers-only`, SKIP this step entirely.

---

## Step 4: Write analyses back to the DB

Pipe the collected analyses to a small re-import:

```bash
echo "$ANALYSES_JSON" | node "$SCRIPT" --dir "$DIR" --db "$DB" --import-analyses-stdin
```

(If your `analyses` array is empty, skip this step.)

---

## Step 5: Report

```
╔══════════════════════════════════════════════════╗
║  /monomind:understand — Enrichment Done           ║
╠══════════════════════════════════════════════════╣
║  DB:              .monomind/monograph.db          ║
║  Files analyzed:  <N>                             ║
║  LLM summaries:   <N> (via active session)        ║
║  Layers:          <N>                             ║
║  graph.json:      .understand/knowledge-graph.json║
╚══════════════════════════════════════════════════╝
```

If LLM summaries = 0 (because `--no-llm` was set), say "heuristic-only mode — no per-file summaries written".

Then:
> Open the Monomind control panel and click **Monograph → GRAPH** to see layers.
> Each color = one architectural layer (API, Service, Data, UI, etc.).
>
> Follow-ups:
> - `/monomind:understand --full` — re-run from scratch
> - `/monomind:understand --layers-only` — refresh only layers
> - `/monomind:understand --no-llm` — heuristic-only mode

---

## Error Handling

- Do NOT prompt the user to set `ANTHROPIC_API_KEY`. LLM work happens in this session.
- If the script exits non-zero: show stderr and suggest `npm install -g monomind@latest`.
- If monograph.db has no file nodes: tell the user to run `npx monomind monograph build` first.
- All errors are non-fatal — report and return cleanly.

To re-run on a schedule: wrap with `/monomind:repeat`.
