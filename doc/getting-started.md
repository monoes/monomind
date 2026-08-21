# Getting Started with Monomind

> **5-minute guide** — install, connect, and run your first command.

## What is monomind?

Monomind extends AI coding assistants (Claude Code, Antigravity, opencode, Kimi Code) with four local-first capabilities:

1. **Monograph** — a code knowledge graph (14 tree-sitter grammars + 5 regex-fallback languages — see `packages/@monomind/monograph/README.md` for the authoritative count — plus SQLite + BM25)
2. **Memory** — persistent memory across sessions (SQLite + local embeddings + keyword fallback)
3. **Second Brain** — document RAG (PDF/Office/EPUB ingestion, semantic search, eval-gated)
4. **Org Runtime** — multi-agent daemon with dashboard, governance, and budgets

Everything runs locally. No cloud LLM or embeddings required.

## Step 1: Install

```bash
npm install -g monomind
```

Verify:

```bash
monomind --version
```

## Step 2: Initialize your project

```bash
cd your-project
monomind init
```

This writes `.claude/` configs (skills, hooks, agents) and builds the initial code graph. It takes 30–60 seconds and spawns a background process for the graph build.

**Optional — power-user setup:**

```bash
monomind init wizard
```

The wizard asks about topology, memory backend, embeddings model, etc. Most users should stick with the defaults from plain `monomind init`.

## Step 3: Register the MCP server

```bash
claude mcp add monomind -- npx -y monomind@latest mcp start
```

This tells Claude Code how to reach monomind's 66+ tools.

## Step 4: Verify the install

```bash
monomind mcp verify
```

You should see:

```
✓ Tool registry: 66+ tools registered
✓ Sample tool (system_info): resolves
✓ claude mcp registration: monomind appears in `claude mcp list`
```

If any check fails, the output tells you exactly what to fix.

## Step 5: Use it in Claude Code

Open Claude Code in your project. Type:

```
/mastermind:help
```

This lists all available slash commands. The most useful starting points:

| Command | What it does |
|---|---|
| `/mastermind:understand` | Analyze your project with an LLM and enrich the knowledge graph |
| `/mastermind:debug` | Systematic root-cause debugging protocol |
| `/mastermind:plan` | Write a comprehensive implementation plan before touching code |
| `/mastermind:verify` | Enforce evidence-before-claims before committing |

## What's running?

| Component | How to check | How to stop |
|---|---|---|
| Code graph (Monograph) | `monomind monograph status` | Automatic (background build) |
| Memory | `monomind memory list` | Always on (SQLite) |
| MCP server | `monomind mcp status` | `monomind mcp stop` |
| Dashboard | Open Claude Code (auto-starts) | Close Claude Code |
| Org daemon | `monomind org status` | `monomind org stop <name>` |

## Troubleshooting

**`monomind doctor` warns on fresh install** — expected. The doctor checks 28 categories; on a fresh project, several report "not configured yet." Run `monomind doctor --fix` to auto-resolve what's fixable, or `monomind doctor --verbose` for details.

**Embedding model download** — the first `monomind doc ingest` fetches a ~90 MB model from HuggingFace. This is the only outbound request monomind ever makes. If offline, search degrades gracefully to keyword matching.

**Cost of `org run`** — running an org daemon spends real provider tokens. Always use `--dry-run` first to preview, and `--budget-usd` to set a hard limit:

```bash
monomind org run my-team --dry-run          # preview without spending
monomind org run my-team --budget-usd 5     # hard-stop at $5
```

## Next steps

- `doc/concepts/monograph.md` — how the code graph works
- `doc/concepts/memory.md` — memory tiers and search
- `doc/concepts/org-runtime.md` — multi-agent daemon
- `doc/concepts/monoswarm.md` — multi-agent coordination, topologies, and voting
