---
name: monomind:understand
description: "Monomind — Run semantic enrichment on the current project's monograph knowledge graph. No external plugin needed — the analysis engine ships with monomind."
---

# /monomind:understand — Semantic Enrichment

Enriches the current project's monograph knowledge graph with LLM-generated summaries,
architectural layers, and semantic relationships.

The analysis engine is built into monomind — no external plugin installation required.

## Parse Arguments

Parse `$ARGUMENTS` for these optional flags:

- `--dir <path>`      — project directory to analyze (default: current working directory)
- `--db <path>`       — path to monograph.db (default: `<dir>/.monomind/monograph.db`)
- `--import`          — import an existing graph.json only (skip analysis, run ua-import.mjs)
- `--graph <path>`    — explicit path to a graph.json to import (implies `--import`)
- `--full`            — force full re-analysis even if graph.json is recent
- `--no-llm`          — heuristic-only mode: detect layers from file paths, no API calls
- `--layers-only`     — skip per-file analysis, only (re-)detect architectural layers
- `--incremental`     — re-analyze only files changed since the last run (uses git diff)
- `--onboard`         — generate an ONBOARDING.md guide from the enriched graph
- `--onboard-out <path>` — where to write the onboarding guide (default: `<dir>/ONBOARDING.md`)
- `--batch-size <N>`  — files per LLM batch (default: 5, increase for faster analysis)
- `--max-files <N>`   — stop after N files (0 = all)
- `--dry-run`         — show what would happen without writing to DB

If no flags, treat any bare path argument as `--dir`.

---

## Step 1: Locate project and monograph DB

```bash
DIR="${ARGUMENTS_dir:-$(pwd)}"
DB="${ARGUMENTS_db:-$DIR/.monomind/monograph.db}"
```

1. Resolve `DIR` to an absolute path.
2. Check that `$DB` exists. If not, tell the user:
   > monograph.db not found at `$DB`. Build the graph first:
   > ```bash
   > npx monomind monograph build
   > ```
   > Then re-run `/monomind:understand`.
   And STOP.

---

## Step 2: Locate the built-in analysis engine

The `understand-analyze.mjs` script ships with `@monomind/cli`. Find it:

```bash
# Try npm root (global install / homebrew)
GLOBAL_ROOT=$(npm root -g 2>/dev/null)
SCRIPT="$GLOBAL_ROOT/@monomind/cli/scripts/understand-analyze.mjs"

# If not found globally, try npx resolve
if [ ! -f "$SCRIPT" ]; then
  SCRIPT=$(node -e "try{console.log(require.resolve('@monomind/cli/scripts/understand-analyze.mjs'))}catch{}" 2>/dev/null)
fi

# Fallback: walk up from the running CLI's __dirname
if [ ! -f "$SCRIPT" ]; then
  SCRIPT=$(node -e "
    const {createRequire} = require('module');
    const r = createRequire(require.resolve('monomind'));
    try { console.log(r.resolve('@monomind/cli/scripts/understand-analyze.mjs')); } catch {}
  " 2>/dev/null)
fi
```

If the script is still not found:
> The built-in understand engine (understand-analyze.mjs) was not found.
> Update monomind: `npm install -g monomind@latest`

And STOP.

---

## Step 3: Check for existing graph.json (unless `--full`)

Look for (in order):
- `$DIR/.understand/knowledge-graph.json`
- `$DIR/.understand/graph.json`
- `$DIR/.ua/graph.json`

If `--graph <path>` was supplied, use that path directly.

**If a recent graph.json is found AND `--full` was NOT set:**

Report the file age and jump to **Step 5: Import**:
```
Found graph.json (X hours old) — importing into monograph…
```

**If `--import` or `--graph` was set:**
Jump directly to **Step 5: Import**.

**Otherwise:**
Proceed to **Step 4: Run analysis**.

---

## Step 4: Run built-in analysis

Run the built-in engine. Build the command from parsed flags:

```bash
node "$SCRIPT" \
  --dir "$DIR" \
  --db "$DB" \
  [--no-llm]           # if --no-llm was set
  [--layers-only]      # if --layers-only was set
  [--incremental]      # if --incremental was set
  [--onboard]          # if --onboard was set
  [--onboard-out PATH] # if --onboard-out was set
  [--dry-run]          # if --dry-run was set
  [--batch-size N]     # if --batch-size was set
  [--max-files N]      # if --max-files was set
```

The script will:
1. Read all file nodes from the monograph DB
2. For each file, call the Anthropic API (via `ANTHROPIC_API_KEY`) to get summaries, tags, and complexity
3. Detect architectural layers (LLM-based if API key available, heuristic fallback otherwise)
4. Write enrichment data back to `monograph.db` (community_id + properties JSON)
5. Emit a `graph.json` to `$DIR/.understand/knowledge-graph.json`

If `ANTHROPIC_API_KEY` is not set, the script automatically falls back to `--no-llm` mode — heuristic layer detection from file paths, no per-file summaries. Tell the user this happened.

Wait for the script to complete before proceeding.

---

## Step 5: Import (only when using an existing graph.json)

If jumping here from Step 3 (existing graph.json found):

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
IMPORT_SCRIPT="$REPO_ROOT/scripts/ua-import.mjs"
# fallback: alongside understand-analyze.mjs
[ ! -f "$IMPORT_SCRIPT" ] && IMPORT_SCRIPT="$(dirname $SCRIPT)/../../../scripts/ua-import.mjs"
node "$IMPORT_SCRIPT" "$GRAPH_JSON" "$DB"
```

If `--dry-run` was set, report what would be imported without writing to the DB.

---

## Step 6: Report results

After the analysis or import completes, show a summary:

```
╔══════════════════════════════════════════════════╗
║  /monomind:understand — Enrichment Done           ║
╠══════════════════════════════════════════════════╣
║  DB:              .monomind/monograph.db          ║
║  Nodes enriched:  <N>                             ║
║  Communities:     <N> (layers detected)           ║
║  graph.json:      .understand/knowledge-graph.json║
╚══════════════════════════════════════════════════╝
```

Then tell the user:
> The monograph graph is now enriched with semantic summaries and architectural layers.
> Open the Monomind control panel and click **Monograph → GRAPH** to see multi-color layers.
> Each color represents an architectural layer (API, Service, Data, UI, etc.).
>
> To re-run with full LLM analysis: `/monomind:understand --full`
> To only refresh layer detection: `/monomind:understand --layers-only`
> To run without API calls: `/monomind:understand --no-llm`
> To re-analyze only changed files: `/monomind:understand --incremental`
> To generate an onboarding guide: `/monomind:understand --onboard`

---

## Error Handling

- If `ANTHROPIC_API_KEY` is not set, automatically use heuristic mode — report this clearly but do NOT stop.
- If the script exits non-zero, show stderr and suggest `npm install -g monomind@latest`.
- If monograph.db has no file nodes, tell the user to run `npx monomind monograph build` first.
- All errors are non-fatal to the main session — report and return cleanly.

To repeat this command on a schedule, wrap it with `/monomind:repeat`.
