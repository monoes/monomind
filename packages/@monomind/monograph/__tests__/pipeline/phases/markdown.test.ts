import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { buildAsync } from '../../../src/pipeline/orchestrator.js';
import { openDb, closeDb } from '../../../src/storage/db.js';
import { getNodesForFile } from '../../../src/storage/node-store.js';
import { getEdgesForSource } from '../../../src/storage/edge-store.js';

const base = join(tmpdir(), `monograph-markdown-test-${Date.now()}`);
const dbPath = join(base, '.monomind', 'monograph.db');

beforeAll(async () => {
  mkdirSync(join(base, 'src'), { recursive: true });

  // TypeScript fixture — parser must extract a Function node named 'helper'
  writeFileSync(
    join(base, 'src', 'util.ts'),
    `export function helper(): void {\n  return;\n}\n`,
  );

  // Markdown fixture referencing the function by inline code span
  writeFileSync(
    join(base, 'README.md'),
    `# Usage\n\nCall \`helper\` to do things.\n`,
  );

  await buildAsync(base);
}, 60000);

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('markdown phase', () => {
  it('creates the SQLite database', () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates a Document node for the markdown file', () => {
    const db = openDb(dbPath);
    try {
      const nodes = getNodesForFile(db, 'README.md');
      const doc = nodes.find(n => n.label === 'Document');
      expect(doc).toBeDefined();
      expect(doc!.name).toBe('README');
      expect(doc!.language).toBe('markdown');
    } finally {
      closeDb(db);
    }
  });

  it('creates a REFERENCES edge from the Document node to the function node', () => {
    const db = openDb(dbPath);
    try {
      const docNodes = getNodesForFile(db, 'README.md');
      const doc = docNodes.find(n => n.label === 'Document');
      expect(doc).toBeDefined();

      const edges = getEdgesForSource(db, doc!.id);
      const refEdge = edges.find(e => e.relation === 'REFERENCES');
      expect(refEdge).toBeDefined();
      expect(refEdge!.confidence).toBe('INFERRED');
      expect(refEdge!.confidenceScore).toBe(0.8);

      // The target should be the 'helper' function node
      const helperRow = db
        .prepare(`SELECT id FROM nodes WHERE name = 'helper' AND label = 'Function'`)
        .get() as { id: string } | undefined;
      expect(helperRow).toBeDefined();
      expect(refEdge!.targetId).toBe(helperRow!.id);
    } finally {
      closeDb(db);
    }
  });

  it('does not crash when no markdown files exist', async () => {
    const noMdDir = join(tmpdir(), `monograph-nomd-${Date.now()}`);
    mkdirSync(join(noMdDir, 'src'), { recursive: true });
    writeFileSync(join(noMdDir, 'src', 'index.ts'), 'export const x = 1;\n');
    try {
      await expect(buildAsync(noMdDir)).resolves.not.toThrow();
    } finally {
      rmSync(noMdDir, { recursive: true, force: true });
    }
  }, 60000);
});
