# MCP Command Reference (`monomind mcp`)

> Reference for `monomind mcp` CLI subcommands and background process management.
> CLI Version: `@monoes/monomindcli` `v2.9.0` | Core Engine: `@monoes/mcp` `v1.0.1`

---

## Overview

The `monomind mcp` command suite manages local Model Context Protocol (MCP) servers, background daemon lifecycle, tool inspection, and interactive tool execution.

Defined in `packages/@monomind/cli/src/commands/mcp.ts` ([packages/@monomind/cli/src/commands/mcp.ts](packages/@monomind/cli/src/commands/mcp.ts)).

---

## Subcommands (9)

| Subcommand | Usage | Description |
|---|---|---|
| `start` | `monomind mcp start [-t stdio\|http\|websocket] [--port <p>]` | Start the MCP server. Default transport is `stdio`. Options `--port` and `-t` enable HTTP/WebSocket modes. |
| `stop` | `monomind mcp stop` | Stop running background MCP server daemon managed by `MCPServerManager` ([`src/mcp-server.ts`](packages/@monomind/cli/src/mcp-server.ts)). |
| `status` | `monomind mcp status` | Display server running status, PID, port, active connections, and transport type. |
| `health` | `monomind mcp health` | Run health checks across core protocol handlers and tool registries. |
| `restart` | `monomind mcp restart` | Restart active background MCP server process. |
| `tools` | `monomind mcp tools [--category <cat>]` | List the advertised MCP tools: the <!-- doc-count:mcp-tools-default -->20<!-- /doc-count:mcp-tools-default -->-tool default roster, or every registered tool with `MONOMIND_MCP_FULL=1` (see [Default Advertised Roster](../concepts/mcp-server.md#default-advertised-roster)). Hidden tools stay callable through `exec`. |
| `toggle` | `monomind mcp toggle <tool_name>` | Enable or disable a specific tool dynamically in the server registry. |
| `exec` | `monomind mcp exec <tool_name> [args_json]` | Direct execution endpoint for testing MCP tool calls locally. |
| `logs` | `monomind mcp logs [--lines <n>]` | Tail background MCP server daemon log outputs (`~/.monomind/logs/mcp-server.log`). |

---

## Generated MCP Entries

`init` pins the MCP entries it generates (`.mcp.json`, Codex, OpenCode, Kimi Code, Antigravity) to the monomind version that ran it: `npx -y --package=@monoes/monomindcli@<version> monomind mcp start`. A floating `@latest` re-resolves the npm dist-tag on every start (3–4 s), can hang on a cold npx cache, and can change version mid-session. Pass `--pin latest` (or `--no-pin`) to keep `monomind@latest`, or `--pin <version>` for another version; after upgrading monomind, run `monomind init --force` to re-pin (`monomind update` does not rewrite these configs).

---

## Three Server Entry Points

When starting or interfacing with MCP, three distinct entry points are utilized:

1. **`bin/mcp-server.js`** ([packages/@monomind/cli/bin/mcp-server.js](packages/@monomind/cli/bin/mcp-server.js)): Binary stdio stream entry point used by Claude Code or IDE integrations (`monomind-mcp`). *Note:* Hardcodes `serverInfo: { name: 'monomind', version: '3.0.0' }` during initial handshake.
2. **`src/commands/mcp.ts`** ([packages/@monomind/cli/src/commands/mcp.ts](packages/@monomind/cli/src/commands/mcp.ts)): CLI command entry point handling the 9 subcommands detailed above.
3. **`src/mcp-server.ts`** ([packages/@monomind/cli/src/mcp-server.ts](packages/@monomind/cli/src/mcp-server.ts)): PID manager and server daemon lifecycle manager (`~/.monomind/mcp-server.pid`).

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
