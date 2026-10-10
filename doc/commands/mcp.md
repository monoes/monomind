# MCP Command Reference (`monomind mcp`)

> Reference for `monomind mcp` CLI subcommands and background process management.
> Core engine: `@monoes/mcp`. The CLI version is whatever `monomind --version` prints.

---

## Overview

The `monomind mcp` command suite manages local Model Context Protocol (MCP) servers, background daemon lifecycle, tool inspection, and interactive tool execution.

Defined in `packages/@monomind/cli/src/commands/mcp.ts` ([packages/@monomind/cli/src/commands/mcp.ts](packages/@monomind/cli/src/commands/mcp.ts)).

---

## Subcommands (11)

| Subcommand | Usage | Description |
|---|---|---|
| `start` | `monomind mcp start [-t stdio\|http\|websocket] [-p <port>] [--host <host>] [--tools <list\|all>] [-d] [-f]` | Start the MCP server. Default transport is `stdio`; `--port` defaults to `3000` and `--host` to `localhost`. `-d, --daemon` runs it in the background and waits for it to publish its PID; `-f, --force` kills an existing server first. A `stdio` start always restarts, because it cannot be health-checked. |
| `stop` | `monomind mcp stop [-f]` | Stop the background MCP server daemon managed by `MCPServerManager` ([`src/mcp-server.ts`](packages/@monomind/cli/src/mcp-server.ts)). It signals the PID in `~/.monomind/mcp.pid` only when that process's command line is a monomind MCP server. `-f` skips the graceful shutdown. |
| `status` | `monomind mcp status` | Display server running status, PID, port, active connections, and transport type. |
| `health` | `monomind mcp health` | Run health checks across core protocol handlers and tool registries. Exits 1 when no server is running. |
| `restart` | `monomind mcp restart [-f]` | Restart the background MCP server process; `-f` skips the graceful shutdown. |
| `tools` | `monomind mcp tools [-c <category>] [--enabled]` | List the advertised MCP tools: the <!-- doc-count:mcp-tools-default -->20<!-- /doc-count:mcp-tools-default -->-tool default roster, or every registered tool with `MONOMIND_MCP_FULL=1` (see [Default Advertised Roster](../concepts/mcp-server.md#default-advertised-roster)). Hidden tools stay callable through `exec`. `--format json` prints the list as JSON. |
| `toggle` | `monomind mcp toggle --disable <tool,tool> \| --enable <tool,tool>` | Disable or re-enable tools by name (comma-separated). The disabled list is saved to `.monomind/mcp-disabled-tools.json` in the working directory. A disabled tool is rejected at once by direct CLI calls; a running `mcp start` server must be restarted to stop advertising it. |
| `exec` | `monomind mcp exec -t <tool_name> [-p '<json>']` | Execute an MCP tool in-process, for testing tool calls locally. The tool name can also be the first positional argument. |
| `logs` | `monomind mcp logs [-n <lines>] [-f]` | Show the background MCP server's log (`~/.monomind/mcp.log`). `-n` defaults to 20; `-f` follows the log. |
| `verify` | `monomind mcp verify` | Check that the tool registry answers, that a built-in tool (`system_info`) resolves, and the `claude mcp` registration. Run it after `claude mcp add monomind ...`. Exits 1 if any check fails. |
| `monoes-proxy` | internal | stdio-to-HTTP proxy for the monoes.me MCP server. Claude Code spawns it from the `.mcp.json` entry that `init` and the dashboard write; you do not run it yourself. |

`doctor -c mcp` starts the configured server and checks that it answers `initialize`; the full `doctor` run uses a registry-only check that starts nothing. `doctor -c mcp-running` ("MCP Server Version") warns when a running monomind MCP server for this project predates the installed CLI, so tools the hooks suggest (such as `org_skill_show`) may be missing; restart Claude Code or reconnect monomind in `/mcp` to load the current server.

---

## Generated MCP Entries

`init` pins the MCP entries it generates (`.mcp.json`, Codex, OpenCode, Kimi Code, Antigravity) to the monomind version that ran it: `npx -y --package=@monoes/monomindcli@<version> monomind mcp start`. A floating `@latest` re-resolves the npm dist-tag on every start (3–4 s), can hang on a cold npx cache, and can change version mid-session. Pass `--pin latest` (or `--no-pin`) to keep `monomind@latest`, or `--pin <version>` for another version; after upgrading monomind, run `monomind init --force` to re-pin (`monomind update` does not rewrite these configs).

---

## Three Server Entry Points

When starting or interfacing with MCP, three distinct entry points are utilized:

1. **`bin/mcp-server.js`** ([packages/@monomind/cli/bin/mcp-server.js](packages/@monomind/cli/bin/mcp-server.js)): Binary stdio stream entry point used by Claude Code or IDE integrations (`monomind-mcp`). *Note:* Hardcodes `serverInfo: { name: 'monomind', version: '3.0.0' }` during initial handshake.
2. **`src/commands/mcp.ts`** ([packages/@monomind/cli/src/commands/mcp.ts](packages/@monomind/cli/src/commands/mcp.ts)): CLI command entry point handling the subcommands detailed above.
3. **`src/mcp-server.ts`** ([packages/@monomind/cli/src/mcp-server.ts](packages/@monomind/cli/src/mcp-server.ts)): PID manager and server daemon lifecycle manager (`~/.monomind/mcp.pid`).

---

## Guidance Tools (`guidance_*`)

The `mcp` subsystem registers guidance tools in [`src/mcp-tools/guidance-tools.ts`](packages/@monomind/cli/src/mcp-tools/guidance-tools.ts):

- `guidance_capabilities`
- `guidance_recommend`
- `guidance_discover`
- `guidance_workflow`
- `guidance_quickref`

Inspect guidance tool schemas via CLI:
```bash
monomind mcp exec guidance_capabilities
```
