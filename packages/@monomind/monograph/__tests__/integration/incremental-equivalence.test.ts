import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { buildAsync, buildIncrementalAsync } from '../../src/pipeline/orchestrator.js';
import { openDb, closeDb } from '../../src/storage/db.js';

// Regression: incremental processing used to delete the changed file's edges and
// re-parse only that file, never rerunning relationship resolution or the derived
// analyses. Editing `foo`'s body therefore removed the CALLS edge from `bar`, the
// IMPORTS edge between the two files, and the README's REFERENCES edge — leaving a
// graph that a clean build of the same content would never produce.

const tmpRepo = join(tmpdir(), `monograph-incremental-equivalence-${Date.now()}`);
const dbPath = join(tmpRepo, '.monomind', 'monograph.db');
const srcDir = join(tmpRepo, 'src');
const fooPath = join(srcDir, 'foo.ts');

const FOO_V1 = `
export function foo(n: number): number {
  return n + 1;
}
`;

const FOO_V2 = `
export function foo(n: number): number {
  const doubled = n * 2;
  return doubled + 1;
}
`;

const BAR = `
import { foo } from './foo.js';

export function bar(): number {
  return foo(41);
}
`;

const README = `
# Project

The \`foo\` helper is called by \`bar\`.
`;

interface GraphSnapshot {
  nodes: string[];
  edges: string[];
}

/**
 * Canonical form of the stored graph: identity-bearing columns only, sorted.
 * Community ids and churn scores are deliberately excluded — Leiden assignment
 * is not stable across runs and says nothing about dependency correctness.
 */
function snapshot(): GraphSnapshot {
  const db = openDb(dbPath);
  try {
    const nodes = (
      db
        .prepare('SELECT id, label, name, file_path FROM nodes')
        .all() as { id: string; label: string; name: string; file_path: string | null }[]
    )
      .map((n) => `${n.id}|${n.label}|${n.name}|${n.file_path ?? ''}`)
      .sort();
    const edges = (
      db.prepare('SELECT source_id, relation, target_id FROM edges').all() as {
        source_id: string;
        relation: string;
        target_id: string;
      }[]
    )
      .map((e) => `${e.source_id}|${e.relation}|${e.target_id}`)
      .sort();
    return { nodes, edges };
  } finally {
    closeDb(db);
  }
}

function writeFixture(fooSource: string) {
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(fooPath, fooSource);
  writeFileSync(join(srcDir, 'bar.ts'), BAR);
  writeFileSync(join(tmpRepo, 'README.md'), README);
  // A build writes GRAPH_REPORT.md into the repo root and the next build indexes
  // it, so its (build-order-dependent) prose would show up in the comparison.
  // That feedback loop is not what this test is about.
  writeFileSync(join(tmpRepo, '.monographignore'), 'GRAPH_REPORT.md\n');
}

afterAll(() => rmSync(tmpRepo, { recursive: true, force: true }));

describe('incremental build equals clean build', () => {
  it('produces the same canonical nodes and edges after a body-only edit', async () => {
    // 1. Clean build of v1, then edit foo's body and update incrementally.
    writeFixture(FOO_V1);
    await buildAsync(tmpRepo);
    const v1 = snapshot();
    expect(v1.edges.length).toBeGreaterThan(0);

    writeFileSync(fooPath, FOO_V2);
    await buildIncrementalAsync(tmpRepo, [fooPath]);
    const afterIncremental = snapshot();

    // 2. Clean build of exactly the same on-disk content, from scratch.
    rmSync(join(tmpRepo, '.monomind'), { recursive: true, force: true });
    await buildAsync(tmpRepo);
    const afterClean = snapshot();

    expect(afterIncremental).toEqual(afterClean);
  }, 90000);

  it('keeps the cross-file relationships an edit used to erase', async () => {
    // Guards the specific loss the reviewer reproduced: the incremental path
    // dropped every edge incident to the changed file and never restored them.
    const { edges } = snapshot();
    const relations = new Set(edges.map((e) => e.split('|')[1]));
    for (const relation of ['CALLS', 'IMPORTS']) {
      expect(relations.has(relation)).toBe(true);
    }
  });
});
