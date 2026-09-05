/**
 * Contract tests for the monograph_impact / monograph_rename MCP adapters.
 *
 * These drive the REGISTERED tool handlers (looked up out of the exported tool
 * arrays), not the underlying library functions — testing the library alone is
 * exactly what let the adapter field-name drift through:
 *
 *   - rename read `occurrences` / `references`; the library returns `changes`,
 *     so the tool printed "Occurrences: 0" no matter how many changes existed.
 *   - impact counted `affectedFiles` as "symbols" and recomputed risk labels
 *     with thresholds that disagreed with the library's own `riskLevel`.
 *
 * Every assertion below is written so that reintroducing either mismatch fails.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMonographImpact: vi.fn(),
  getMonographRename: vi.fn(),
  openDb: vi.fn(() => ({ __mockDb: true })),
  closeDb: vi.fn(),
}));

vi.mock('@monoes/monograph', () => mocks);

// ── Helpers ─────────────────────────────────────────────────────────────────

function node(over: Record<string, unknown>) {
  return {
    id: 'n?',
    label: 'Function',
    name: 'anon',
    normLabel: 'function',
    isExported: true,
    ...over,
  };
}

async function callTool(name: string, input: Record<string, unknown>) {
  const { allMonographTools } = await import('../src/mcp-tools/monograph/index.js');
  const tool = allMonographTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return (await tool.handler(input)) as {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
}

/** Readable prose block. */
const prose = (r: { content: Array<{ text?: string }> }) => r.content[0]?.text ?? '';
/** Machine-readable block emitted alongside the prose. */
const data = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[1]?.text ?? 'null');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openDb.mockReturnValue({ __mockDb: true });
});

// ── Registration ────────────────────────────────────────────────────────────

describe('tool registration', () => {
  it('monograph_impact is in the default-exposed core tool set', async () => {
    const { monographTools } = await import('../src/mcp-tools/monograph/index.js');
    expect(monographTools.map((t) => t.name)).toContain('monograph_impact');
  });

  it('monograph_rename is registered (advanced set)', async () => {
    const { allMonographTools } = await import('../src/mcp-tools/monograph/index.js');
    expect(allMonographTools.map((t) => t.name)).toContain('monograph_rename');
  });
});

// ── monograph_impact ────────────────────────────────────────────────────────

describe('monograph_impact adapter renders the library result', () => {
  const impactResult = {
    node: node({ id: 'root', name: 'doWork', label: 'Function', filePath: 'src/a.ts', startLine: 10 }),
    directCallers: [
      node({ id: 'c1', name: 'callerOne', filePath: 'src/b.ts', startLine: 4 }),
      node({ id: 'c2', name: 'callerTwo', filePath: 'src/b.ts', startLine: 40 }),
    ],
    transitiveCallers: [
      { depth: 2, nodes: [node({ id: 'c3', name: 'callerThree', filePath: 'src/c.ts', startLine: 7 })] },
    ],
    affectedFiles: ['src/b.ts', 'src/c.ts'],
    riskScore: 0.3,
    riskLevel: 'MEDIUM',
  };

  it('uses the library riskLevel instead of recomputing a label locally', async () => {
    // 0.30 is MEDIUM per the library's computeRiskLevel thresholds, but LOW
    // under the adapter's old local thresholds (>=0.8 HIGH / >=0.5 MEDIUM).
    mocks.getMonographImpact.mockReturnValue(impactResult);
    const res = await callTool('monograph_impact', { name: 'doWork' });

    expect(prose(res)).toContain('Risk: MEDIUM (0.30)');
    expect(prose(res)).not.toContain('LOW');
    expect(data(res).riskLevel).toBe('MEDIUM');
    expect(data(res).riskScore).toBe(0.3);
  });

  it('counts affectedFiles as files and callers as symbols', async () => {
    mocks.getMonographImpact.mockReturnValue(impactResult);
    const res = await callTool('monograph_impact', { name: 'doWork' });

    // Old bug: "Blast radius: 2 symbols affected" — that 2 was the file count.
    expect(prose(res)).toContain('Blast radius: 3 symbols across 2 files');
    expect(data(res).affectedSymbolCount).toBe(3);
    expect(data(res).affectedFileCount).toBe(2);
    expect(data(res).affectedFiles).toEqual(['src/b.ts', 'src/c.ts']);
  });

  it('preserves per-caller source locations and the depth from the grouping', async () => {
    mocks.getMonographImpact.mockReturnValue(impactResult);
    const res = await callTool('monograph_impact', { name: 'doWork' });

    expect(prose(res)).toContain('[Function] callerOne  src/b.ts:4 [depth 1]');
    expect(prose(res)).toContain('[Function] callerThree  src/c.ts:7 [depth 2]');
    expect(data(res).callers).toEqual([
      { id: 'c1', name: 'callerOne', label: 'Function', filePath: 'src/b.ts', startLine: 4, depth: 1 },
      { id: 'c2', name: 'callerTwo', label: 'Function', filePath: 'src/b.ts', startLine: 40, depth: 1 },
      { id: 'c3', name: 'callerThree', label: 'Function', filePath: 'src/c.ts', startLine: 7, depth: 2 },
    ]);
  });

  it('reports truncation state when more callers exist than are listed', async () => {
    mocks.getMonographImpact.mockReturnValue({
      ...impactResult,
      directCallers: Array.from({ length: 25 }, (_, i) =>
        node({ id: `d${i}`, name: `caller${i}`, filePath: 'src/b.ts', startLine: i + 1 }),
      ),
      transitiveCallers: [],
    });
    const res = await callTool('monograph_impact', { name: 'doWork' });

    expect(prose(res)).toContain('Callers (25, showing 20)');
    expect(prose(res)).toContain('… 5 more');
    expect(data(res).truncated).toEqual({
      callersListedInText: 20,
      callersOmittedFromText: 5,
    });
    // Truncation is display-only — the structured payload keeps every caller.
    expect(data(res).callers).toHaveLength(25);
  });

  it('reports "no symbol found" when the library returns a null node', async () => {
    mocks.getMonographImpact.mockReturnValue({
      node: null,
      directCallers: [],
      transitiveCallers: [],
      affectedFiles: [],
      riskScore: 0,
      riskLevel: 'LOW',
    });
    const res = await callTool('monograph_impact', { name: 'nope' });
    expect(prose(res)).toContain('No symbol found: nope');
  });
});

// ── monograph_rename ────────────────────────────────────────────────────────

describe('monograph_rename adapter renders the library result', () => {
  const renameResult = {
    symbol: node({ id: 'sym', name: 'oldFn', label: 'Function', filePath: 'src/a.ts', startLine: 3 }),
    referencingFiles: ['src/b.ts', 'src/c.ts'],
    changes: [
      { file: 'src/b.ts', line: 10, before: 'const x = oldFn(1);', after: 'const x = newFn(1);' },
      { file: 'src/c.ts', line: 22, before: 'export { oldFn };', after: 'export { newFn };' },
    ],
  };

  it('reports the real change count from `changes` (not zero)', async () => {
    mocks.getMonographRename.mockReturnValue(renameResult);
    const res = await callTool('monograph_rename', { oldName: 'oldFn', newName: 'newFn' });

    // Old bug: read rn.occurrences ?? rn.references → always [] → "Occurrences: 0".
    expect(prose(res)).toContain('Changes: 2 across 2 files');
    expect(prose(res)).not.toMatch(/Occurrences:\s*0/);
    expect(data(res).changeCount).toBe(2);
  });

  it('renders before/after diffs with their source locations', async () => {
    mocks.getMonographRename.mockReturnValue(renameResult);
    const res = await callTool('monograph_rename', { oldName: 'oldFn', newName: 'newFn' });
    const text = prose(res);

    expect(text).toContain('Symbol: [Function] oldFn  src/a.ts:3');
    expect(text).toContain('src/b.ts:10');
    expect(text).toContain('- const x = oldFn(1);');
    expect(text).toContain('+ const x = newFn(1);');
    expect(text).toContain('src/c.ts:22');
    expect(data(res).changes).toEqual(renameResult.changes);
    expect(data(res).referencingFiles).toEqual(['src/b.ts', 'src/c.ts']);
  });

  it('ignores stray `occurrences`/`references` fields and trusts `changes`', async () => {
    // Guards the exact drift direction: if someone re-points the adapter at a
    // field name the library does not populate, this fails loudly.
    mocks.getMonographRename.mockReturnValue({
      symbol: renameResult.symbol,
      referencingFiles: [],
      changes: [],
      occurrences: [{ filePath: 'src/ghost.ts', line: 1 }],
      references: [{ filePath: 'src/ghost.ts', line: 2 }],
    });
    const res = await callTool('monograph_rename', { oldName: 'oldFn', newName: 'newFn' });

    expect(prose(res)).toContain('Changes: 0 across 0 files');
    expect(prose(res)).not.toContain('ghost.ts');
    expect(data(res).changeCount).toBe(0);
  });

  it('reports truncation state when more changes exist than are listed', async () => {
    mocks.getMonographRename.mockReturnValue({
      symbol: renameResult.symbol,
      referencingFiles: ['src/b.ts'],
      changes: Array.from({ length: 33 }, (_, i) => ({
        file: 'src/b.ts',
        line: i + 1,
        before: `oldFn(${i})`,
        after: `newFn(${i})`,
      })),
    });
    const res = await callTool('monograph_rename', { oldName: 'oldFn', newName: 'newFn' });

    expect(prose(res)).toContain('… 3 more');
    expect(data(res).truncated).toEqual({
      changesListedInText: 30,
      changesOmittedFromText: 3,
    });
    expect(data(res).changes).toHaveLength(33);
  });

  it('surfaces the library error field as an error result', async () => {
    mocks.getMonographRename.mockReturnValue({
      symbol: null,
      referencingFiles: [],
      changes: [],
      error: 'index is stale',
    });
    const res = await callTool('monograph_rename', { oldName: 'oldFn', newName: 'newFn' });

    expect(res.isError).toBe(true);
    expect(prose(res)).toContain('Rename failed: index is stale');
    expect(data(res).error).toBe('index is stale');
  });

  it('reports "symbol not found" when the library returns a null symbol', async () => {
    mocks.getMonographRename.mockReturnValue({
      symbol: null,
      referencingFiles: [],
      changes: [],
    });
    const res = await callTool('monograph_rename', { oldName: 'ghostFn', newName: 'newFn' });

    expect(res.isError).toBeUndefined();
    expect(prose(res)).toContain('Symbol not found: ghostFn');
  });
});
