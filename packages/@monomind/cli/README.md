<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/banner.png" alt="Monomind" width="600" />
</p>

<h1 align="center">Monomind</h1>

<p align="center">
  <strong>An open-source MCP server that extends Claude Code with a codebase knowledge graph, persistent memory, and multi-agent coordination.</strong><br/>
  Apache 2.0 licensed &middot; Your code and memory stay local — see [Trust & Security](#trust--security) for the network calls Monomind does make
</p>

<p align="center">
  <a href="https://monoes.github.io/monomind/"><img src="https://img.shields.io/badge/docs-monoes.github.io%2Fmonomind-00D2AA?style=flat-square" alt="Docs" /></a>
  <a href="https://www.npmjs.com/package/monomind"><img src="https://img.shields.io/npm/v/monomind?color=%2300D2AA&label=monomind&style=flat-square" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/monomind"><img src="https://img.shields.io/npm/dm/monomind?color=%2310B981&style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/monoes/monomind/stargazers"><img src="https://img.shields.io/github/stars/monoes/monomind?color=%23F59E0B&style=flat-square" alt="stars" /></a>
  <a href="https://github.com/monoes/monomind/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-%238B5CF6?style=flat-square" alt="license" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" alt="node" /></a>
</p>

<p align="center">
  <a href="https://monoes.github.io/monomind/#orgs">🏢 Orgs</a> &nbsp;·&nbsp;
  <a href="https://monoes.github.io/monomind/#getting-started">🚀 Quickstart</a> &nbsp;·&nbsp;
  <a href="https://monoes.github.io/monomind/#mastermind">⚡ Mastermind</a> &nbsp;·&nbsp;
  <a href="https://monoes.github.io/monomind/#slash">📋 Commands</a> &nbsp;·&nbsp;
  <a href="https://monoes.github.io/monomind/#architecture">🏗️ Architecture</a>
</p>

---

## What is Monomind?

Monomind is an **open-source CLI and MCP server** that plugs into Claude Code, [OpenCode](https://opencode.ai), Antigravity, Kimi Code, and Codex via the standard [Model Context Protocol](https://modelcontextprotocol.io/). It adds capabilities these assistants don't ship with out of the box:

- **Codebase knowledge graph** — tree-sitter parses your code into a SQLite-backed graph of files, functions, classes, and their relationships. Query imports, callers, and blast radius before making changes.
- **Persistent memory** — a JSON pattern store with episodic recall that survives across sessions. Agents and orgs share context without re-prompting.
- **Multi-agent coordination** — in-session, spawn ad-hoc agent teams via Claude Code's Task tool; for persistent background work, `monomind org run` starts a real SDK-backed daemon with policy-gated role agents and a live dashboard.
- **Reusable slash commands** — 30+ development workflows (build, review, debug, TDD, architecture) available as `/mastermind:*` commands inside Claude Code.

```bash
npm install -g monomind        # Apache 2.0 licensed, runs entirely on your machine
cd your-project && monomind init
claude mcp add monomind -- npx -y monomind@latest mcp start
```

<details>
<summary><strong>Using Antigravity (agy)?</strong></summary>

Nothing extra to do — agy output is part of **default** `monomind init`: `GEMINI.md`, `.gemini/rules/`, and a live status bar wired through `.gemini/settings.json`. The MCP server config is shared with Claude Code (`.mcp.json`). See [Antigravity guide →](doc/concepts/antigravity.md).

</details>

<details>
<summary><strong>Using opencode instead?</strong></summary>

```bash
monomind init --target opencode # initialize only OpenCode
```

`monomind init` initializes all supported coding systems. `--target opencode` initializes only OpenCode; the legacy `--opencode` flag remains an alias. You get the same MCP tools, agent roster, commands, skills, and security gates, plus a `/monomind-status` command. See [OpenCode guide →](doc/concepts/opencode.md).

</details>

<details>
<summary><strong>Using Kimi Code instead?</strong></summary>

```bash
monomind init --target kimicode # initialize only Kimi Code
```

`monomind init` includes Kimi Code by default. `--target kimicode` initializes only Kimi Code; the legacy `--kimicode` flag remains an alias. You get the same MCP tools, agent roster, skills, and commands (as project-level flow skills). Install the generated plugin once for `/monomind:*` slash commands and security gates: `/plugins install ./.kimi-code/plugin`. See [Kimi Code guide →](doc/concepts/kimicode.md).

</details>

<details>
<summary><strong>Using Codex?</strong></summary>

```bash
codex login
monomind init --codex
```

This emits a project-scoped `.codex/config.toml` that registers Monomind's MCP
server, plus `AGENTS.md` with Codex-specific guidance. Codex must trust the
project before it loads project-scoped configuration. To run persistent
Monomind organizations through Codex, set `"runtime": "codex"` in the org
definition.

Use `monomind init` with no target to initialize every supported coding system.
Use `monomind init --target codex` (or `--codex`) to initialize only Codex. See [Codex guide →](doc/concepts/codex.md).

</details>

### Trust & Security

| Concern | Answer |
|---|---|
| **License** | [Apache 2.0](LICENSE) — use it however you want |
| **Data privacy** | Your code and memory store stay local. Monomind does make outbound network calls, all to third-party services — never to a monoes-controlled server: crash reporting (on by default, `monomind crash-reporting disable` to opt out) files a GitHub issue via the GitHub API on a hard crash; `security cve` queries the OSV vulnerability database; `update` checks the npm registry for new versions; the embedding model is downloaded from the HuggingFace CDN on first use. Neural pattern export/import (`hooks intelligence export`/`import`) is local-file-only. |
| **Dependencies** | Standard npm packages (tree-sitter, better-sqlite3, sql.js, zod). tree-sitter and better-sqlite3 are native (prebuilt) Node addons, not pure JS/WASM — sql.js is WASM. No post-install scripts that download code. |
| **Permissions** | Registers as an MCP server — Claude Code controls what tools are available and prompts you before executing anything sensitive. |
| **Source** | Fully open. Read every line at [github.com/monoes/monomind](https://github.com/monoes/monomind). |
| **Maintenance** | Active development, regular releases on npm. |

---

## 🏢 Autonomous Organizations

> **This is the headline feature.** `monomind org run` starts a persistent, SDK-backed daemon that runs an autonomous agent organization — roles, hierarchy, policy-gated tool access, a live dashboard — until you stop it.

### The idea

Every business function needs a team. Define the org once as a JSON file — goal, roles, who reports to whom, per-role tool/file/budget policy — then run it as a real background daemon backed by the Claude Agent SDK. It persists across sessions, streams live into the dashboard Claude Code auto-starts for the project, and can discover and message other Monomind orgs running on the same machine.

```mermaid
flowchart TD
    U(["You"])
    DEF["org.json\nGoal + roles + policy"]
    RUN["monomind org run\nStart SDK daemon"]
    BOSS["Boss Agent\nAgent SDK session"]
    W["Writer"]
    S["SEO Specialist"]
    R["Reviewer"]
    DASH[("Dashboard\n:4242\nauto-started by\nClaude Code hook")]
    XORG[("Other orgs\ncross-process")]

    U --> DEF --> RUN --> BOSS
    BOSS -->|spawns| W
    BOSS -->|spawns| S
    BOSS -->|spawns| R
    RUN -->|forwards events| DASH
    RUN <-.->|--cross-process| XORG

    style BOSS fill:#00D2AA22,stroke:#00D2AA
    style DASH fill:#F59E0B22,stroke:#F59E0B
    style XORG fill:#8B5CF622,stroke:#8B5CF6
```

### Run one

```bash
# .monomind/orgs/<name>.json defines the org: goal, roles, policy.
# See .monomind/orgs/sample-team.json in a fresh `monomind init` for a working example.
# Open the project in Claude Code first — a SessionStart hook auto-launches
# the dashboard at http://localhost:4242 if it isn't already running.

monomind org run content-team --task "Build and publish 3 blog posts per week"

# ✓ Boss agent (Claude Agent SDK session) spawns, reads the org goal,
#   assigns work to role agents, coordinates until the task completes
#   or you stop it. Every event streams into the dashboard above.

monomind org status content-team    # runtime state (detects crashed daemons)
monomind org stop content-team      # request a graceful stop
monomind org list                   # every org + roles, schedule, status
```

### Observe, steer, and let it learn

```bash
monomind org logs content-team --follow      # live event stream in the terminal
monomind org report content-team             # outcome, per-role tokens vs budget, assets
monomind org questions content-team          # what agents asked via ask_human
monomind org answer content-team q-123 "yes" # answer live or queued — no dashboard needed
monomind org create blog --template content-team --goal "3 posts/week"   # scaffold from a template
monomind org validate blog                   # schema + structural checks before running
monomind org run blog --dry-run              # preview each role's exact briefing
```

Orgs are self-improving: the coordinator records every run's outcome (`org_complete`), the next run is briefed on it, and all agents can query accumulated cross-run memory with `org_recall` — a scheduled org gets smarter every cycle instead of starting cold. Crashed agent sessions restart automatically with backoff.

### What runs under the hood

| What | How |
|---|---|
| **OrgDaemon** | Hosts one or more orgs in a single process; real Claude Agent SDK sessions per role, not simulated |
| **PolicyEngine** | Per-role gates on tool access, file read/write scope, web access, token budget — enforced, with a full audit trail |
| **Dashboard** | `org run` forwards every event to the control server on `:4242` (found via `.monomind/control.json`) — that server is auto-launched by a Claude Code SessionStart hook, not by any CLI command; there's no separate per-org dashboard process |
| **Cross-process comms** | `--cross-process` (default on) lets orgs on different `monomind` processes/projects discover and message each other |
| **Scheduling** | `monomind org serve` hosts orgs whose definition has a `schedule` field, running them on interval |

### Org management commands

```bash
monomind org run <name> [--task "..."] [--cross-process]  # start a daemon
monomind org stop <name>            # request a running org to stop
monomind org status [name]          # runtime state for one or all orgs
monomind org list                   # list every org + status
monomind org serve [--cross-process]  # host-only mode, runs scheduled orgs
monomind org delete <name>          # remove an org
monomind org memory <name>          # cross-run KG memory: stats (default) | search <q> | rules | rollback <run-ref>
```

`org` has 31 subcommands total (run, stop, pause, resume, reload, status, serve, supervisor, test-loop, logs, report, memory, costs, flow, questions, answer, approve, deny, gates, gate-approve, gate-reject, replay, resume-from, branch, decisions, create, validate, migrate, list, delete, mark-complete) — `org memory` is the newest addition.

> **Note:** `/mastermind:runorg` now delegates directly to the Org Runtime v2 daemon (the same path as `monomind org run`) — there is no boss agent, no monotask board, and no manual curl calls in this path. The old prompt-orchestrated flow (Task-tool boss agent, monotask board, manual dashboard event posting) is retired to `/mastermind:runorgv1`, reachable only by that explicit legacy name, kept only for orgs not yet migrated off the v1 config shape. New orgs should use `monomind org run` (or `/mastermind:runorg`) against a hand-authored `.monomind/orgs/<name>.json`.

---

## ⚡ The Autonomous Build Loop

For code, `/mastermind:autodev` is the equivalent of Orgs — a loop that researches, builds, and reviews your codebase without stopping.

```mermaid
flowchart LR
    R["Research\nParallel scan:\ngit log, files\nTODOs, graph\nmemory"] --> S
    S["Select\nFeasibility x\nblast-radius x\nfocus"] --> B
    B["Build\nArchitect\nCoder\nTester\nReviewer"] --> V
    V["Review Loop\nCode + Security\n+ Reality\nmax 5 iterations"] --> L
    L["Log + Loop\nStore to memory\n--tillend:\nschedule next"]
    L -->|"more to do"| R

    style R fill:#00D2AA22,stroke:#00D2AA
    style B fill:#8B5CF622,stroke:#8B5CF6
    style V fill:#F59E0B22,stroke:#F59E0B
    style L fill:#10B98122,stroke:#10B981
```

```bash
/mastermind:autodev --tillend              # loop until nothing left
/mastermind:autodev --tillend --focus security   # bias toward security fixes
/mastermind:autodev 3                     # exactly 3 improvements
```

### Universal loop flags

| Flag | Purpose |
|---|---|
| `--tillend` | Repeat until empty round (zero findings, zero actions) |
| `--repeat <N>` | Repeat exactly N times |
| `--focus <area>` | Bias toward: `security` · `dx` · `performance` |
| `--auto` | No confirmation prompts |
| `--maxruns <N>` | Safety cap (default 50) |

---

## 🚀 Quickstart

```bash
# 1. Install
npm install -g monomind

# 2. Initialize in your project
cd your-project
monomind init

# 3. Wire into Claude Code as an MCP server
claude mcp add monomind -- npx -y monomind@latest mcp start

# 4. Health check
monomind doctor --fix
```

> **Semantic routing (opt-in download):** embedding-based task routing needs a local model (~88 MB, `Snowflake/snowflake-arctic-embed-xs` via transformers.js). `monomind init` asks interactively whether to download it — the default is No, and non-interactive/CI installs never download it silently. Declining is fine: routing falls back to keyword mode. Fetch it any time with `monomind download-embeddings` (or `node scripts/download-embedding-model.mjs` on a source checkout).

Open Claude Code. You now have 49 `/mastermind:*` workflows available:

```bash
/mastermind:autodev --tillend     # start autonomous code loop
monomind org run sample-team      # run your first AI org (init writes a runnable sample-team.json — edit it, or run it as-is)
/mastermind:help                  # show all commands
```

---

## 📚 Second Brain — Your Documents, Retrieved by Meaning

Drop documents (Markdown, TXT, PDF, DOCX) anywhere in your project and run `monomind init` — the Second Brain activates itself. No flags, no configuration, no accounts. Everything runs on your machine: a local embedding model (MiniLM via transformers.js) and a local SQLite vector store. **Your notes never leave your computer.**

From then on, every substantive prompt you type in Claude Code is automatically answered *with your own knowledge in context* — a hook retrieves the most relevant excerpts semantically (the always-on dashboard keeps the model warm, ~60ms per lookup) and injects them before Claude starts thinking. Ask "when do new parents get time off" and the parental-leave section of your handbook is already on the table, even though you never used the word "leave".

```bash
monomind doc ingest ./notes        # index documents (init + session-start do this automatically)
monomind doc search -q "pricing psychology in checkout"   # semantic search, by meaning not keywords
monomind doc list                  # what's indexed
monomind doc export                # portable OKF bundle — move your brain between machines
```

**And it follows you across projects.** Ingest a path from *outside* the current project (`monomind doc ingest ~/notes`, or add `--global`) and it lands in your personal global brain at `~/.monomind/global-brain` (override with `MONOMIND_GLOBAL_BRAIN_DIR`) — kept as a sibling of `~/.monomind/projects` specifically so `monomind cleanup --data` can never prune it — searchable from every project on the machine. All retrieval (CLI search, per-prompt injection, the dashboard) merges both stores automatically, with project knowledge winning ties and global hits labeled `[global]`. `doc export --global` moves your whole brain between machines as an OKF bundle — still no cloud, ever.

Retrieval quality is a tested invariant, not a hope: a golden-set eval (paraphrase queries against notes written in different vocabulary) runs in CI with an 80% recall bar.

> **Privacy note:** the embedding model (~90MB) is fetched once from HuggingFace's CDN when your first document is indexed, then cached locally forever. That download is the only outbound request the Second Brain ever makes — your documents and queries never leave your machine. Offline at first index? Search degrades gracefully to keyword matching and `monomind doctor` tells you how to warm up later.

> **Which model where?** Monomind uses three local embedding models, each scoped to one subsystem: `Snowflake/snowflake-arctic-embed-xs` (~88MB) for semantic task routing, MiniLM (~90MB) for Second Brain document retrieval, and `Alibaba-NLP/gte-modernbert-base` (768-dim) for the persistent memory store. See [Embeddings](./doc/commands/memory.md#hybrid-search-architecture--options) for which model each subsystem uses.

---

## 🧠 Memory That Persists

Every session, every agent, every org writes to a persistent memory store that survives across sessions — text plus embedding vectors in local SQLite (better-sqlite3, pure-WASM fallback), embedded by a local model. No cloud vector database, no API keys, no data transmission. The next time you run anything, Monomind already knows what was built, what failed, and which patterns work.

```mermaid
graph TD
    L0["L0 - In-flight\nCurrent session drawers\nephemeral"]
    L1["L1 - Working\nCross-session memory\nBM25 K1=1.5, B=0.75"]
    L2["L2 - Long-term\nEpisodic store\nSemantic recall"]
    L3["L3 - Shared\nCross-agent namespace\nFederated swarm reads"]

    L0 -->|promoted| L1 --> L2 --> L3

    style L0 fill:#00D2AA11,stroke:#00D2AA
    style L1 fill:#F59E0B11,stroke:#F59E0B
    style L2 fill:#8B5CF611,stroke:#8B5CF6
    style L3 fill:#EF444411,stroke:#EF4444
```

```bash
monomind memory store --key "key insight" --value "…" --namespace my-project
monomind memory search "auth implementation"     # semantic (local embeddings) with keyword fallback
```

---

## 🗺️ Monograph — Your Codebase, as a Graph

Before touching any file, Monomind queries **Monograph** — a SQLite-backed knowledge graph of your entire codebase. Nodes are files, classes, and functions. Edges are imports, calls, and dependencies.

```bash
/mastermind:understand          # build the graph
/mastermind:graph-status        # nodes · edges · freshness

# Inside Claude Code, Monograph runs automatically:
# → "what files does auth.ts import?"
# → "what breaks if I change UserService?"
# → "find all callers of validateToken()"
```

19 default MCP tools (+27 advanced via `MONOGRAPH_MCP_ADVANCED=1`). Impact analysis. Community detection. Zero grep.

---

## 🎣 Hooks & Workers

Monomind wires 28 hook subcommands into Claude Code across edit, task, command, and session lifecycle events — logging patterns, routing agents, and feeding the intelligence system.

```mermaid
flowchart LR
    CE["Claude Code\nEvent"] --> H["Hook Router"]
    H --> P["pre-edit\npre-task\npre-command"]
    H --> SS["session-start\nsession-end\nnotify"]
    H --> I["route\nlearn"]
    H --> T["teammate-idle\ntask-completed"]

    I --> DB[("patterns.json\nmemory store")]
    DB -->|next session| CE
```

**9 on-demand workers** run at session start (staleness-gated, refreshed when older than 6 hours): `health` · `ddd` · `security` · `cache` · `progress` · `map` · `audit` · `consolidate` · `reflexion`.

---

## 🛡️ MonoFence AI — Security Layer

Every agent boundary is defended by **monofence-ai** — real-time detection of prompt injection, jailbreaks, homoglyphs, base64 evasion, multi-turn escalation, and PII leakage.

```typescript
import { isSafe, createMonoDefence } from 'monofence-ai';

isSafe('Ignore all previous instructions');  // → false (~0.04ms)

const fence = createMonoDefence({ enableContextTracking: true });
const result = await fence.detect(userInput);
// result.safe · result.threats · result.overallRisk
```

In Claude Code, the live pre-bash/pre-write gate is wired up via its own lazy-loaded integration in `.claude/helpers/handlers/gates-handler.cjs` (`MONOMIND_MONOFENCE_GATE=off` to disable) — not via monofence-ai's `registerSecurityHooks()` API, which is a separate integration point consumed only by `@monoes/hooks`' in-process `HookExecutor`.

---

## 📋 49 Mastermind Commands

Everything runs from inside Claude Code via slash commands. Here's the highlight reel:

### Development
| Command | What it does |
|---|---|
| `/mastermind:autodev` | Autonomous research → build → review loop |
| `/mastermind:build` | Build a feature from a brief |
| `/mastermind:review` | Iterative review until zero findings |
| `/mastermind:debug` | Systematic root-cause debugging |
| `/mastermind:tdd` | Red → Green → Refactor |
| `/mastermind:architect` | Architecture review + file structure |
| `/mastermind:plan` | Comprehensive implementation plan |
| `/mastermind:worktree` | Feature work in isolated git worktree |

### Organizations
| Command | What it does |
|---|---|
| `monomind org run <name>` | Start an org as a real SDK-backed daemon |
| `monomind org status` / `list` | Runtime state for one or all orgs |
| `monomind org stop <name>` | Request a graceful stop |
| `/mastermind:approvev1` | Action pending approval requests |

### Business Domains
| Command | What it does |
|---|---|
| `/mastermind:marketing` | Campaigns, copy, SEO, social |
| `/mastermind:content` | Blog posts, threads, newsletters |
| `/mastermind:sales` | Outreach, proposals, pipeline |
| `/mastermind:finance` | Budgets, invoicing, modeling |
| `/mastermind:ops` | Operations and workflow automation |

**[→ Full reference (49 commands)](https://monoes.github.io/monomind/#slash)**

---

## 📦 Packages

| Package | npm | Purpose |
|---|---|---|
| `monomind` | [![npm](https://img.shields.io/npm/v/monomind?style=flat-square&color=00D2AA)](https://www.npmjs.com/package/monomind) | Umbrella shim — **install this one** |
| `@monoes/monomindcli` | [![npm](https://img.shields.io/npm/v/@monoes/monomindcli?style=flat-square&color=4F46E5)](https://www.npmjs.com/package/@monoes/monomindcli) | CLI engine (32 commands, MCP server) |
| `@monoes/monograph` | [![npm](https://img.shields.io/npm/v/@monoes/monograph?style=flat-square&color=F59E0B)](https://www.npmjs.com/package/@monoes/monograph) | Code knowledge graph (tree-sitter + SQLite) |
| `@monoes/memory` | [![npm](https://img.shields.io/npm/v/@monoes/memory?style=flat-square&color=8B5CF6)](https://www.npmjs.com/package/@monoes/memory) | Persistent memory backends (SQLite + vectors) |
| `@monoes/hooks` | [![npm](https://img.shields.io/npm/v/@monoes/hooks?style=flat-square&color=10B981)](https://www.npmjs.com/package/@monoes/hooks) | Hook registry + 9 on-demand workers |
| `@monoes/mcp` | [![npm](https://img.shields.io/npm/v/@monoes/mcp?style=flat-square&color=3B82F6)](https://www.npmjs.com/package/@monoes/mcp) | MCP server framework (stdio/HTTP/WebSocket) |
| `@monoes/routing` | [![npm](https://img.shields.io/npm/v/@monoes/routing?style=flat-square&color=F97316)](https://www.npmjs.com/package/@monoes/routing) | Semantic task-to-agent routing |
| `@monoes/monobrowse` | [![npm](https://img.shields.io/npm/v/@monoes/monobrowse?style=flat-square&color=06B6D4)](https://www.npmjs.com/package/@monoes/monobrowse) | Browser automation via CDP |
| `@monoes/monodesign` | [![npm](https://img.shields.io/npm/v/@monoes/monodesign?style=flat-square&color=EC4899)](https://www.npmjs.com/package/@monoes/monodesign) | Frontend design intelligence |
| `monofence-ai` | [![npm](https://img.shields.io/npm/v/monofence-ai?style=flat-square&color=EF4444)](https://www.npmjs.com/package/monofence-ai) | AI manipulation defence |

See [CLI Reference](./doc/commands/cli-reference.md) for the full 32-command index.

---

## 🏗️ How It's Built

```mermaid
graph TD
    CC["Claude Code"]
    MCP["MCP Server\nmonomind mcp start"]
    D["Background Workers\n(@monoes/hooks, in-process)"]
    ORG["OrgDaemon\nmonomind org run\nreal SDK sessions"]

    CC <-->|"MCP tools: monograph, memory"| MCP
    MCP <--> D

    D --> ADB[("Memory store\npatterns + episodes")]
    D --> MG[("Monograph\ncode graph")]
    D --> HK["Hooks\n29 subcommands"]

    CC -->|"Task tool - spawns agents"| AG["In-session agents\narchitect, coder\ntester, reviewer\nsecurity, perf"]
    AG <-->|reads and writes| ADB
    ORG -->|"spawns, policy-gated"| RA["Role agents"]
    ORG <-->|reads and writes| ADB

    style CC fill:#00D2AA22,stroke:#00D2AA
    style AG fill:#8B5CF622,stroke:#8B5CF6
    style ADB fill:#F59E0B22,stroke:#F59E0B
    style ORG fill:#F59E0B22,stroke:#F59E0B
```

**Claude Code's Task tool drives in-session multi-agent work; `monomind org run` drives persistent background orgs.** Your code and memory stay local — see [Trust & Security](#trust--security) for the network calls Monomind does make.

---

## Resources

- 📖 [Full Documentation](https://monoes.github.io/monomind/)
- 🖥️ [CLI Command Reference](https://github.com/monoes/monomind/blob/main/doc/commands/cli-reference.md)
- 🏢 [Org Runtime v2 Architecture](https://github.com/monoes/monomind/blob/main/doc/concepts/org-runtime.md)
- 🏢 [Autonomous Orgs](https://monoes.github.io/monomind/#orgs)
- ⚡ [Mastermind Reference](https://monoes.github.io/monomind/#mastermind)
- 📋 [All Slash Commands](https://monoes.github.io/monomind/#slash)
- 🐛 [Issues](https://github.com/monoes/monomind/issues)
- 💬 [Discussions](https://github.com/monoes/monomind/discussions)

---

<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/mascot.png" alt="Monomind" width="72" /><br/>
  <sub>Built with ♥ by <a href="https://github.com/monoes">monoes</a> · Apache 2.0 License</sub>
</p>
