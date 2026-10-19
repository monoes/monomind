import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAsync } from '../../pipeline/orchestrator.js';

// A full build used to fail with "FOREIGN KEY constraint failed" (phase cross-file)
// when an index file re-exported a JSON file: the resolved edge pointed at a file
// that has no node.
describe('re-exporting a non-code file does not fail the build', () => {
  let dir: string;
  let db: Database.Database;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'reexport-json-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'en-US.json'), '{"hello":"world"}\n');
    writeFileSync(join(dir, 'src', 'util.ts'), 'export function util() { return 1; }\n');
    writeFileSync(
      join(dir, 'src', 'index.ts'),
      "export { default as enUS } from './en-US.json';\nexport * from './util';\n",
    );
    const result = await buildAsync(dir);
    expect(result.status).toBe('built');
    db = new Database(join(dir, '.monomind', 'monograph.db'), { readonly: true });
  }, 60_000);

  afterAll(() => {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('still links the re-export of a real source file', () => {
    const rows = db
      .prepare(
        "SELECT t.file_path AS p FROM edges e JOIN nodes s ON s.id = e.source_id JOIN nodes t ON t.id = e.target_id WHERE e.relation = 'RE_EXPORTS' AND s.file_path = 'src/index.ts'",
      )
      .all() as { p: string }[];
    expect(rows.map((r) => r.p)).toContain('src/util.ts');
  });

  it('leaves no edge pointing at a missing node', () => {
    const dangling = db
      .prepare(
        'SELECT COUNT(*) AS n FROM edges e WHERE NOT EXISTS (SELECT 1 FROM nodes WHERE id = e.target_id) OR NOT EXISTS (SELECT 1 FROM nodes WHERE id = e.source_id)',
      )
      .get() as { n: number };
    expect(dangling.n).toBe(0);
  });
});
