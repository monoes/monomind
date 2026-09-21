/**
 * GLU-07 — every stdio entry point serves the same resources.
 *
 * This package has THREE stdio JSON-RPC loops, and which one a user gets
 * depends on how their client spawns monomind:
 *
 *   bin/cli.js          the fast path for a bare `monomind mcp start` — what
 *                       Claude Desktop and friends actually spawn
 *   bin/mcp-server.js   the `monomind-mcp` binary
 *   src/mcp-server.ts   MCPServerManager.startStdioServer
 *
 * All three advertised a `resources` capability. Only the third implemented
 * `resources/list`, so a client on either of the other two was told the server
 * had resources and then got "Method not found" for every one of them — which
 * is exactly the "bespoke integration" this story exists to remove.
 *
 * Asserted at the source level, as `bin-cli-mcp-fast-path.test.ts` does: the
 * fast path only activates with non-TTY stdin and imports compiled `dist/`
 * modules, so exercising it as a subprocess would need a prior build.
 */

import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => fs.readFileSync(join(PKG, rel), 'utf-8');

const ENTRY_POINTS = ['bin/cli.js', 'bin/mcp-server.js', 'src/mcp-server.ts'];

describe('GLU-07 stdio entry points', () => {
  it.each(ENTRY_POINTS)('%s answers resources/list, read and templates', (file) => {
    const source = read(file);
    expect(source).toContain("case 'resources/list':");
    expect(source).toContain("case 'resources/read':");
    expect(source).toContain("case 'resources/templates/list':");
  });

  it.each(ENTRY_POINTS)('%s delegates to the one resource router', (file) => {
    const source = read(file);
    expect(source).toMatch(/mcp-tools\/resource-router\.js/);
    expect(source).toContain('handleResourceMethod');
    // No second copy of the monograph resource table.
    if (!file.endsWith('resource-router.ts')) {
      expect(source).not.toContain("uri: 'monograph://repo/processes'");
    }
  });

  it.each(ENTRY_POINTS)('%s no longer promises subscriptions it cannot deliver', (file) => {
    const source = read(file);
    expect(source).not.toContain('resources: { subscribe: true');
    expect(source).toContain('resources: { subscribe: false, listChanged: false }');
  });

  it('keeps the monograph resource table in exactly one place', async () => {
    const { MONOGRAPH_RESOURCES } = await import('../mcp-tools/resource-router.js');
    expect(MONOGRAPH_RESOURCES.map((r) => r.uri)).toEqual([
      'monograph://repo/processes',
      'monograph://repo/communities',
      'monograph://repo/schema',
      'monograph://repo/graph',
    ]);
  });
});
