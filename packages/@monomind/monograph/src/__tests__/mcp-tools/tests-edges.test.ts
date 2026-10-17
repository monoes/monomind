import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getMonographContext } from '../../mcp-tools/context.js';
import { getMonographImpact } from '../../mcp-tools/impact.js';
import { buildAsync } from '../../pipeline/orchestrator.js';

describe('TESTS edges', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tests-edges-'));
    mkdirSync(join(tmpDir, 'src'));
    mkdirSync(join(tmpDir, 'src', '__tests__'));
    writeFileSync(join(tmpDir, 'src', 'math.ts'), 'export function add(a: number, b: number) { return a + b; }\nexport function unused() { return 0; }\n');
    writeFileSync(join(tmpDir, 'src', 'calc.ts'), "import { add } from './math';\nexport function total(xs: number[]) { return xs.reduce((s, x) => add(s, x), 0); }\n");
    writeFileSync(join(tmpDir, 'src', '__tests__', 'math.test.ts'), "import { add } from '../math';\nexport function testAdd() { return add(1, 2); }\n");
    await buildAsync(tmpDir, { codeOnly: true });
    db = new Database(join(tmpDir, '.monomind', 'monograph.db'), { readonly: true });
  }, 60_000);

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('links a test file to the source file it imports', () => {
    const rows = db
      .prepare("SELECT s.file_path AS test, t.file_path AS src FROM edges e JOIN nodes s ON s.id = e.source_id JOIN nodes t ON t.id = e.target_id WHERE e.relation = 'TESTS' AND t.label = 'File'")
      .all() as { test: string; src: string }[];
    expect(rows).toContainEqual({ test: 'src/__tests__/math.test.ts', src: 'src/math.ts' });
  });

  it('never marks a test as testing another test or a source as testing anything', () => {
    const bad = db
      .prepare("SELECT 1 FROM edges e JOIN nodes s ON s.id = e.source_id WHERE e.relation = 'TESTS' AND s.file_path NOT LIKE '%test%'")
      .all();
    expect(bad).toEqual([]);
  });

  it('context lists the tests covering a symbol', () => {
    const ctx = getMonographContext(db, { name: 'add' });
    const tests = [...ctx.testedBy, ...ctx.fileTests].map((t) => t.filePath);
    expect(tests).toContain('src/__tests__/math.test.ts');
  });

  it('impact names the tests to run, including via callers', () => {
    const impact = getMonographImpact(db, { name: 'add' });
    expect(impact.affectedTests).toContain('src/__tests__/math.test.ts');
  });

  it('an untested symbol in an untested file reports no tests', () => {
    const impact = getMonographImpact(db, { name: 'total' });
    expect(impact.affectedTests).toEqual([]);
  });
});
