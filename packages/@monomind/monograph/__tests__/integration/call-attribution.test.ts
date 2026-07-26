/**
 * CALLS edges must be attributed to the function containing the call, not to
 * the containing file.
 *
 * Attributing them to the file gave every function an inbound CALLS edge from
 * its own file purely for being declared there, which silently disabled
 * dead-export detection: `detectDeadCodeNodes` rejects any candidate with an
 * inbound CALLS/IMPORTS/REFERENCES/RE_EXPORTS edge, and that self-edge always
 * matched. Measured on the monomind repo before the fix: 9,672 of 9,672 CALLS
 * edges originated from a File node, 1,942 of 1,951 exported functions carried
 * a self-file edge, and 1,107 had it as their only inbound edge — while the
 * tool reported a single dead-code candidate.
 *
 * Calls at module top level are genuinely file-scoped and must keep a File
 * source, so this pins both directions.
 */
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { buildAsync } from '../../src/pipeline/orchestrator.js';
import { openDb, closeDb } from '../../src/storage/db.js';
import { detectDeadCodeNodes } from '../../src/graph/dead-code.js';
import type { Database } from 'better-sqlite3';

const tmpRepo = join(tmpdir(), `monograph-call-attribution-${Date.now()}`);
let db: Database;

beforeAll(async () => {
  mkdirSync(join(tmpRepo, 'src'), { recursive: true });

  writeFileSync(join(tmpRepo, 'src', 'util.ts'), 'export function helper(n: string): string { return `hi ${n}`; }\n');

  // greet() calls helper() from inside a method — must be attributed to greet.
  // neverCalledAnywhere is exported and called by nobody.
  writeFileSync(
    join(tmpRepo, 'src', 'service.ts'),
    [
      "import { helper } from './util.js';",
      'export class UserService {',
      '  constructor(private readonly name: string) {}',
      '  greet(): string { return helper(this.name); }',
      '}',
      'export function neverCalledAnywhere(): number { return 42; }',
      '',
    ].join('\n'),
  );

  // Calls at module top level — legitimately file-scoped.
  writeFileSync(
    join(tmpRepo, 'src', 'main.ts'),
    [
      "import { UserService } from './service.js';",
      "const s = new UserService('a');",
      'console.log(s.greet());',
      '',
    ].join('\n'),
  );

  await buildAsync(tmpRepo, { codeOnly: true, force: true });
  db = openDb(join(tmpRepo, '.monomind', 'monograph.db'));
}, 60000);

afterAll(() => {
  if (db) closeDb(db);
  rmSync(tmpRepo, { recursive: true, force: true });
});

function callSources(targetName: string): Array<{ label: string; name: string }> {
  return db
    .prepare(
      `SELECT s.label, s.name FROM edges e
         JOIN nodes s ON e.source_id = s.id
         JOIN nodes t ON e.target_id = t.id
        WHERE e.relation = 'CALLS' AND t.name = ?`,
    )
    .all(targetName) as Array<{ label: string; name: string }>;
}

describe('CALLS edge attribution', () => {
  it('attributes a call inside a method to that method', () => {
    const sources = callSources('helper');
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some(s => s.label === 'Method' && s.name === 'greet')).toBe(true);
  });

  it('does not attribute a call to the file merely containing the callee', () => {
    // `helper` is declared in util.ts. util.ts must not "call" it.
    expect(callSources('helper').some(s => s.label === 'File' && s.name === 'util.ts')).toBe(false);
  });

  it('keeps module-top-level calls attributed to the file', () => {
    // main.ts calls s.greet() and `new UserService()` at top level.
    const row = db
      .prepare(
        `SELECT COUNT(*) c FROM edges e JOIN nodes s ON e.source_id = s.id
          WHERE e.relation = 'CALLS' AND s.label = 'File' AND s.name = 'main.ts'`,
      )
      .get() as { c: number };
    expect(row.c).toBeGreaterThan(0);
  });

  it('leaves an uncalled exported function with no inbound CALLS edge', () => {
    expect(callSources('neverCalledAnywhere').length).toBe(0);
  });

  it('lets dead-code detection find a genuinely uncalled export', () => {
    expect(detectDeadCodeNodes(db).map(n => n.name)).toContain('neverCalledAnywhere');
  });

  it('still records the calls that really happen', () => {
    // The fix must move attribution, not drop edges: greet->helper and the two
    // top-level calls in main.ts should all survive.
    const total = db.prepare("SELECT COUNT(*) c FROM edges WHERE relation = 'CALLS'").get() as { c: number };
    expect(total.c).toBeGreaterThanOrEqual(3);
  });
});
