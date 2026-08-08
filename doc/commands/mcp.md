# MCP Command Reference (`monomind mcp`)

> Reference for `monomind mcp` CLI subcommands and background process management.
> CLI Version: `@monoes/monomindcli` `v2.9.0` | Core Engine: `@monoes/mcp` `v1.0.1`

---

## Overview

The `monomind mcp` command suite manages local Model Context Protocol (MCP) servers, background daemon lifecycle, tool inspection, and interactive tool execution.

Defined in `packages/@monomind/cli/src/commands/mcp.ts` ([file:1-350](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/mcp.ts#L1-L350)).

---

## Subcommands (9)

| Subcommand | Usage | Description |
|---|---|---|
| `start` | `monomind mcp start [-t stdio\|http\|websocket] [--port <p>]` | Start the MCP server. Default transport is `stdio`. Options `--port` and `-t` enable HTTP/WebSocket modes. |
| `stop` | `monomind mcp stop` | Stop running background MCP server daemon managed by `MCPServerManager` ([`src/mcp-tools/mcp-server.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/mcp-server.ts)). |
| `status` | `monomind mcp status` | Display server running status, PID, port, active connections, and transport type. |
| `health` | `monomind mcp health` | Run health checks across core protocol handlers and tool registries. |
| `restart` | `monomind mcp restart` | Restart active background MCP server process. |
| `tools` | `monomind mcp tools [--category <cat>]` | List all registered MCP tools across 30+ domain modules. |
| `toggle` | `monomind mcp toggle <tool_name>` | Enable or disable a specific tool dynamically in the server registry. |
| `exec` | `monomind mcp exec <tool_name> [args_json]` | Direct execution endpoint for testing MCP tool calls locally. |
| `logs` | `monomind mcp logs [--lines <n>]` | Tail background MCP server daemon log outputs (`~/.monomind/logs/mcp-server.log`). |

---

## Three Server Entry Points

When starting or interfacing with MCP, three distinct entry points are utilized:

1. **`bin/mcp-server.js`** ([file:96-196](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/bin/mcp-server.js#L96-L196)): Binary stdio stream entry point used by Claude Code or IDE integrations (`monomind-mcp`). *Note:* Hardcodes `serverInfo: { name: 'monomind', version: '3.0.0' }` during initial handshake.
2. **`src/commands/mcp.ts`** ([file:1-350](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/mcp.ts#L1-L350)): CLI command entry point handling the 9 subcommands detailed above.
3. **`src/mcp-server.ts`** ([file:1-280](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/mcp-server.ts#L1-L280)): PID manager and server daemon lifecycle manager (`~/.monomind/mcp-server.pid`).

---

## Guidance Tools (`guidance_*`)

The `mcp` subsystem registers guidance tools in [`src/mcp-tools/guidance-tools.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/guidance-tools.ts):

- `guidance_capabilities`
- `guidance_recommend`
- `guidance_discover`
- `guidance_workflow`
- `guidance_quickref`

Inspect guidance tool schemas via CLI:
```bash
monomind mcp exec guidance_capabilities
```
