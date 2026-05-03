---
name: monomind-understand
description: "Monomind — Run semantic enrichment on the current project's monograph knowledge graph"
---

# /monomind:understand — Semantic Enrichment

Enriches the current project's monograph knowledge graph with LLM-generated summaries,
architectural layers, and semantic relationships.

## Parse Arguments

Parse `$ARGUMENTS` for these optional flags:

- `--dir <path>`    — project directory to analyze (default: current working directory)
- `--db <path>`     — path to monograph.db (default: `<dir>/.monomind/monograph.db`)
- `--import`        — import an existing graph.json only (skip running /understand)
- `--graph <path>`  — explicit path to a UA graph.json file to import
- `--full`          — force full re-analysis even if graph.json is recent
- `--dry-run`       — show what would happen without writing to DB

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

## Step 2: Check for existing UA graph.json

Look for `$DIR/.understand/knowledge-graph.json`, `$DIR/.understand/graph.json`, and `$DIR/.ua/graph.json` (in that order).

If `--graph <path>` was supplied, use that path instead.

**If a graph.json is found AND `--full` was NOT set:**

Report the file age:
```
Found graph.json (X hours old) — importing into monograph…
```

Jump to **Step 4: Import**.

**If no graph.json is found OR `--full` was set:**

Proceed to **Step 3: Run understand analysis**.

---

## Step 3: Run understand analysis

Locate the understand plugin. Check these paths in order:
1. `/Users/morteza/Desktop/tools/knowledgegraph/Understand-Anything/understand-anything-plugin`
2. `$HOME/Desktop/tools/knowledgegraph/Understand-Anything/understand-anything-plugin`
3. `$UA_PLUGIN_DIR` (if set)

If the plugin is NOT found, tell the user:
> understand plugin not found.
> Clone it to a sibling of this project or set `UA_PLUGIN_DIR`:
> ```bash
> git clone https://github.com/nicholasgasior/understand-anything ~/Desktop/tools/knowledgegraph/Understand-Anything
> ```
And STOP.

**If found:**

Use the Agent tool to run the `/understand` skill on `$DIR`.
The skill produces `.understand/graph.json` in the target directory.

Instruct the spawned agent:
- Project directory: `$DIR`
- Run the full `/understand` pipeline (project-scanner → file-analyzer → architecture-analyzer → tour-builder)
- Save the resulting graph.json to `$DIR/.understand/graph.json`
- Report back when done with node/edge/layer counts

Wait for completion before proceeding.

---

## Step 4: Import graph.json into monograph DB

Run the import script:

```bash
node /path/to/monobrain/scripts/ua-import.mjs "$GRAPH_JSON" "$DB"
```

Where:
- `$GRAPH_JSON` is the graph.json path (found in Step 2 or produced in Step 3)
- `$DB` is the monograph.db path

If `--dry-run` was set, instead read graph.json and report what WOULD be written:
- Number of nodes to enrich / insert
- Number of edges to add
- Layers that would become communities
Do NOT write to the DB.

---

## Step 5: Report results

After import completes, show a summary table:

```
╔══════════════════════════════════════════╗
║  /monomind:understand — Enrichment Done  ║
╠══════════════════════════════════════════╣
║  DB:              .monomind/monograph.db ║
║  Nodes enriched:  <N>                    ║
║  Nodes inserted:  <N>                    ║
║  Edges added:     <N>                    ║
║  Communities:     <N> (from UA layers)   ║
╚══════════════════════════════════════════╝
```

Then tell the user:
> The monograph graph is now enriched with semantic summaries and architectural layers.
> Open the Monomind control panel and click **Monograph → GRAPH** to see multi-color layers.
> Each color now represents an architectural layer (API, Service, Data, UI, etc.).

If any nodes were skipped (unresolved edges), report the count but do NOT treat it as an error.

---

## Error Handling

- If `ua-import.mjs` exits non-zero, show stderr and suggest running `pnpm install` from the monobrain root.
- If graph.json is malformed JSON, report the parse error and suggest re-running `/understand`.
- All errors are non-fatal to the main session — report and return cleanly.
