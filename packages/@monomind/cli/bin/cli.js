#!/usr/bin/env node
/**
 * @monomind/cli - CLI Entry Point
 *
 * Monomind Command Line Interface
 *
 * MCP mode requires explicit `mcp start` subcommand or MONOMIND_MCP_AUTODETECT=1.
 * Usage: npx @monomind/cli mcp start
 */

import { randomUUID } from 'crypto';

// Check if we should run in MCP server mode.
// SECURITY: only accept explicit `mcp start` plus piped stdin, OR the explicit
// `MONOMIND_MCP_AUTODETECT=1` opt-in for the legacy "no args + non-TTY" path.
// Previously any `monomind` invocation with redirected stdin (CI pipes, xargs,
// editor integrations) silently flipped into MCP server mode and accepted
// JSON-RPC tools/call — privilege escalation by environment.
const cliArgs = process.argv.slice(2);
const isExplicitMCP = cliArgs.length >= 1 && cliArgs[0] === 'mcp' && (cliArgs.length === 1 || cliArgs[1] === 'start');
const allowAutoDetect = process.env.MONOMIND_MCP_AUTODETECT === '1';
const isMCPMode = !process.stdin.isTTY && (isExplicitMCP || (allowAutoDetect && process.argv.length === 2));

if (isMCPMode) {
  // Run MCP server mode
  const { listMCPTools, callMCPTool, hasTool } = await import('../dist/src/mcp-client.js');

  // Read version from package.json instead of hardcoding (prevents stale
  // version drift between bin entry and the published package).
  let VERSION = '0.0.0';
  try {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (typeof pkg.version === 'string') VERSION = pkg.version;
  } catch { /* fall back to 0.0.0 */ }
  const sessionId = `mcp-${Date.now()}-${randomUUID().slice(0, 8)}`;

  // Don't leak nodeVersion/platform/arch/pid to stderr by default; gate behind
  // MONOMIND_LOG_LEVEL=debug to reduce fingerprinting in shared log aggregators.
  if (process.env.MONOMIND_LOG_LEVEL === 'debug') {
    console.error(
      `[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Starting in stdio mode (node=${process.version} platform=${process.platform} arch=${process.arch})`
    );
  } else {
    console.error(
      `[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Starting in stdio mode`
    );
  }

  // Top-level safety nets — without these, an unhandled async error in a tool
  // handler crashes the process with no observable cleanup.
  process.on('uncaughtException', (err) => {
    console.error(`[${new Date().toISOString()}] FATAL [monomind-mcp] uncaughtException: ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error(`[${new Date().toISOString()}] FATAL [monomind-mcp] unhandledRejection: ${msg}`);
    process.exit(1);
  });
  const shutdown = (sig) => {
    console.error(`[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) ${sig} received, shutting down`);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Cap on accumulated input buffer so a peer pumping a single multi-GB line
  // (or a slow trickle without newlines) cannot OOM-kill the process.
  const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_BUFFER_BYTES) {
      console.error(`[${new Date().toISOString()}] FATAL [monomind-mcp] input exceeds ${MAX_BUFFER_BYTES} bytes`);
      process.exit(1);
    }
    let lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          const response = await handleMessage(message);
          if (response) {
            console.log(JSON.stringify(response));
          }
        } catch (error) {
          console.log(JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          }));
        }
      }
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });

  async function handleMessage(message) {
    if (!message.method) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32600, message: 'Invalid Request: missing method' },
      };
    }

    const params = message.params || {};

    switch (message.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'monomind', version: VERSION },
            capabilities: {
              tools: { listChanged: true },
              resources: { subscribe: true, listChanged: true },
            },
          },
        };

      case 'tools/list': {
        const tools = listMCPTools();
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: tools.map(tool => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          },
        };
      }

      case 'tools/call': {
        const toolName = params.name;
        const toolParams = params.arguments || {};

        if (!hasTool(toolName)) {
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Tool not found: ${toolName}` },
          };
        }

        try {
          const result = await callMCPTool(toolName, toolParams, { sessionId });
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          };
        } catch (error) {
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : 'Tool execution failed',
            },
          };
        }
      }

      case 'notifications/initialized':
        return null;

      case 'ping':
        return { jsonrpc: '2.0', id: message.id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        };
    }
  }
} else {
  // Run normal CLI mode.
  // Install top-level handlers so an asynchronous error fired from an event-
  // loop callback does not bypass the synchronous .catch below. Default Node
  // handler prints the full stack to stderr — which on this codebase includes
  // attacker-influenced bytes from registry/config error messages and full
  // filesystem paths. Sanitize before logging and exit non-zero.
  const safeMsg = (m) =>
    String(m == null ? '' : m).replace(/[\x00-\x1f\x7f-\x9f]/g, '?').slice(0, 1000);
  process.on('uncaughtException', (err) => {
    console.error(`[${new Date().toISOString()}] FATAL [monomind] uncaughtException: ${safeMsg(err && err.message)}`);
    if (process.env.DEBUG) console.error(err && err.stack);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error(`[${new Date().toISOString()}] FATAL [monomind] unhandledRejection: ${safeMsg(msg)}`);
    if (process.env.DEBUG && reason instanceof Error) console.error(reason.stack);
    process.exit(1);
  });

  const { CLI } = await import('../dist/src/index.js');
  const cli = new CLI();
  cli.run().catch((error) => {
    console.error('Fatal error:', safeMsg(error && error.message));
    process.exit(1);
  });
}
