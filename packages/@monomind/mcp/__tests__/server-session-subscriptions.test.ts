/**
 * Regression tests for GitHub issues #92, #93, #94:
 *
 * #92 — resources/unsubscribe used to only forget the URI locally; the
 *       registry subscriptionId was discarded, so update callbacks leaked and
 *       phantom notifications fired after unsubscribe / session teardown.
 * #93 — a single global session let a second client's `initialize` hijack the
 *       first client's session, and expired sessions left ghost references
 *       behind. Sessions are now bound per connection.
 * #94 — quickStart's default logger wrote debug/info to stdout, corrupting
 *       the JSON-RPC stream when paired with the stdio transport.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMCPServer, createTextResource, quickStart } from '../src/index.js';
import { ErrorCodes } from '../src/types.js';
import type { ILogger, MCPRequest, MCPResponse } from '../src/types.js';

const createMockLogger = (): ILogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const initializeParams = {
  protocolVersion: { major: 2025, minor: 11, patch: 25 },
  capabilities: {},
  clientInfo: { name: 'test-client', version: '1.0.0' },
};

/** handleRequest is private; drive it the way transports do. */
function call(server: unknown, request: MCPRequest, connectionId?: string): Promise<MCPResponse> {
  return (server as any).handleRequest(request, connectionId);
}

describe('issue #92 — resource subscriptions are actually detached', () => {
  let server: ReturnType<typeof createMCPServer>;

  beforeEach(async () => {
    server = createMCPServer(
      { name: 'Sub Test Server', transport: 'in-process' },
      createMockLogger()
    );
    await server.start();

    const registry = server.getResourceRegistry();
    const { resource, handler } = createTextResource('file://live.txt', 'Live', 'content');
    registry.registerResource(resource, handler);

    await call(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: initializeParams });
  });

  afterEach(async () => {
    await server.stop();
  });

  it('resources/unsubscribe removes the registry subscription', async () => {
    const registry = server.getResourceRegistry();

    const sub = await call(server, {
      jsonrpc: '2.0', id: 2, method: 'resources/subscribe', params: { uri: 'file://live.txt' },
    });
    expect(sub.error).toBeUndefined();
    expect((sub.result as any).subscriptionId).toBeDefined();
    expect(registry.getSubscriptionCount('file://live.txt')).toBe(1);

    const unsub = await call(server, {
      jsonrpc: '2.0', id: 3, method: 'resources/unsubscribe', params: { uri: 'file://live.txt' },
    });
    expect(unsub.error).toBeUndefined();
    expect(registry.getSubscriptionCount('file://live.txt')).toBe(0);
  });

  it('terminateSession purges the session\'s subscriptions', async () => {
    const registry = server.getResourceRegistry();

    await call(server, {
      jsonrpc: '2.0', id: 2, method: 'resources/subscribe', params: { uri: 'file://live.txt' },
    });
    expect(registry.getSubscriptionCount('file://live.txt')).toBe(1);

    const sessionId = server.getSessions()[0].id;
    expect(server.terminateSession(sessionId)).toBe(true);
    expect(registry.getSubscriptionCount('file://live.txt')).toBe(0);
  });

  it('re-subscribing the same URI replaces rather than duplicates', async () => {
    const registry = server.getResourceRegistry();

    for (const id of [2, 3]) {
      await call(server, {
        jsonrpc: '2.0', id, method: 'resources/subscribe', params: { uri: 'file://live.txt' },
      });
    }
    expect(registry.getSubscriptionCount('file://live.txt')).toBe(1);
  });

  it('stopping the server detaches all subscriptions', async () => {
    const registry = server.getResourceRegistry();

    await call(server, {
      jsonrpc: '2.0', id: 2, method: 'resources/subscribe', params: { uri: 'file://live.txt' },
    });
    expect(registry.getSubscriptionCount('file://live.txt')).toBe(1);

    await server.stop();
    expect(registry.getSubscriptionCount('file://live.txt')).toBe(0);
  });
});

describe('issue #93 — sessions are bound per connection', () => {
  let server: ReturnType<typeof createMCPServer>;

  beforeEach(async () => {
    server = createMCPServer(
      { name: 'Session Test Server', transport: 'in-process' },
      createMockLogger()
    );
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('a second client\'s initialize does not hijack the first connection\'s session', async () => {
    const seenSessionIds: Record<string, string[]> = { 'conn-a': [], 'conn-b': [] };

    server.registerTool({
      name: 'whoami',
      description: 'Echo the calling session id',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_input, context) => ({ sessionId: context.sessionId }),
    });

    await call(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: initializeParams }, 'conn-a');
    await call(server, { jsonrpc: '2.0', id: 2, method: 'initialize', params: initializeParams }, 'conn-b');

    for (const conn of ['conn-a', 'conn-b'] as const) {
      const res = await call(server, {
        jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'whoami', arguments: {} },
      }, conn);
      expect(res.error).toBeUndefined();
      const payload = JSON.parse((res.result as any).content[0].text);
      seenSessionIds[conn].push(payload.sessionId);
    }

    expect(seenSessionIds['conn-a'][0]).not.toBe('unknown');
    expect(seenSessionIds['conn-b'][0]).not.toBe('unknown');
    // Without per-connection sessions, conn-a would report conn-b's session.
    expect(seenSessionIds['conn-a'][0]).not.toBe(seenSessionIds['conn-b'][0]);
  });

  it('an expired session reference is cleared instead of becoming a ghost', async () => {
    // stdio-style: no connectionId, singleton session
    await call(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: initializeParams });
    const firstSessionId = (server as any).currentSession?.id;
    expect(firstSessionId).toBeDefined();

    // Simulate the session-manager reaping the session
    (server as any).sessionManager.emit('session:expired', { id: firstSessionId });
    expect((server as any).currentSession).toBeUndefined();

    // The next request must NOT silently ride the expired ghost session —
    // the client is told to re-initialize (SERVER_NOT_INITIALIZED)…
    const res = await call(server, { jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(res.error?.code).toBe(ErrorCodes.SERVER_NOT_INITIALIZED);

    // …and a fresh initialize binds a brand-new session.
    await call(server, { jsonrpc: '2.0', id: 3, method: 'initialize', params: initializeParams });
    expect((server as any).currentSession?.id).toBeDefined();
    expect((server as any).currentSession?.id).not.toBe(firstSessionId);
  });

  it('expiry also purges the session\'s resource subscriptions', async () => {
    const registry = server.getResourceRegistry();
    const { resource, handler } = createTextResource('file://exp.txt', 'Exp', 'content');
    registry.registerResource(resource, handler);

    await call(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: initializeParams }, 'conn-x');
    await call(server, {
      jsonrpc: '2.0', id: 2, method: 'resources/subscribe', params: { uri: 'file://exp.txt' },
    }, 'conn-x');
    expect(registry.getSubscriptionCount('file://exp.txt')).toBe(1);

    const sessionId = (server as any).connectionSessions.get('conn-x')?.id;
    (server as any).sessionManager.emit('session:expired', { id: sessionId });

    expect(registry.getSubscriptionCount('file://exp.txt')).toBe(0);
    expect((server as any).connectionSessions.has('conn-x')).toBe(false);
  });
});

describe('issue #94 — quickStart default logger respects the transport channel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stdio transport logs everything to stderr', async () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stdoutSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const server = await quickStart({ name: 'Stdio Server', transport: 'stdio' });
    const logger = (server as any).logger as ILogger;

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(stderrSpy).toHaveBeenCalledTimes(4);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('non-stdio transports keep stdout for debug/info', async () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stdoutSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const server = await quickStart({ name: 'HTTP Server', transport: 'http' });
    const logger = (server as any).logger as ILogger;

    logger.info('i');
    logger.error('e');

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('an explicitly provided logger is used as-is', async () => {
    const custom = createMockLogger();
    const server = await quickStart({ name: 'Custom', transport: 'stdio' }, custom);
    (server as any).logger.info('hello');
    expect(custom.info).toHaveBeenCalledTimes(1);
  });
});
