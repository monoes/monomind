<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/banner.png" alt="Monomind" width="600" />
</p>

<h1 align="center">Monomind</h1>

<p align="center">
  <strong>An open-source MCP server that extends Claude Code with a codebase knowledge graph, persistent memory, and multi-agent coordination.</strong><br/>
  Apache 2.0 licensed &middot; Monomind keeps its own state on your machine; the AI tools it drives send prompts and code to their model providers — see <a href="#trust--security">Trust &amp; Security</a>
</p>

<p align="center">
  <a href="https://monoes.github.io/monomind/"><img src="https://img.shields.io/badge/docs-monoes.github.io%2Fmonomind-00D2AA?style=flat-square" alt="Docs" /></a>
  <a href="https://www.npmjs.com/package/monomind"><img src="https://img.shields.io/npm/v/monomind?color=%2300D2AA&label=monomind&style=flat-square" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/monomind"><img src="https://img.shields.io/npm/dm/monomind?color=%2310B981&style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/monoes/monomind/stargazers"><img src="https://img.shields.io/github/stars/monoes/monomind?color=%23F59E0B&style=flat-square" alt="stars" /></a>
  <a href="https://github.com/monoes/monomind/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-%238B5CF6?style=flat-square" alt="license" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22.22-339933?style=flat-square&logo=node.js&logoColor=white" alt="node >=22.22" /></a>
</p>

<p align="center">
  <a href="https://monoes.github.io/monomind/#orgs">🏢 Orgs</a> &nbsp;·&nbsp;
  <a href="https://monoes.github.io/monomind/#getting-started">🚀 Quickstart</a> &nbsp;·&nbsp;
  <a href="https://monoes.github.io/monomind/#mastermind">⚡ Mastermind</a> &nbsp;·&nbsp;
  <a href="https://monoes.github.io/monomind/#agents">🧩 Agents &amp; Skills</a> &nbsp;·&nbsp;
  <a href="https://monoes.github.io/monomind/#slash">📋 Commands</a> &nbsp;·&nbsp;
  <a href="https://monoes.github.io/monomind/#architecture">🏗️ Architecture</a>
</p>

---


## What is Monomind?

Monomind is an **open-source CLI and MCP server** that plugs into Claude Code, [OpenCode](https://opencode.ai), Antigravity, Kimi Code, and Codex via the standard [Model Context Protocol](https://modelcontextprotocol.io/). It adds capabilities these assistants don't ship with:

- **Codebase knowledge graph** — tree-sitter parses your code into a SQLite-backed graph of files, functions, classes and their relationships; query imports, callers and blast radius before changing anything ([Monograph](doc/concepts/monograph.md)).
- **Persistent memory and Second Brain** — local memory that survives sessions, plus semantic search over your own documents ([Memory](doc/concepts/memory.md)).
- **Autonomous organizations** — `monomind org run` starts an SDK-backed daemon with policy-gated role agents and a live dashboard; roles can run on Claude or other installed coding agents ([Org Runtime](doc/concepts/org-runtime.md), [Agent runtimes](doc/concepts/agent-runtimes.md)). In-session, spawn ad-hoc agent teams with Claude Code's Task tool.
- **Agents, skills and picking** — ships <!-- doc-count:pickable-agents -->83<!-- /doc-count:pickable-agents --> pickable agents, <!-- doc-count:pickable-skills -->82<!-- /doc-count:pickable-skills --> skills and <!-- doc-count:org-skills -->560<!-- /doc-count:org-skills --> Org skills; one index ranks the best fit per task and the prompt hook adds a `[PICK]` line ([Agents & Skills](doc/concepts/agents-and-skills.md), [Routing](doc/concepts/routing.md)).
- **Slash commands** — <!-- doc-count:mastermind-commands -->40<!-- /doc-count:mastermind-commands --> `/mastermind:*` workflows (plan, execute, review, debug, release, research, worktree), loopable with `--tillend` ([Mastermind reference](doc/commands/mastermind-reference.md)).
- **Hooks, browser and security** — [hooks and background workers](doc/concepts/hooks.md), [`monomind browse`](doc/concepts/monobrowse.md) over CDP, and the [MonoFence AI](doc/concepts/security.md) prompt-injection layer.

## Quickstart

1. **Install:** `npm install -g monomind` (Node 22.22 or newer)
2. **Initialize your project:** `cd your-project && monomind init` — sets up the coding systems it finds on your machine and writes `.mcp.json`, pinned to the installed version, so there is no separate `claude mcp add` step.
3. **Check health:** `monomind doctor --fix`
4. **Try one demo:** open Claude Code and run `/mastermind:review --tillend`, or run your first AI org with `monomind org run sample-team` (init writes `sample-team.json`; the first run offers to review and sign it).

`/mastermind:help` lists every command. `init` installs the **core pack** (everyday workflows, 20 core agents, memory, GitHub and browser toolkits); the rest ship as opt-in packs (`orgs`, `org-admin`, `swarm`, `github`, `testing`, `specialists`, `business`, `extras`): `monomind init --packs orgs,github`, `--all-packs`, or `monomind packs add <pack>` later. Platform choices (`--target opencode|kimicode|codex`, `--platforms`, `--all-platforms`), pin options and install notes are in [Getting started](doc/getting-started.md#init-details-and-platform-guides-moved-from-the-readme).

### Tiers

| Tier | What you get | How |
|---|---|---|
| **Core** | Code graph, memory, hooks, core `/mastermind:*` workflows, 20 core agents | `monomind init` |
| **Packs** | Orgs, GitHub, testing, specialists, business domains, extras | `monomind init --packs ...` / `monomind packs add` |
| **Orgs and runtimes** | Persistent policy-gated org daemon and dashboard; roles on other coding agents | `monomind org run`, `monomind agent exec` |

### Platform tiers

| Tier | Platforms | Support |
|---|---|---|
| 1 | Claude Code | Every feature lands here first |
| 2 | Codex, OpenCode, Antigravity, Kimi Code | MCP config, instruction file, and native skills, commands and hooks; tested every release |
| 3 | Copilot, Cursor, VS Code, Aider, Kiro, Trae, OpenClaw, Droid, Hermes, Gemini CLI, Zed, and the Cline, Pi, Kilo, Qwen and Crush writers | Best-effort and **experimental**: an instruction block and the MCP install line |

`monomind platforms doctor` prints each platform's tier; [docs/platforms/compatibility.md](docs/platforms/compatibility.md) has the full matrix.

## Trust & Security

| Concern | Answer |
|---|---|
| **License** | [Apache 2.0](LICENSE) — use it however you want |
| **Data privacy** | Monomind runs locally and stores its state locally: memory, code graph, document index and org state, embedded by a local model. The AI tools it drives (Claude Code, Codex, OpenCode, Kimi Code, Antigravity, and org roles, whose model calls monomind makes itself when a role uses an AI-SDK provider) send your prompts and code to their model providers, including the memory and Second Brain excerpts injected into those prompts. Monomind itself also makes a few outbound calls: the one-time embedding model download, the first-use installs of the Claude SDK and (without an installed browser) Chrome, the npm update check, the Jev decision model if you configure one, and opt-in features; launching it through `npx monomind@latest` adds an npm registry lookup on every start, and opening the dashboard loads its scripts and fonts from public CDNs. See [doc/privacy.md](doc/privacy.md) for the complete list of what's sent, when, and how to opt out of each. |
| **Dependencies** | Standard npm packages. Installing the published `@monoes/monomindcli` 2.29.0 without the embedding runtime (Linux x64, measured with a fresh `npm install`) adds 226 packages and 244 MB of `node_modules`; with it, as before this change, 267 packages and 987 MB, most of it `onnxruntime-node` (548 MB) and `onnxruntime-web` (141 MB). One package runs an install script that downloads a binary: `better-sqlite3` (a prebuilt addon from GitHub). Three heavy pieces are installed on first use instead, once, into `~/.monomind/deps` and never into your project: the local embedding runtime `@huggingface/transformers` with onnxruntime (about 500 MB, on the first memory, Second Brain or embedding command that needs it), the Claude Agent SDK with its Claude binary (about 300 MB, on the first Claude org role or `agent exec --runtime claude`), and Chrome for `monomind browse` (about 400 MB, only when no Chrome, Chromium or Edge is installed). Each is announced by a download notice before it starts. `MONOMIND_NO_AUTO_INSTALL=1` turns that off and prints the install command instead. Native addons: better-sqlite3, and onnxruntime-node once the embedding runtime is installed; tree-sitter (`web-tree-sitter`) and sql.js are WASM. Full breakdown: [doc/privacy.md](doc/privacy.md#install-time-downloads). |
| **Permissions** | Registers as an MCP server — Claude Code controls what tools are available and prompts you before executing anything sensitive. |
| **Source** | Fully open. Read every line at [github.com/monoes/monomind](https://github.com/monoes/monomind). |
| **Maintenance** | Active development, regular releases on npm. |

**Second Brain privacy.** Drop documents anywhere in your project and `monomind init` indexes them. Indexing and search run on your machine: a local embedding model (`Alibaba-NLP/gte-modernbert-base`, 768-dim, via transformers.js) and a local SQLite vector store. **Your notes are indexed and stored locally** — but the excerpts search returns are injected into your AI tool's prompts, and go to its model provider with the rest of the prompt. The embedding model (~90MB) is fetched once from HuggingFace's CDN when your first document is indexed, then cached locally. That download is the only outbound request the Second Brain's indexing and search make — your documents and queries are processed locally. Details: [Memory and Second Brain](doc/concepts/memory.md).

## Names

| Name | Meaning |
|---|---|
| `monomind` | The umbrella npm package and CLI. Install this one. |
| `@monoes/*` | The npm scope the engine packages publish under (`@monoes/monomindcli`, `@monoes/monograph`, `@monoes/memory`, ...). |
| `packages/@monomind/*` | The matching source directories in this repo (for example `packages/@monomind/cli` publishes as `@monoes/monomindcli`). |
| `/mastermind:*` | Slash commands (workflows) inside Claude Code; not CLI commands. |

---

## Packages

| Package | npm | Purpose |
|---|---|---|
| `monomind` | [![npm](https://img.shields.io/npm/v/monomind?style=flat-square&color=00D2AA)](https://www.npmjs.com/package/monomind) | Umbrella shim — **install this one** |
| `@monoes/monomindcli` | [![npm](https://img.shields.io/npm/v/@monoes/monomindcli?style=flat-square&color=4F46E5)](https://www.npmjs.com/package/@monoes/monomindcli) | CLI engine (<!-- doc-count:cli-commands -->39<!-- /doc-count:cli-commands --> commands, MCP server) |
| `@monoes/monograph` | [![npm](https://img.shields.io/npm/v/@monoes/monograph?style=flat-square&color=F59E0B)](https://www.npmjs.com/package/@monoes/monograph) | Code knowledge graph (tree-sitter + SQLite) |
| `@monoes/memory` | [![npm](https://img.shields.io/npm/v/@monoes/memory?style=flat-square&color=8B5CF6)](https://www.npmjs.com/package/@monoes/memory) | Persistent memory backends (SQLite + vectors) |
| `@monoes/hooks` | [![npm](https://img.shields.io/npm/v/@monoes/hooks?style=flat-square&color=10B981)](https://www.npmjs.com/package/@monoes/hooks) | Hook registry + 9 on-demand workers |
| `@monoes/mcp` | [![npm](https://img.shields.io/npm/v/@monoes/mcp?style=flat-square&color=3B82F6)](https://www.npmjs.com/package/@monoes/mcp) | MCP server framework (stdio/HTTP/WebSocket) |
| `@monoes/routing` | [![npm](https://img.shields.io/npm/v/@monoes/routing?style=flat-square&color=F97316)](https://www.npmjs.com/package/@monoes/routing) | Semantic task-to-agent routing |
| `@monoes/monobrowse` | [![npm](https://img.shields.io/npm/v/@monoes/monobrowse?style=flat-square&color=06B6D4)](https://www.npmjs.com/package/@monoes/monobrowse) | Browser automation via CDP (default port 9422) |
| `@monoes/monodesign` | [![npm](https://img.shields.io/npm/v/@monoes/monodesign?style=flat-square&color=EC4899)](https://www.npmjs.com/package/@monoes/monodesign) | Frontend design intelligence |
| `monofence-ai` | [![npm](https://img.shields.io/npm/v/monofence-ai?style=flat-square&color=EF4444)](https://www.npmjs.com/package/monofence-ai) | AI manipulation defence |

See [CLI Reference](./doc/commands/cli-reference.md) for the full <!-- doc-count:cli-commands -->39<!-- /doc-count:cli-commands -->-command index.

## Learn more

- [Getting started](doc/getting-started.md) — install, init, platform guides, architecture
- [Autonomous orgs](doc/concepts/org-runtime.md) and [Agent runtimes](doc/concepts/agent-runtimes.md) ([Agent Exec Protocol](doc/agent-exec-protocol.md))
- [Second Brain and memory](doc/concepts/memory.md) · [Monograph](doc/concepts/monograph.md) · [Hooks](doc/concepts/hooks.md)
- [Browser automation](doc/concepts/monobrowse.md) · [MonoFence AI](doc/concepts/security.md)
- [CLI reference](doc/commands/cli-reference.md) · [Mastermind reference](doc/commands/mastermind-reference.md)
- [Full documentation](https://monoes.github.io/monomind/) · [Issues](https://github.com/monoes/monomind/issues) · [Discussions](https://github.com/monoes/monomind/discussions)

The earlier `monoswarm` and `autopilot` commands were removed in 2.22.0; use the Task tool or `monomind org run` ([migration note](doc/concepts/monoswarm.md)).

---

<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/mascot.png" alt="Monomind" width="72" /><br/>
  <sub>Built with ♥ by <a href="https://github.com/monoes">monoes</a> · Apache 2.0 License</sub>
</p>
