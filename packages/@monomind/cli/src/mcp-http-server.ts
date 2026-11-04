/**
 * HTTP/WebSocket transport startup for MCPServerManager. Split out of
 * mcp-server.ts. `@monoes/mcp` stays a dynamic import (optional dependency).
 */

import type { MCPServerOptions } from './mcp-server-types.js';

/**
 * Start the in-process HTTP/WS server and return it so the caller can close
 * it on stop(). `emitLog` receives the underlying server's log lines.
 */
export async function startHttpTransport(
  options: Required<MCPServerOptions>,
  emitLog: (payload: { level: string; msg: string; data?: unknown }) => void,
): Promise<{ close(): Promise<void> }> {
  // Loopback gate
  const host = options.host;
  const isLoopback =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1';
  const allowRemote = process.env.MONOMIND_MCP_ALLOW_REMOTE === '1';
  const token = process.env.MONOMIND_MCP_TOKEN;
  if (!isLoopback && !allowRemote) {
    throw new Error(
      `Refusing to bind MCP HTTP transport to non-loopback host "${host}". ` +
        `Set MONOMIND_MCP_ALLOW_REMOTE=1 and MONOMIND_MCP_TOKEN=<secret> to enable remote access.`,
    );
  }
  if (!isLoopback && allowRemote && (!token || token.length < 32)) {
    throw new Error(
      'Remote MCP transport requires MONOMIND_MCP_TOKEN to be set to a strong secret (>= 32 chars).',
    );
  }

  // Dynamically import the MCP server package
  // FIX for issue #942: Use proper package import instead of broken relative path
  const { createMCPServer } = await import('@monoes/mcp');

  const logger = {
    debug: (msg: string, data?: unknown) => emitLog({ level: 'debug', msg, data }),
    info: (msg: string, data?: unknown) => emitLog({ level: 'info', msg, data }),
    warn: (msg: string, data?: unknown) => emitLog({ level: 'warn', msg, data }),
    error: (msg: string, data?: unknown) => emitLog({ level: 'error', msg, data }),
  };

  // SECURITY: actually wire the token into the underlying server's auth
  // config. The startup gate above only *validates* that a token was set —
  // without passing it through here, the token was never enforced on
  // requests. Operators believed their server was protected when it wasn't.
  // For loopback we still configure auth when a token is set, so users who
  // explicitly opt-in to bind 0.0.0.0 with a token get end-to-end protection.
  const authConfig =
    token && token.length >= 32
      ? { enabled: true, method: 'token' as const, tokens: [token] }
      : isLoopback
        ? undefined
        : { enabled: true, method: 'token' as const, tokens: [] };
  const mcpServer = createMCPServer(
    {
      name: 'Monomind MCP Server V1',
      version: '3.0.0',
      transport: options.transport as 'http' | 'websocket',
      host: options.host,
      port: options.port,
      enableMetrics: true,
      enableCaching: true,
      ...(authConfig ? { auth: authConfig } : {}),
    } as Parameters<typeof createMCPServer>[0],
    logger,
  );

  await mcpServer.start();

  // Register all CLI tools (monograph, agent, swarm, memory, etc.) with the HTTP/WS server.
  // Without this the server only exposes its 4 built-in tools.
  try {
    const { getAllMCPTools } = await import('./mcp-client.js');
    const registered = mcpServer.registerTools(
      (await getAllMCPTools()) as Parameters<typeof mcpServer.registerTools>[0],
    );
    console.error(`[monomind-mcp] HTTP/WS server registered ${registered.registered} tools`);
  } catch (e) {
    console.error(`[monomind-mcp] Warning: could not register CLI tools with HTTP/WS server: ${e}`);
  }

  // GLU-07: the HTTP/WS transport has its own resource registry, so the
  // capture library has to be registered there too — otherwise `capture://`
  // uris resolve over stdio and 404 over HTTP. A template covers every
  // document (the registry matches `{placeholder}` as `[^/]+`, which is why
  // the identity is percent-encoded), plus one concrete index resource per
  // scope so `resources/list` shows something to start from.
  try {
    const registry = mcpServer.getResourceRegistry();
    const {
      CAPTURE_JSON_MIME_TYPE,
      CAPTURE_MIME_TYPE,
      CAPTURE_URI_TEMPLATE,
      captureIndexDescriptor,
      captureScopes,
      loadCaptureDocuments,
    } = await import('./mcp-tools/capture-resources.js');
    const readCapture = async (uri: string) => {
      const { captureResourceContents } = await import('./mcp-tools/capture-resource-read.js');
      return (await captureResourceContents(uri)).contents;
    };
    registry.registerTemplate(
      {
        uriTemplate: CAPTURE_URI_TEMPLATE,
        name: 'Captured page',
        description:
          'A captured page from the second brain: readable Markdown plus provenance. ' +
          'Add ?v=, ?chunk= or ?anchor= for a version or a citable passage.',
        mimeType: CAPTURE_MIME_TYPE,
      },
      readCapture,
    );
    const docs = await loadCaptureDocuments();
    for (const scope of captureScopes(docs)) {
      const descriptor = captureIndexDescriptor(
        scope,
        docs.filter((d) => d.scope === scope).length,
      );
      registry.registerResource({ ...descriptor, mimeType: CAPTURE_JSON_MIME_TYPE }, readCapture);
    }
  } catch (e) {
    // A brain that cannot be read is not a reason to refuse to serve tools.
    console.error(`[monomind-mcp] Warning: capture resources not registered: ${e}`);
  }

  return mcpServer;
}
