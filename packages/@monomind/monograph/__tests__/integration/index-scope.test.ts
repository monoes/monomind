import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from 'fs';
import { buildAsync } from '../../src/pipeline/orchestrator.js';
import { readIndexScope } from '../../src/pipeline/index-scope.js';
import { openDb, closeDb } from '../../src/storage/db.js';

// Regression: the MCP staleness auto-refresh called buildAsync with
// `{ codeOnly: true }`. The narrowed scan never listed documents, and the
// orphan sweep then treated every absent file as deleted — erasing all
// previously-indexed Document nodes from a graph whose doc files were still
// on disk. The sweep is now confined to the scanned source domain, and the
// scope a graph was built with is persisted and reused by later refreshes.

const tmpRepo = join(tmpdir(), `monograph-index-scope-${Date.now()}`);
const dbPath = join(tmpRepo, '.monomind', 'monograph.db');
const srcDir = join(tmpRepo, 'src');
const docsDir = join(tmpRepo, 'docs');

function withDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const db = openDb(dbPath);
  try {
    return fn(db);
  } finally {
    closeDb(db);
  }
}

const countByLabel = (label: string): number =>
  withDb(
    (db) =>
      (db.prepare('SELECT COUNT(*) as c FROM nodes WHERE label = ?').get(label) as { c: number }).c,
  );

const countForFile = (relPath: string): number =>
  withDb(
    (db) =>
      (db.prepare('SELECT COUNT(*) as c FROM nodes WHERE file_path = ?').get(relPath) as {
        c: number;
      }).c,
  );

beforeAll(() => {
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(
    join(srcDir, 'app.ts'),
    `
export class App {
  start(): void {}
}
`,
  );
  writeFileSync(join(srcDir, 'legacy.ts'), 'export function legacyHelper(): number { return 7; }\n');
  writeFileSync(
    join(docsDir, 'guide.md'),
    '# Guide\n\nThe `App` class is documented here.\n\n## Setup\n\nRun it.\n',
  );
  writeFileSync(join(tmpRepo, '.monographignore'), 'GRAPH_REPORT.md\n');
});

afterAll(() => rmSync(tmpRepo, { recursive: true, force: true }));

describe('index scope is preserved across refreshes', () => {
  it('records the scope a full build used', async () => {
    await buildAsync(tmpRepo);
    expect(withDb(readIndexScope)).toBe('all');
    expect(countByLabel('Document')).toBeGreaterThan(0);
  }, 60000);

  it('keeps Document nodes through an explicitly code-only refresh', async () => {
    const documentsBefore = countByLabel('Document');
    const appNodesBefore = countForFile('src/app.ts');
    expect(documentsBefore).toBeGreaterThan(0);
    expect(appNodesBefore).toBeGreaterThan(0);

    // Even an explicit code-only build must not sweep rows for a domain it
    // never scanned — docs/guide.md is still on disk.
    await buildAsync(tmpRepo, { codeOnly: true });

    expect(countByLabel('Document')).toBe(documentsBefore);
    expect(countForFile('docs/guide.md')).toBeGreaterThan(0);
    expect(countForFile('src/app.ts')).toBe(appNodesBefore);
    expect(withDb(readIndexScope)).toBe('code');
  }, 60000);

  it('a scope-less refresh reuses the persisted scope instead of narrowing it', async () => {
    // The previous test left the index at scope 'code'. Widen it again, then
    // refresh without stating a scope — as the MCP auto-refresh now does.
    await buildAsync(tmpRepo, { codeOnly: false });
    expect(withDb(readIndexScope)).toBe('all');
    const documentsBefore = countByLabel('Document');

    await buildAsync(tmpRepo);

    expect(withDb(readIndexScope)).toBe('all');
    expect(countByLabel('Document')).toBe(documentsBefore);
  }, 60000);

  it('still sweeps rows for files that were genuinely deleted', async () => {
    expect(countForFile('src/legacy.ts')).toBeGreaterThan(0);
    unlinkSync(join(srcDir, 'legacy.ts'));

    await buildAsync(tmpRepo);

    expect(countForFile('src/legacy.ts')).toBe(0);
    // Sweeping a deleted code file must not disturb the document domain.
    expect(countForFile('docs/guide.md')).toBeGreaterThan(0);
  }, 60000);

  it('sweeps a deleted document when the build scope covers documents', async () => {
    expect(countForFile('docs/guide.md')).toBeGreaterThan(0);
    unlinkSync(join(docsDir, 'guide.md'));

    await buildAsync(tmpRepo, { codeOnly: false });

    expect(countForFile('docs/guide.md')).toBe(0);
  }, 60000);
});
