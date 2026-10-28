/**
 * MCP 2026-07-28 additions: server/discover, ttlMs/cacheScope on list results,
 * stateless (no `initialize`) requests, UnsupportedProtocolVersionError, and
 * Streamable HTTP header validation. Legacy behaviour must be unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMCPServer } from '../src/index.js';
import {
  HEADER_MISMATCH,
  UNSUPPORTED_PROTOCOL_VERSION,
  validateModernHeaders,
} from '../src/modern.js';
import type { ILogger, MCPRequest, MCPResponse } from '../src/types.js';

const logger = (): ILogger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const call = (server: unknown, request: MCPRequest): Promise<MCPResponse> =>
  (server as any).handleRequest(request, 'conn-1');

const meta = (version = '2026-07-28') => ({
  _meta: {
    'io.modelcontextprotocol/protocolVersion': version,
    'io.modelcontextprotocol/clientInfo': { name: 't', version: '1' },
    'io.modelcontextprotocol/clientCapabilities': {},
  },
});

describe('modern (2026-07-28) requests', () => {
  let server: ReturnType<typeof createMCPServer>;

  beforeEach(async () => {
    server = createMCPServer({ name: 'Modern Test', transport: 'in-process' }, logger());
    await server.start();
  });
  afterEach(async () => {
    await server.stop();
  });

  it('server/discover answers without initialize', async () => {
    const res = await call(server, { jsonrpc: '2.0', id: 1, method: 'server/discover', params: meta() });
    const r = res.result as any;
    expect(res.error).toBeUndefined();
    expect(r.resultType).toBe('complete');
    expect(r.supportedVersions).toEqual(['2026-07-28']);
    expect(r.capabilities.tools).toBeDefined();
    expect(r._meta['io.modelcontextprotocol/serverInfo'].name).toBeTruthy();
    expect(r.ttlMs).toBeGreaterThanOrEqual(0);
    expect(['public', 'private']).toContain(r.cacheScope);
  });

  it('tools/list without initialize works and carries cache hints', async () => {
    const res = await call(server, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: meta() });
    const r = res.result as any;
    expect(res.error).toBeUndefined();
    expect(Array.isArray(r.tools)).toBe(true);
    expect(r.ttlMs).toBeGreaterThanOrEqual(0);
    expect(r.cacheScope).toBe('public');
  });

  it('prompts/list and resources/list carry cache hints', async () => {
    for (const method of ['prompts/list', 'resources/list']) {
      const res = await call(server, { jsonrpc: '2.0', id: 3, method, params: meta() });
      expect((res.result as any).ttlMs).toBeGreaterThanOrEqual(0);
      expect((res.result as any).cacheScope).toBe('public');
    }
  });

  it('rejects an unknown declared version with UnsupportedProtocolVersionError', async () => {
    const res = await call(server, {
      jsonrpc: '2.0', id: 4, method: 'tools/list', params: meta('1900-01-01'),
    });
    expect(res.error?.code).toBe(UNSUPPORTED_PROTOCOL_VERSION);
    expect((res.error as any).data).toEqual({ supported: ['2026-07-28'], requested: '1900-01-01' });
  });
});

describe('legacy clients are unaffected', () => {
  let server: ReturnType<typeof createMCPServer>;

  beforeEach(async () => {
    server = createMCPServer({ name: 'Legacy Test', transport: 'in-process' }, logger());
    await server.start();
  });
  afterEach(async () => {
    await server.stop();
  });

  it('still requires initialize when no modern version is declared', async () => {
    const res = await call(server, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(res.error?.message).toBe('Server not initialized');
  });

  it('serves tools/list after the legacy handshake', async () => {
    await call(server, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: { major: 2025, minor: 11, patch: 25 },
        capabilities: {},
        clientInfo: { name: 'legacy', version: '1' },
      },
    });
    const res = await call(server, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(res.error).toBeUndefined();
    expect(Array.isArray((res.result as any).tools)).toBe(true);
  });
});

describe('validateModernHeaders', () => {
  const body = { method: 'tools/call', params: { name: 'get_weather', ...meta() } };

  it('accepts requests with no modern headers (legacy clients)', () => {
    expect(validateModernHeaders({}, body)).toBeNull();
  });

  it('accepts matching headers, including a base64-encoded Mcp-Name', () => {
    expect(
      validateModernHeaders(
        { 'mcp-method': 'tools/call', 'mcp-name': 'get_weather', 'mcp-protocol-version': '2026-07-28' },
        body,
      ),
    ).toBeNull();
    const encoded = `=?base64?${Buffer.from('get_weather').toString('base64')}?=`;
    expect(validateModernHeaders({ 'mcp-name': encoded }, body)).toBeNull();
  });

  it('flags Mcp-Method, Mcp-Name and MCP-Protocol-Version mismatches', () => {
    expect(validateModernHeaders({ 'mcp-method': 'tools/list' }, body)).toMatch(/Mcp-Method/);
    expect(validateModernHeaders({ 'mcp-name': 'other' }, body)).toMatch(/Mcp-Name/);
    expect(validateModernHeaders({ 'mcp-protocol-version': '2025-11-25' }, body)).toMatch(
      /MCP-Protocol-Version/,
    );
  });

  it('compares resources/read against params.uri', () => {
    const read = { method: 'resources/read', params: { uri: 'file:///a' } };
    expect(validateModernHeaders({ 'mcp-name': 'file:///a' }, read)).toBeNull();
    expect(validateModernHeaders({ 'mcp-name': 'file:///b' }, read)).toMatch(/Mcp-Name/);
  });

  it('uses the spec-reserved HeaderMismatch code', () => {
    expect(HEADER_MISMATCH).toBe(-32020);
  });
});
