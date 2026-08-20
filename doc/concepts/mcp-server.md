# MCP Server Architecture & Integration Reference

> Public reference for the MonoMind Model Context Protocol (MCP) subsystem.
> Core Protocol Engine: `@monoes/mcp` `v1.0.1` | CLI Integration: `@monoes/monomindcli` `v2.9.0`

---

## Overview & Dual-Package Architecture

MonoMind provides a complete Model Context Protocol (MCP) subsystem, split into two dedicated packages:

1. **Core Protocol Engine (`@monoes/mcp` v1.0.1)**  
   - Located at `packages/@monomind/mcp/` ([package.json:3](packages/@monomind/mcp/package.json#L3)).  
   - Standalone, lightweight protocol engine implementing stdio, HTTP (Express/Cors/Helmet), and WebSocket (`ws`) transports, connection pooling (`src/connection-pool.ts`), tool registry with Zod validation (`src/tool-registry.ts`), prompt registry (`src/prompt-registry.ts`), resource registry (`src/resource-registry.ts`), rate limiting, and session lifecycle management.

2. **CLI Integration Package (`@monoes/monomindcli` v2.9.0)**  
   - Located at `packages/@monomind/cli/` ([package.json:3](packages/@monomind/cli/package.json#L3)).  
   - Integrates the MCP engine into the CLI, exposing `monomind mcp` CLI subcommands, background daemon process management, and over 30 domain-specific tool modules under `src/mcp-tools/`.

---

## Server Entry Points

The subsystem exposes three distinct entry points:

| Entry Point | Location | Description & Behavior |
|---|---|---|
| **Binary Stdio Server (`monomind-mcp`)** | `bin/mcp-server.js` ([file:96-196](packages/@monomind/cli/bin/mcp-server.js#L96-L196)) | Executable entry point for stdio protocol streams (e.g. `claude mcp add monomind -- monomind-mcp`). - **Protocol Version:** Complies with MCP specification release `2024-11-05` ([`packages/@monomind/cli/src/mcp-server.ts:532`](packages/@monomind/cli/src/mcp-server.ts#L532) & [`packages/@monomind/mcp/src/server.ts:91`](packages/@monomind/mcp/src/server.ts#L91)). - **Server Identity Version:** Hardcodes server identity `version: '3.0.0'` in `bin/mcp-server.js` (`VERSION = '3.0.0'` at [`bin/mcp-server.js:13`](packages/@monomind/cli/bin/mcp-server.js#L13)) in its `initialize` handshake (`serverInfo: { name: 'monomind', version: '3.0.0' }`). |
| **CLI Command Module (`monomind mcp`)** | `src/commands/mcp.ts` ([file:1-350](packages/@monomind/cli/src/commands/mcp.ts#L1-L350)) | Provides 9 CLI subcommands: `start`, `stop`, `status`, `health`, `restart`, `tools`, `toggle`, `exec`, `logs`. |
| **Daemon Process Manager (`MCPServerManager`)** | `src/mcp-server.ts` ([file:1-280](packages/@monomind/cli/src/mcp-tools/mcp-server.ts#L1-L280)) | Manages background MCP server processes, PID lifecycle (`~/.monomind/mcp-server.pid`), port binding, and background logging. |

---

## MCP Tool Categories & Modules

The CLI registers and exports domain tool modules under `packages/@monomind/cli/src/mcp-tools/` ([index.ts:8-33](packages/@monomind/cli/src/mcp-tools/index.ts#L8-L33)).

### Key Tool Categories

| Category | Source File | Tools Included |
|---|---|---|
| **Guidance** | [`guidance-tools.ts`](packages/@monomind/cli/src/mcp-tools/guidance-tools.ts) | `guidance_capabilities`, `guidance_recommend`, `guidance_discover`, `guidance_workflow`, `guidance_quickref` |
| **Monograph** | [`mcp-tools/monograph/`](packages/@monomind/cli/src/mcp-tools/monograph/) (`monograph-tools.ts` is now a re-export shim, not the source) | `monograph_build`, `monograph_query`, `monograph_suggest`, `monograph_impact`, `monograph_context`, `monograph_neighbors`, and 40 more — see [Monograph concept doc](../concepts/monograph.md) for the full 19-default/27-advanced-gated breakdown |
| **Memory** | [`memory-tools.ts`](packages/@monomind/cli/src/mcp-tools/memory-tools.ts) | `memory_pattern-search`, `memory_pattern-store`, `memory_feedback`, `memory_kg_ingest`, `memory_kg_search` |
| **Second Brain** | [`knowledge-tools.ts`](packages/@monomind/cli/src/mcp-tools/knowledge-tools.ts) | `knowledge_ingest`, `knowledge_search`, `knowledge_remove` |
| **Monomind Tool Index** | [`monomind-tools.ts`](packages/@monomind/cli/src/mcp-tools/monomind-tools.ts) | `monomind_tool_search` |
| **Orgs & Monoswarm** | [`org-tools.ts`](packages/@monomind/cli/src/mcp-tools/org-tools.ts), [`monoswarm-tools.ts`](packages/@monomind/cli/src/mcp-tools/monoswarm-tools.ts) | `task_create`, `task_status`, `system_status`, `monoswarm_init` |
| **Browser & Terminal** | [`browser-tools.ts`](packages/@monomind/cli/src/mcp-tools/browser-tools.ts), [`terminal-tools.ts`](packages/@monomind/cli/src/mcp-tools/terminal-tools.ts) | `browser_open`, `browser_snapshot`, `browser_click`, `browser_fill`, terminal execution |

---

## Guidance Tools (`guidance_*`)

The guidance suite ([src/mcp-tools/guidance-tools.ts](packages/@monomind/cli/src/mcp-tools/guidance-tools.ts)) equips AI assistants with capability discovery and workflow recommendations:

1. `guidance_capabilities`: Inspect system capability status and active enforcement gates.
2. `guidance_recommend`: Get recommended tool sequences based on intent.
3. `guidance_discover`: Discover relevant tools and commands dynamically for a given task prompt.
4. `guidance_workflow`: Retrieve step-by-step workflow guides for complex multi-agent or memory operations.
5. `guidance_quickref`: Generate quick reference cards for submodules, CLI commands, and MCP schemas.

---

## Setup & Configuration

### Standard Stdio Registration (Claude Code & Antigravity)

```bash
claude mcp add monomind -- npx -y monomind@latest mcp start
```

### Explicit HTTP / WebSocket Transports

```bash
# Start HTTP transport server on default port
monomind mcp start -t http --port 8080

# Start WebSocket transport server
monomind mcp start -t websocket --port 8081
```

> **Security Note:** Standard stdio invocation requires explicit `mcp` or `mcp start` argument. Auto-detection on empty args is disabled by default; pass `MONOMIND_MCP_AUTODETECT=1` to enable legacy non-interactive auto-detection.
