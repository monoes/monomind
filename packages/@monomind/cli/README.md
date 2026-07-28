<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/packages/monomindcli.png" alt="@monoes/monomindcli" width="600" />
</p>

# @monoes/monomindcli

[![npm version](https://img.shields.io/npm/v/@monoes/monomindcli?style=flat-square&color=4F46E5)](https://www.npmjs.com/package/@monoes/monomindcli)
[![license](https://img.shields.io/npm/l/@monoes/monomindcli?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

**The CLI engine behind [Monomind](https://github.com/monoes/monomind)** — 32 commands, an MCP server, autonomous orgs, hooks, memory, and the full `.claude` integration tree. This is where all the code lives; the `monomind` package is a thin shim that pins this package.

> Most users should `npm install -g monomind` (the umbrella). Install this package directly only if you need to pin the CLI version independently.

## Install

```bash
npm install @monoes/monomindcli

# or via the umbrella (recommended)
npm install -g monomind
```

## What's inside

| Area | What |
|---|---|
| **32 CLI commands** | `init`, `agent`, `swarm`, `memory`, `mcp`, `task`, `session`, `config`, `hooks`, `org`, `security`, `performance`, `monograph`, `browse`, `doctor`, and more |
| **MCP server** | stdio transport (default), HTTP, WebSocket — exposes 100+ tools to Claude Code |
| **Autonomous orgs** | `org run` starts a real Claude Agent SDK daemon with policy-gated roles and a live dashboard |
| **Hooks system** | 29 subcommands wired into Claude Code's edit/task/command/session lifecycle |
| **Memory** | Local SQLite + embeddings, JSON pattern store, Second Brain document retrieval |
| **49 slash commands** | `/mastermind:*` workflows — build, review, debug, TDD, architecture, marketing, and more |

## CLI commands

### Core

```bash
monomind init                    # project setup wizard
monomind agent spawn -t coder   # spawn an agent
monomind swarm init              # initialize multi-agent swarm
monomind memory search --query "auth patterns"
monomind mcp start               # start MCP server
monomind org run content-team    # run an autonomous org
monomind doctor --fix            # health check
```

### Hooks & intelligence

```bash
monomind hooks route --task "fix auth bug"
monomind hooks worker list
monomind hooks worker run security
monomind hooks session-start --session-id my-session
```

### Advanced

```bash
monomind security scan --depth full
monomind performance benchmark --suite all
monomind monograph                # knowledge graph CLI
monomind browse                   # CDP browser automation
```

## MCP server

```bash
# Wire into Claude Code
claude mcp add monomind -- npx -y monomind@latest mcp start

# Or start manually
monomind mcp start -t http --port 3000
```

The MCP server exposes tools for memory, monograph, hooks, agents, swarm, embeddings, and more — Claude Code calls them via the Model Context Protocol.

## Relationship to `monomind`

The `monomind` npm package is an 11 kB shim that declares `@monoes/monomindcli` as its sole dependency. When you run `npx monomind`, the shim resolves and re-executes this package. Both packages share the same version number and are published in lockstep.

## Links

- [GitHub](https://github.com/monoes/monomind)
- [Full Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT
