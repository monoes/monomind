<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/banner.png" alt="Monomind" width="600" />
</p>

<h1 align="center">Monomind</h1>

<p align="center">
  <strong>Hire an AI team. Set a goal. Walk away.</strong><br/>
  Autonomous Claude Code orchestration with persistent memory, self-coordinating agent orgs, and a codebase knowledge graph.
</p>

<p align="center">
  <a href="https://monoes.github.io/monomind/"><img src="https://img.shields.io/badge/docs-monoes.github.io%2Fmonomind-00D2AA?style=flat-square" alt="Docs" /></a>
  <a href="https://www.npmjs.com/package/monomind"><img src="https://img.shields.io/npm/v/monomind?color=%2300D2AA&label=monomind&style=flat-square" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/monomind"><img src="https://img.shields.io/npm/dm/monomind?color=%2310B981&style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/monoes/monomind/stargazers"><img src="https://img.shields.io/github/stars/monoes/monomind?color=%23F59E0B&style=flat-square" alt="stars" /></a>
  <a href="https://github.com/monoes/monomind/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-%238B5CF6?style=flat-square" alt="license" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" alt="node" /></a>
</p>

<p align="center">
  <a href="https://monoes.github.io/monomind/#orgs">Orgs</a> &nbsp;&middot;&nbsp;
  <a href="https://monoes.github.io/monomind/#getting-started">Quickstart</a> &nbsp;&middot;&nbsp;
  <a href="https://monoes.github.io/monomind/#mastermind">Mastermind</a> &nbsp;&middot;&nbsp;
  <a href="https://monoes.github.io/monomind/#slash">Commands</a> &nbsp;&middot;&nbsp;
  <a href="https://monoes.github.io/monomind/#architecture">Architecture</a>
</p>

---

> **This is `@monoes/monomindcli`** — the CLI engine. Most users should install the umbrella package [`monomind`](https://www.npmjs.com/package/monomind) instead.

## What is Monomind?

Claude Code is already powerful. Monomind makes it **run itself**.

Install once, wire it into Claude Code as an MCP server, then tell it what outcome you want — it assembles a team, coordinates the work, and delivers.

```bash
# Assemble an AI content team and let it run
/mastermind:createorg content-team "publish 3 SEO-optimized posts per week"
/mastermind:runorg --org content-team

# Or run the autonomous code improvement loop
/mastermind:autodev --tillend --focus security
```

## Install

```bash
npm install -g monomind

cd your-project
monomind init

# Wire into Claude Code
claude mcp add monomind npx monomind mcp start

# Start background workers + health check
monomind daemon start
monomind doctor --fix
```

## Key features

**Autonomous orgs** — Design an AI team (boss, writer, reviewer, marketer), start it as a daemon, and walk away. It checkpoints, recovers from crashes, and loops until you stop it.

**Autodev loop** — Autonomous research-build-review cycle. Scans your codebase, picks the highest-value improvement, builds it, reviews it, and loops.

**Monograph** — SQLite-backed knowledge graph of your codebase. Files, functions, imports, and call edges. Impact analysis, shortest-path queries, community detection — no grep needed.

**Persistent memory** — LanceDB with HNSW vector search. Every session, agent, and org writes to it. Next run already knows what worked.

**60+ agents** — Coder, reviewer, tester, architect, security auditor, performance engineer, and many more. Routed automatically by task type.

**80+ slash commands** — Development (`/mastermind:build`, `/mastermind:debug`, `/mastermind:tdd`), orgs, marketing, sales, finance, ops — all from inside Claude Code.

**Hooks & workers** — 22 hook events + 12 background workers for security, learning, performance, and test gap detection.

**MonoFence AI** — Prompt injection, jailbreak, and PII detection at every agent boundary.

## CLI commands

```
monomind init              Project setup
monomind agent <cmd>       Agent lifecycle (spawn, list, stop, metrics)
monomind swarm <cmd>       Multi-agent swarm coordination
monomind memory <cmd>      Vector memory (store, search, list)
monomind mcp start         Start MCP server for Claude Code
monomind hooks <cmd>       Self-learning hooks + background workers
monomind monograph <cmd>   Codebase knowledge graph
monomind autopilot         Keep agents working until all tasks done
monomind doctor --fix      Health check and auto-repair
monomind browse            Browser automation via CDP
monomind analyze           Code analysis and change risk
monomind guidance <cmd>    Governance control plane
```

Run `monomind --help` for the full list.

## Packages

| Package | Purpose |
|---|---|
| [`monomind`](https://www.npmjs.com/package/monomind) | Umbrella — **install this one** |
| [`@monoes/monomindcli`](https://www.npmjs.com/package/@monoes/monomindcli) | CLI engine (this package) |
| [`monofence-ai`](https://www.npmjs.com/package/monofence-ai) | AI manipulation defence |
| [`@monoes/monograph`](https://www.npmjs.com/package/@monoes/monograph) | Code knowledge graph |

## Requirements

- Node.js >= 20
- Claude Code (for MCP integration)

## Links

- [Documentation](https://monoes.github.io/monomind/)
- [GitHub](https://github.com/monoes/monomind)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT
