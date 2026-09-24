import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/claude-cli.js', () => ({
  isClaudeCliAvailable: () => true,
  claudeCliCall: vi.fn(async () =>
    JSON.stringify([
      { node_1: 'rollback', node_2: 'release', relation: 'PART_OF', edge: 'undoes a release' },
    ]),
  ),
}));

import { claudeCliCall } from '../../src/claude-cli.js';
import { buildAsync } from '../../src/pipeline/orchestrator.js';
import { closeDb, openDb } from '../../src/storage/db.js';
import { ftsSearch } from '../../src/storage/fts-store.js';

// Regression (#321): `monomind monograph wiki` promised "headings → Section
// nodes", but the docs-parse phase (and the pdf-parse, contextual-proximity and
// llm-extract phases that consume its Section nodes) was never registered with
// the build pipeline. A markdown file produced a single Document node and no
// heading was searchable on its own.

const tmpRepo = join(tmpdir(), `monograph-wiki-sections-${Date.now()}`);
const dbPath = join(tmpRepo, '.monomind', 'monograph.db');
const guidePath = join(tmpRepo, 'docs', 'guide.md');

const longBody = 'Rolling back restores the previous release artifact. '.repeat(8);

function writeGuide(preamble: string): void {
  writeFileSync(
    guidePath,
    `${preamble}# Deployment Guide\n\nIntro text.\n\n## Rollback Procedure\n\n${longBody}\n\n## Canary Checks\n\nCanary stuff. #release\n`,
  );
}

function withDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const db = openDb(dbPath);
  try {
    return fn(db);
  } finally {
    closeDb(db);
  }
}

const sectionNames = (): string[] =>
  withDb((db) =>
    (
      db.prepare("SELECT name FROM nodes WHERE label = 'Section' ORDER BY start_line").all() as {
        name: string;
      }[]
    ).map((r) => r.name),
  );

beforeAll(() => {
  mkdirSync(join(tmpRepo, 'docs'), { recursive: true });
  writeGuide('');
  writeFileSync(join(tmpRepo, 'docs', 'notes.txt'), 'Plain notes without any headings.\n');
});

afterAll(() => rmSync(tmpRepo, { recursive: true, force: true }));

describe('wiki build creates Section nodes for markdown headings (#321)', () => {
  it('creates one Section node per heading', async () => {
    await buildAsync(tmpRepo, { force: true });
    expect(sectionNames()).toEqual(
      expect.arrayContaining(['Deployment Guide', 'Rollback Procedure', 'Canary Checks']),
    );
  }, 60000);

  it('creates a whole-file Section for a plain-text document', () => {
    // parse also visits .txt files and purges their rows; docs-parse must run after it.
    expect(sectionNames()).toContain('notes');
  });

  it('makes a subheading independently searchable as a Section', () => {
    const hits = withDb((db) => ftsSearch(db, 'Rollback Procedure', 10, 'Section'));
    expect(hits.map((h) => h.name)).toContain('Rollback Procedure');
  });

  it('links subsections to their parent heading', () => {
    const parentOf = withDb(
      (db) =>
        db
          .prepare(
            `SELECT p.name AS name FROM edges e
             JOIN nodes p ON p.id = e.source_id
             JOIN nodes c ON c.id = e.target_id
             WHERE e.relation = 'PARENT_SECTION' AND c.name = 'Canary Checks'`,
          )
          .get() as { name: string } | undefined,
    );
    expect(parentOf?.name).toBe('Deployment Guide');
  });

  it('does not leave stale Section nodes behind when headings move', async () => {
    writeGuide('Preamble line.\n\n');
    await buildAsync(tmpRepo, { force: true });
    const names = sectionNames().filter((n) => n === 'Rollback Procedure');
    expect(names).toHaveLength(1);
  }, 60000);

  it('feeds Section content to --llm extraction', async () => {
    await buildAsync(tmpRepo, { force: true, llmMaxSections: 5 });
    expect(claudeCliCall).toHaveBeenCalled();
    const inferred = withDb(
      (db) =>
        (
          db.prepare("SELECT COUNT(*) AS c FROM edges WHERE confidence = 'INFERRED'").get() as {
            c: number;
          }
        ).c,
    );
    expect(inferred).toBeGreaterThan(0);
  }, 60000);
});
