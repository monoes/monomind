import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { buildAsync } from '../../src/pipeline/orchestrator.js';
import { openDb, closeDb } from '../../src/storage/db.js';

// Regression: every build writes GRAPH_REPORT.md into the repo root, and the next
// build scanned and indexed it — so the graph grew nodes and edges derived from a
// previous build's own output, compounding on every rebuild. The scan phase now
// treats GRAPH_REPORT.md as generated output, so a second build over unchanged
// sources reproduces exactly the first build's graph.

const tmpRepo = join(tmpdir(), `monograph-report-loop-${Date.now()}`);
const dbPath = join(tmpRepo, '.monomind', 'monograph.db');
const reportPath = join(tmpRepo, 'GRAPH_REPORT.md');

interface GraphSnapshot {
  nodes: string[];
  edges: string[];
}

/** Identity-bearing columns only, sorted — community ids and churn are not stable. */
function snapshot(): GraphSnapshot {
  const db = openDb(dbPath);
  try {
    const nodes = (
      db.prepare('SELECT id, label, name, file_path FROM nodes').all() as {
        id: string;
        label: string;
        name: string;
        file_path: string | null;
      }[]
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

beforeAll(() => {
  const srcDir = join(tmpRepo, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(
    join(srcDir, 'foo.ts'),
    `export function foo(n: number): number {\n  return n + 1;\n}\n`,
  );
  writeFileSync(
    join(srcDir, 'bar.ts'),
    `import { foo } from './foo.js';\n\nexport function bar(): number {\n  return foo(41);\n}\n`,
  );
  writeFileSync(join(tmpRepo, 'README.md'), `# Project\n\nThe \`foo\` helper is called by \`bar\`.\n`);
});

afterAll(() => rmSync(tmpRepo, { recursive: true, force: true }));

describe('GRAPH_REPORT.md is not fed back into the graph', () => {
  it('a rebuild over unchanged sources reproduces the same graph', async () => {
    await buildAsync(tmpRepo);
    // The report the first build wrote is what the second build must not index.
    expect(existsSync(reportPath)).toBe(true);
    const first = snapshot();
    expect(first.nodes.length).toBeGreaterThan(0);

    // Clean rebuild from scratch — only the report survives from the first build.
    rmSync(join(tmpRepo, '.monomind'), { recursive: true, force: true });
    await buildAsync(tmpRepo);
    const second = snapshot();

    expect(second).toEqual(first);
    expect(second.nodes.filter((n) => n.includes('GRAPH_REPORT'))).toEqual([]);
  }, 90000);
});
