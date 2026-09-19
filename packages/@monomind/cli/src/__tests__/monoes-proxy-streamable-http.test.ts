/**
 * monoes.me serves MCP over Streamable HTTP. The proxy must speak it: send an
 * Accept header naming both JSON and SSE, read SSE-framed responses, carry the
 * Mcp-Session-Id from initialize onward, and write nothing back for a
 * notification the server answers with 202. Found in owner testing: the real
 * server rejected every request with "Not Acceptable: Client must accept both
 * application/json and text/event-stream".
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMonoesProxy } from '../mcp/monoes-proxy.js';

let monomindHome = '';

beforeEach(() => {
  monomindHome = mkdtempSync(join(tmpdir(), 'monomind-monoes-proxy-http-'));
  mkdirSync(join(monomindHome, '.monomind'), { recursive: true });
  writeFileSync(
    join(monomindHome, '.monomind', 'monoes-connection.json'),
    JSON.stringify({
      accessToken: /* value */ 'FAKE-AT-http',
      expiresAt: Date.now() + 10 * 60 * 1000,
    }),
  );
});

afterEach(() => {
  rmSync(monomindHome, { recursive: true, force: true });
});

async function startProxy(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const lines: string[] = [];
  let buf = '';
  stdout.on('data', (c) => {
    buf += c.toString();
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    lines.push(...parts.filter(Boolean));
  });
  await runMonoesProxy({
    monomindHome,
    stdin,
    stdout,
    stderr: new PassThrough(),
    exit: vi.fn(),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const send = (msg: unknown) => stdin.write(`${JSON.stringify(msg)}\n`);
  return { send, lines };
}

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('monoes proxy speaks MCP Streamable HTTP', () => {
  it('sends Accept: application/json, text/event-stream on every request', async () => {
    const fetchMock = vi.fn(async () => json({ jsonrpc: '2.0', id: 1, result: {} }));
    const { send, lines } = await startProxy(fetchMock);
    send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await vi.waitFor(() => expect(lines.length).toBe(1));
    const accept = String(
      (fetchMock.mock.calls[0] as unknown[])[1] &&
        (
          (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit & {
            headers: Record<string, string>;
          }
        ).headers.Accept,
    );
    expect(accept).toContain('application/json');
    expect(accept).toContain('text/event-stream');
  });

  it('unwraps a JSON-RPC response delivered as an SSE stream', async () => {
    const sse =
      'event: message\n' +
      `data: ${JSON.stringify({ jsonrpc: '2.0', id: 7, result: { tools: [{ name: 'get_feed' }] } })}\n\n`;
    const fetchMock = vi.fn(
      async () =>
        new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    const { send, lines } = await startProxy(fetchMock);
    send({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    await vi.waitFor(() => expect(lines.length).toBe(1));
    expect(JSON.parse(lines[0])).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { tools: [{ name: 'get_feed' }] },
    });
  });

  it('carries the Mcp-Session-Id from initialize on later requests', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return body.method === 'initialize'
        ? json({ jsonrpc: '2.0', id: body.id, result: {} }, { 'mcp-session-id': 'sess-123' })
        : json({ jsonrpc: '2.0', id: body.id, result: {} });
    });
    const { send, lines } = await startProxy(fetchMock);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await vi.waitFor(() => expect(lines.length).toBe(1));
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await vi.waitFor(() => expect(lines.length).toBe(2));
    const second = (fetchMock.mock.calls[1] as unknown[])[1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(second.headers['Mcp-Session-Id']).toBe('sess-123');
  });

  it('writes nothing for a notification the server acknowledges with 202', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return body.id === undefined
        ? new Response(null, { status: 202 })
        : json({ jsonrpc: '2.0', id: body.id, result: {} });
    });
    const { send, lines } = await startProxy(fetchMock);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    await vi.waitFor(() => expect(lines.length).toBe(1));
    expect(JSON.parse(lines[0]).id).toBe(3);
  });
});
