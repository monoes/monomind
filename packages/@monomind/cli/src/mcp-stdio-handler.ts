/**
 * JSON-RPC message handling for the in-process stdio MCP server.
 * Split out of mcp-server.ts (MCPServerManager.handleMCPMessage); the dynamic
 * imports are kept dynamic on purpose.
 */

import { trackRequest } from './mcp-tools/request-tracker.js';

/**
 * Recursively strip prototype-pollution keys from a JSON-RPC message before
 * downstream tool handlers consume it. Tool handlers commonly do shallow
 * merges like `{ ...defaults, ...input }`, which would propagate
 * `__proto__`/`constructor`/`prototype` payloads onto config objects.
 */
const FORBIDDEN_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function sanitizeJsonRpcMessage(value: unknown, depth = 0): unknown {
  if (depth > 16) return null;
  if (Array.isArray(value)) return value.map((v) => sanitizeJsonRpcMessage(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_PROTO_KEYS.has(k)) continue;
      out[k] = sanitizeJsonRpcMessage(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Handle incoming MCP message
 */
export async function handleMCPMessage(
  message: { jsonrpc: string; id?: string | number; method?: string; params?: unknown },
  sessionId: string,
): Promise<{
  jsonrpc: string;
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
} | null> {
  const { listMCPTools, callMCPTool, hasTool } = await import('./mcp-client.js');

  if (!message.method) {
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32600, message: 'Invalid Request: missing method' },
    };
  }

  const params = (message.params || {}) as Record<string, unknown>;

  try {
    const { checkRequestedVersion, buildDiscoverResult, withCacheHints } = await import(
      './mcp-tools/mcp-modern.js'
    );
    const versionError = checkRequestedVersion(params);
    if (versionError) return { jsonrpc: '2.0', id: message.id, error: versionError };

    switch (message.method) {
      case 'server/discover':
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: buildDiscoverResult(
            { name: 'monomind', version: '3.0.0' },
            {
              tools: { listChanged: true },
              resources: { subscribe: false, listChanged: false },
            },
          ),
        };

      case 'initialize':
        void import('./mcp-tools/mesh-tools.js').then((m) =>
          m.joinMeshAtStart((params.clientInfo as { name?: unknown } | undefined)?.name),
        );
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'monomind', version: '3.0.0' },
            capabilities: {
              tools: { listChanged: true },
              resources: { subscribe: false, listChanged: false },
            },
          },
        };

      case 'tools/list': {
        const tools = await listMCPTools();
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: withCacheHints({
            resultType: 'complete',
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          }),
        };
      }

      case 'tools/call': {
        // Strict boundary validation. Without this, `params.name` could be
        // an array/object (silently coerced) and `params.arguments` could be
        // an array (downstream `Object.keys` returns numeric indices).
        if (typeof params.name !== 'string') {
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32602, message: 'Invalid params.name: must be a string' },
          };
        }
        const rawArgs = (params as Record<string, unknown>).arguments;
        if (
          rawArgs !== undefined &&
          (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs))
        ) {
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32602, message: 'Invalid params.arguments: must be an object' },
          };
        }
        const toolName = params.name;
        const toolParams = (rawArgs || {}) as Record<string, unknown>;

        // validateInput boundary: sanitize the incoming tool name.
        // This gates every MCP tool invocation (including path/write/command
        // tools), so invalid names are rejected before reaching tool handlers.
        {
          const { validateInput } = await import('./utils/input-guards.js');
          const check = validateInput(toolName, { type: 'string', maxLength: 200 });
          if (!check.valid) {
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32602, message: `Invalid tool name: ${check.error}` },
            };
          }
        }

        if (!(await hasTool(toolName))) {
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Tool not found: ${toolName}` },
          };
        }

        try {
          const result = await callMCPTool(toolName, toolParams, { sessionId });
          trackRequest(toolName, true);
          // Handlers return MCPToolResult {content, isError} — pass through directly.
          // Only wrap in a text envelope if the result is not already MCP-shaped.
          const isMcpResult =
            result !== null &&
            typeof result === 'object' &&
            'content' in (result as object) &&
            Array.isArray((result as any).content);
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: isMcpResult
              ? result
              : { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          };
        } catch (error) {
          trackRequest(toolName, false);
          const errMsg =
            process.env.NODE_ENV === 'production'
              ? 'Tool execution failed'
              : error instanceof Error
                ? error.message
                : 'Tool execution failed';
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: errMsg,
            },
          };
        }
      }

      case 'resources/list':
      case 'resources/templates/list':
      case 'resources/read': {
        // GLU-07: one implementation, shared with bin/cli.js's fast path and
        // bin/mcp-server.js, so every stdio entry point serves the same
        // resources — the code graph AND the capture library.
        const { handleResourceMethod } = await import('./mcp-tools/resource-router.js');
        const handled = await handleResourceMethod(message.method, params);
        if (!handled) {
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Method not found: ${message.method}` },
          };
        }
        return { jsonrpc: '2.0', id: message.id, ...handled };
      }

      case 'notifications/initialized':
        // Client notification - no response needed
        console.error(
          `[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Client initialized`,
        );
        return null;

      case 'ping':
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {},
        };

      default:
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        };
    }
  } catch (error) {
    // Log-injection defense: caller-controlled `message.method` may contain
    // newlines, ANSI escapes, or other control bytes that forge log lines.
    // JSON.stringify quotes the string and escapes control chars.
    const safeMethod = JSON.stringify(message.method);
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[${new Date().toISOString()}] ERROR [monomind-mcp] Error handling ${safeMethod}: ${errMsg.replace(/[\r\n]/g, ' ')}`,
    );
    // Sanitize outgoing error messages — internal Error.message often
    // contains absolute paths or partial secrets. In production return a
    // generic message; in dev/debug return the full message for triage.
    const isProd = process.env.NODE_ENV === 'production';
    const outMessage =
      error instanceof Error ? (isProd ? 'Internal error' : error.message) : 'Internal error';
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32603, message: outMessage },
    };
  }
}
