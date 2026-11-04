/**
 * Stdio transport loop for MCPServerManager: memory auto-init, the stdin
 * reader, and graceful shutdown. Split out of mcp-server.ts.
 */

import { randomUUID } from 'node:crypto';
import { handleMCPMessage, sanitizeJsonRpcMessage } from './mcp-stdio-handler.js';

/** The slice of MCPServerManager the stdio loop needs. */
export interface StdioHost {
  emit(event: string): unknown;
  clearHealthCheck(): void;
  removePidFile(): Promise<void>;
}

export async function runStdioServer(host: StdioHost): Promise<void> {
  // Import the tool registry
  await import('./mcp-client.js');

  const VERSION = '3.0.0';
  const sessionId = `mcp-${Date.now()}-${randomUUID().slice(0, 8)}`;

  // Log to stderr to not corrupt stdout
  console.error(
    `[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Starting in stdio mode`,
  );

  // Auto-initialize memory database before tools are registered (#1524)
  // This ensures memory_pattern-store and other memory tools work immediately
  // without waiting for the first tool call to trigger lazy init.
  try {
    const { initializeMemoryDatabase, checkMemoryInitialization } = await import(
      './memory/memory-initializer.js'
    );
    const status = await checkMemoryInitialization();
    if (!status.initialized) {
      console.error(
        `[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Auto-initializing memory database...`,
      );
      const result = await initializeMemoryDatabase({ force: false, verbose: false });
      if (result.success) {
        console.error(
          `[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Memory database initialized at ${result.dbPath}`,
        );
      } else if (result.error && !result.error.includes('already exists')) {
        console.error(
          `[${new Date().toISOString()}] WARN [monomind-mcp] (${sessionId}) Memory database init returned: ${result.error}`,
        );
      }
    } else {
      console.error(
        `[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Memory database already initialized (v${status.version || 'unknown'})`,
      );
    }
  } catch (memInitError) {
    // Graceful degradation: server continues even if memory init fails.
    // Memory tools will attempt lazy init on first call via ensureInitialized().
    console.error(
      `[${new Date().toISOString()}] WARN [monomind-mcp] (${sessionId}) Memory auto-init failed (tools will retry on first call): ${memInitError instanceof Error ? memInitError.message : String(memInitError)}`,
    );
  }
  console.error(
    JSON.stringify({
      arch: process.arch,
      mode: 'mcp-stdio',
      nodeVersion: process.version,
      pid: process.pid,
      platform: process.platform,
      protocol: 'stdio',
      sessionId,
      version: VERSION,
    }),
  );

  // Send server initialization notification
  console.log(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'server.initialized',
      params: {
        serverInfo: {
          name: 'monomind',
          version: VERSION,
          capabilities: {
            tools: { listChanged: true },
            // No server-initiated notifications on this stdio loop — see
            // mcp-tools/resource-router.ts. Advertising subscribe here made
            // clients open subscriptions that could never fire.
            resources: { subscribe: false, listChanged: false },
          },
        },
      },
    }),
  );

  // Handle stdin messages (S-5: bounded buffer to prevent OOM)
  const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB
  let buffer = '';

  process.stdin.on('data', async (chunk) => {
    buffer += chunk.toString();

    if (buffer.length > MAX_BUFFER_SIZE) {
      console.error(
        `[${new Date().toISOString()}] ERROR [monomind-mcp] Buffer exceeded ${MAX_BUFFER_SIZE} bytes, rejecting`,
      );
      buffer = '';
      console.log(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Request too large' },
        }),
      );
      return;
    }

    // Process complete JSON messages
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          // Sanitize against prototype pollution. JSON.parse on its own does
          // not pollute, but downstream tool handlers that shallow-merge
          // input into option defaults would propagate `__proto__`,
          // `constructor`, or `prototype` keys. Strip them at the boundary.
          const message = sanitizeJsonRpcMessage(JSON.parse(line)) as {
            jsonrpc: string;
            id?: string | number;
            method?: string;
            params?: unknown;
          };
          const response = await handleMCPMessage(message, sessionId);
          if (response) {
            console.log(JSON.stringify(response));
          }
        } catch (error) {
          // Log-injection defense: stringify message fragment instead of
          // letting raw line content land in the log unescaped.
          const safeMsg = (error instanceof Error ? error.message : String(error))
            .replace(/[\r\n\x00-\x1f\x7f]/g, '?')
            .slice(0, 500);
          console.error(
            `[${new Date().toISOString()}] ERROR [monomind-mcp] Failed to parse message: ${safeMsg}`,
          );
        }
      }
    }
  });

  // Centralized graceful shutdown — clears the health-check interval and
  // removes the PID file before exiting. Without this an abrupt
  // `process.exit(0)` leaves a stale PID file plus a dangling interval and
  // unflushed in-flight tool calls.
  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(
      `[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) ${reason}, shutting down...`,
    );
    try {
      host.clearHealthCheck();
    } catch {
      /* best-effort */
    }
    try {
      await host.removePidFile();
    } catch {
      /* best-effort */
    }
    process.exit(0);
  };
  process.stdin.on('end', () => {
    void shutdown('stdin closed');
  });
  process.on('SIGINT', () => {
    void shutdown('Received SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('Received SIGTERM');
  });
  process.on('SIGHUP', () => {
    void shutdown('Received SIGHUP');
  });

  // Mark as ready immediately for stdio
  host.emit('ready');
}
