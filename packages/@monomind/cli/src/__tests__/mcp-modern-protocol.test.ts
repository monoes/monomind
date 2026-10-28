/**
 * MCP 2026-07-28 additions on the three stdio entry points (see
 * mcp-resources-entry-points.test.ts for why wiring is asserted at source
 * level: bin/ loops import compiled dist/). Behaviour is covered against the
 * shared helper and the resource router directly.
 */

import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildDiscoverResult,
  checkRequestedVersion,
  UNSUPPORTED_PROTOCOL_VERSION,
  withCacheHints,
} from '../mcp-tools/mcp-modern.js';
import { handleResourceMethod } from '../mcp-tools/resource-router.js';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY_POINTS = ['bin/cli.js', 'bin/mcp-server.js', 'src/mcp-server.ts'];
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';

describe('mcp-modern helper', () => {
  it('discover result matches the spec shape', () => {
    const r = buildDiscoverResult({ name: 'monomind', version: '1' }, { tools: {} });
    expect(r.resultType).toBe('complete');
    expect(r.supportedVersions).toEqual(['2026-07-28']);
    expect(r._meta['io.modelcontextprotocol/serverInfo']).toEqual({ name: 'monomind', version: '1' });
    expect(r.ttlMs).toBeGreaterThanOrEqual(0);
    expect(r.cacheScope).toBe('public');
  });

  it('withCacheHints keeps the result and adds ttlMs/cacheScope', () => {
    expect(withCacheHints({ tools: [] }, 'private')).toMatchObject({
      tools: [],
      cacheScope: 'private',
      ttlMs: expect.any(Number),
    });
  });

  it('legacy params (no declared version) are never rejected', () => {
    expect(checkRequestedVersion(undefined)).toBeNull();
    expect(checkRequestedVersion({})).toBeNull();
    expect(checkRequestedVersion({ _meta: { progressToken: 1 } })).toBeNull();
    expect(checkRequestedVersion({ protocolVersion: '2024-11-05', capabilities: {} })).toBeNull();
  });

  it('accepts 2026-07-28 and rejects any other declared version', () => {
    expect(checkRequestedVersion({ _meta: { [VERSION_KEY]: '2026-07-28' } })).toBeNull();
    expect(checkRequestedVersion({ _meta: { [VERSION_KEY]: '1900-01-01' } })).toEqual({
      code: UNSUPPORTED_PROTOCOL_VERSION,
      message: 'Unsupported protocol version',
      data: { supported: ['2026-07-28'], requested: '1900-01-01' },
    });
  });
});

describe('resource router cache hints', () => {
  it('resources/list and templates/list are public, with ttlMs', async () => {
    for (const method of ['resources/list', 'resources/templates/list']) {
      const res = await handleResourceMethod(method, {});
      expect(res && 'result' in res && (res.result as any).cacheScope).toBe('public');
      expect(res && 'result' in res && (res.result as any).ttlMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('errors carry no cache hints', async () => {
    const res = await handleResourceMethod('resources/read', { uri: '' });
    expect(res).toEqual({ error: { code: -32602, message: 'Invalid params.uri: expected a string' } });
  });
});

describe('stdio entry points', () => {
  it.each(ENTRY_POINTS)('%s serves server/discover, version check and cache hints', (file) => {
    const source = fs.readFileSync(join(PKG, file), 'utf-8');
    expect(source).toContain("case 'server/discover':");
    expect(source).toContain('buildDiscoverResult');
    expect(source).toContain('checkRequestedVersion');
    expect(source).toContain('withCacheHints');
  });

  it.each(ENTRY_POINTS)('%s keeps the legacy initialize handshake', (file) => {
    const source = fs.readFileSync(join(PKG, file), 'utf-8');
    expect(source).toContain("case 'initialize':");
    expect(source).toContain("protocolVersion: '2024-11-05'");
    expect(source).toContain("case 'notifications/initialized':");
  });
});
