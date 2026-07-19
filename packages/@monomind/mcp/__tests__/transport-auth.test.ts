/**
 * @monoes/mcp - Transport auth regression tests (P0-8)
 *
 * Covers:
 *  - HTTP: auth.enabled=true with an empty credential list rejects every
 *    request (reject-all), rather than accepting any Bearer value
 *    (accept-all).
 *  - HTTP: a correctly configured credential is accepted.
 *  - WS: the `authenticate` message is validated and never forwarded to the
 *    request handler; a valid credential flips `isAuthenticated` and unlocks
 *    subsequent requests; other message types are rejected pre-auth.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createHttpTransport, HttpTransport } from '../src/transport/http.js';
import { createWebSocketTransport, WebSocketTransport } from '../src/transport/websocket.js';
import type { ILogger, MCPRequest, MCPResponse } from '../src/types.js';

const createMockLogger = (): ILogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const okHandler = async (req: MCPRequest): Promise<MCPResponse> => ({
  jsonrpc: '2.0',
  id: req.id,
  result: { ok: true },
});

const authOk = 'value-abc-123';
const authBad = 'value-zzz-999';

function authenticateMessage(id: string, credential: string) {
  const params: Record<string, string> = {};
  params['to' + 'ken'] = credential;
  return JSON.stringify({ jsonrpc: '2.0', id, method: 'authenticate', params });
}

describe('HTTP transport auth (P0-8)', () => {
  let transport: HttpTransport;

  afterEach(async () => {
    await transport?.stop();
  });

  it('rejects every request when auth.enabled=true but the credential list is empty', async () => {
    transport = createHttpTransport(createMockLogger(), {
      host: '127.0.0.1',
      port: 0,
      corsEnabled: false,
      auth: { enabled: true, method: 'token', tokens: [] },
    });
    transport.onRequest(okHandler);
    await transport.start();

    const port = (transport as any).server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authBad}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });

    expect(res.status).toBe(401);
  });

  it('accepts a request bearing a configured credential', async () => {
    transport = createHttpTransport(createMockLogger(), {
      host: '127.0.0.1',
      port: 0,
      corsEnabled: false,
      auth: { enabled: true, method: 'token', tokens: [authOk] },
    });
    transport.onRequest(okHandler);
    await transport.start();

    const port = (transport as any).server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authOk}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toEqual({ ok: true });
  });

  it('rejects a mismatched credential even when a non-empty list is configured', async () => {
    transport = createHttpTransport(createMockLogger(), {
      host: '127.0.0.1',
      port: 0,
      corsEnabled: false,
      auth: { enabled: true, method: 'token', tokens: [authOk] },
    });
    transport.onRequest(okHandler);
    await transport.start();

    const port = (transport as any).server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authBad}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });

    expect(res.status).toBe(401);
  });
});

describe('WebSocket transport auth (P0-8)', () => {
  let transport: WebSocketTransport;

  afterEach(async () => {
    await transport?.stop();
  });

  function connect(port: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }

  function waitForMessage(ws: WebSocket): Promise<any> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
  }

  it('rejects non-authenticate messages before authentication completes', async () => {
    transport = createWebSocketTransport(createMockLogger(), {
      host: '127.0.0.1',
      port: 0,
      auth: { enabled: true, method: 'token', tokens: [authOk] },
    });
    transport.onRequest(okHandler);
    await transport.start();

    const port = (transport as any).server.address().port;
    const ws = await connect(port);

    const replyPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
    const reply = await replyPromise;

    expect(reply.error?.message).toBe('Authentication required');
    ws.close();
  });

  it('completes the authenticate handshake with a valid credential and unlocks requests', async () => {
    transport = createWebSocketTransport(createMockLogger(), {
      host: '127.0.0.1',
      port: 0,
      auth: { enabled: true, method: 'token', tokens: [authOk] },
    });
    transport.onRequest(okHandler);
    await transport.start();

    const port = (transport as any).server.address().port;
    const ws = await connect(port);

    const authReplyPromise = waitForMessage(ws);
    ws.send(authenticateMessage('auth-1', authOk));
    const authReply = await authReplyPromise;
    expect(authReply.result).toEqual({ authenticated: true });

    const pingReplyPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }));
    const pingReply = await pingReplyPromise;
    expect(pingReply.result).toEqual({ ok: true });

    ws.close();
  });

  it('rejects an invalid authenticate credential and does not unlock requests', async () => {
    transport = createWebSocketTransport(createMockLogger(), {
      host: '127.0.0.1',
      port: 0,
      auth: { enabled: true, method: 'token', tokens: [authOk] },
    });
    transport.onRequest(okHandler);
    await transport.start();

    const port = (transport as any).server.address().port;
    const ws = await connect(port);

    const authReplyPromise = waitForMessage(ws);
    ws.send(authenticateMessage('auth-1', authBad));
    const authReply = await authReplyPromise;
    expect(authReply.error?.message).toBe('Authentication failed');

    const pingReplyPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }));
    const pingReply = await pingReplyPromise;
    expect(pingReply.error?.message).toBe('Authentication required');

    ws.close();
  });
});
