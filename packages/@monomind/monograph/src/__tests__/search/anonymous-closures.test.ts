import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAsync } from '../../pipeline/orchestrator.js';
import { godNodesPhase } from '../../pipeline/phases/god-nodes.js';
import { isAnonymousClosure } from '../../storage/anonymous-closure.js';
import { ftsSearch, hybridSearch } from '../../storage/fts-store.js';
import type { MonographNode } from '../../types.js';

describe('anonymous closures are kept off search surfaces (#404)', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'anon-closures-'));
    writeFileSync(
      join(tmpDir, 'handlers.ts'),
      `import { record } from './record';
export function processRequests(requests: string[]) {
  requests.map((request) => record(request));
  requests.forEach(async (request) => { await record(request); });
  const innerHelper = (r: string) => record(r);
  innerHelper('x');
}
export const topLevelHandler = (r: string) => record(r);
`,
    );
    writeFileSync(join(tmpDir, 'record.ts'), 'export function record(r: string) { return r; }\n');
    await buildAsync(tmpDir, { codeOnly: true });
    db = new Database(join(tmpDir, '.monomind', 'monograph.db'), { readonly: true });
  }, 60_000);

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not store closure nodes and folds their calls into the enclosing named symbol', () => {
    const rows = db.prepare("SELECT id, label, name FROM nodes WHERE label = 'Function'").all() as {
      id: string;
      label: string;
      name: string;
    }[];
    expect(rows.filter((r) => isAnonymousClosure(r))).toEqual([]);
    const caller = rows.find((r) => r.name === 'processRequests');
    const record = rows.find((r) => r.name === 'record');
    const calls = db
      .prepare("SELECT source_id, target_id FROM edges WHERE relation = 'CALLS'")
      .all() as { source_id: string; target_id: string }[];
    expect(calls).toContainEqual({ source_id: caller?.id, target_id: record?.id });
  });

  it('keeps a file-level closure bound to a const as a named function', () => {
    const rows = db
      .prepare(
        "SELECT id, start_line, end_line FROM nodes WHERE name = 'topLevelHandler' AND label = 'Function'",
      )
      .all() as { id: string; start_line: number | null; end_line: number | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.end_line).not.toBeNull();
    const calls = db
      .prepare("SELECT 1 FROM edges WHERE relation = 'CALLS' AND source_id = ?")
      .all(rows[0]?.id);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('ftsSearch does not return anonymous closures', () => {
    const results = ftsSearch(db, 'request', 50);
    expect(results.length).toBeGreaterThan(0);
    expect(results.filter((r) => isAnonymousClosure(r))).toEqual([]);
    expect(ftsSearch(db, 'record', 50).map((r) => r.name)).toContain('record');
  });

  it('LIKE fallbacks and hybridSearch do not return anonymous closures', () => {
    expect(ftsSearch(db, '=>', 50).filter((r) => isAnonymousClosure(r))).toEqual([]);
    const hybrid = hybridSearch(db, 'req', 50);
    expect(hybrid.filter((r) => isAnonymousClosure(r))).toEqual([]);
  });
});

describe('isAnonymousClosure', () => {
  it.each([
    ['() => {', true],
    ['async (req: string) => {', true],
    ['(\n', true],
    ['function () {', true],
    ['function* (x) {', true],
    ['async function (a) {', true],
    ['processRequests', false],
    ['asyncHandler', false],
    ['functionName', false],
  ])('%s -> %s', (name, expected) => {
    expect(isAnonymousClosure({ label: 'Function', name })).toBe(expected);
  });

  it('only applies to callable labels', () => {
    expect(isAnonymousClosure({ label: 'Folder', name: '(auth)' })).toBe(false);
  });
});

describe('godNodesPhase skips anonymous closures (#404)', () => {
  it('never ranks an anonymous closure as a god node', async () => {
    const mk = (id: string, name: string): MonographNode =>
      ({ id, label: 'Function', name, normLabel: name, filePath: '/a.ts' }) as MonographNode;
    const symbolNodes = [mk('anon', '() => {'), mk('named', 'hub')];
    for (let i = 0; i < 40; i++) symbolNodes.push(mk(`leaf${i}`, `leaf${i}`));
    const allEdges = symbolNodes.slice(2).flatMap((n) => [
      { id: `a${n.id}`, sourceId: 'anon', targetId: n.id, relation: 'CALLS' },
      { id: `h${n.id}`, sourceId: 'named', targetId: n.id, relation: 'CALLS' },
    ]);
    const deps = new Map<string, unknown>([
      ['cross-file', { resolvedEdges: [] }],
      ['parse', { allEdges, symbolNodes }],
    ]);
    const out = await godNodesPhase.execute({} as any, deps as any);
    const ids = out.godNodes.map((g) => g.id);
    expect(ids).toContain('named');
    expect(ids).not.toContain('anon');
  });
});
