# Getting Started with Monomind

> **5-minute guide** — install, connect, and run your first command.

## What is monomind?

Monomind extends AI coding assistants (Claude Code, Antigravity, OpenCode, Kimi Code, and Codex) with four local-first capabilities:

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

This initializes every supported coding system: Claude Code, Antigravity, OpenCode, Kimi Code, and Codex. It writes each platform's native instructions/configuration, shared skills, and MCP wiring, then builds the initial code graph. It takes 30–60 seconds and spawns a background process for the graph build.

Init also sets up the memory database (`.swarm/memory.db`, the same one `monomind memory init` creates, copied to `.claude/memory.db`), so `monomind doctor` reports **Memory Database ✓** straight away. Re-running init keeps an existing database and everything in it. Pass `--no-memory` to skip it; `--only-claude` skips it too, since that mode writes no runtime state, and `--skip-claude` creates the database without the `.claude/` copy. If the database can't be created (for example, `sql.js` is missing), init still finishes and prints a warning: run `monomind memory init` to retry.

To initialize only one system, use `--target`:

```bash
monomind init --target codex
monomind init --target opencode
monomind init --target kimicode
monomind init --target antigravity
monomind init --target claude
```

The legacy `--codex`, `--opencode`, and `--kimicode` flags remain aliases for their corresponding single targets.

**Optional — power-user setup:**

```bash
monomind init wizard
```

The wizard asks about topology, memory backend, embeddings model, etc. Most users should stick with the defaults from plain `monomind init`.

## Step 3: Register the MCP server

```bash
claude mcp add monomind -- npx -y monomind@latest mcp start
```

This tells Claude Code how to reach monomind's MCP tools. The generated Codex, OpenCode, Kimi Code, and Antigravity configurations register the same local server using each platform's native format.

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
| `/mastermind:review` | Review the work and auto-fix findings; add `--tillend` to loop until a round comes back clean |

### Agents and skills

`monomind init` installs <!-- doc-count:pickable-agents -->84<!-- /doc-count:pickable-agents --> pickable agents under `.claude/agents`, skills under `.claude/skills` and slash commands under `.claude/commands`. You rarely name one yourself: for each prompt, the hook adds a line such as

```
[PICK] agent: Security Engineer · skill: /mastermind:review
```

to Claude's context when one agent or skill clearly fits, and Claude uses it. To see the ranking for any task, run `monomind pick -t "<task>"`. Your own agents and skills are Markdown files in the same folders; [Agents & Skills](concepts/agents-and-skills.md) shows where each kind goes and what to put in its frontmatter.

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

**Embedding model download** — the first `monomind doc ingest` fetches a ~90 MB model from HuggingFace. If offline, search degrades gracefully to keyword matching. It is not the only outbound request monomind makes — see [doc/privacy.md](privacy.md) for the full list (update checks, `doctor`, crash reporting, etc.) and how to opt out of each.

**Cost of `org run`** — running an org daemon spends real provider tokens. Always use `--dry-run` first to preview, and `--budget-usd` to set a hard limit:

```bash
monomind org run my-team --dry-run          # preview without spending
monomind org run my-team --budget-usd 5     # hard-stop at $5
```

## Next steps

- `doc/concepts/agents-and-skills.md` — where agents, skills and Org skills live, and how to add your own
- `doc/concepts/routing.md` — how the agent and skill picker works
- `doc/concepts/monograph.md` — how the code graph works
- `doc/concepts/memory.md` — memory tiers and search
- `doc/concepts/org-runtime.md` — multi-agent daemon
- `doc/concepts/monoswarm.md` — multi-agent coordination, topologies, and voting
