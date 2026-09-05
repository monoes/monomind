import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseFile } from '../../src/parsers/loader.js';
import { buildAsync } from '../../src/pipeline/orchestrator.js';
import { closeDb, openDb } from '../../src/storage/db.js';
import { docId, fileId, folderId, makeId, symbolId } from '../../src/types.js';

const ID_CHARSET = /^[a-z0-9_]+$/;

describe('file identity — derivation', () => {
  it('gives a-b.ts and a_b.ts distinct File node IDs', () => {
    // The old scheme mangled both paths to `src_a_b_ts_file`, so one File node
    // silently overwrote the other and containment edges attached to whichever
    // survived.
    expect(fileId('src/a-b.ts')).not.toBe(fileId('src/a_b.ts'));
  });

  it('distinguishes paths that differ only in separator punctuation', () => {
    const variants = [
      fileId('src/a/b.ts'),
      fileId('src/a-b.ts'),
      fileId('src/a_b.ts'),
      fileId('src/a.b.ts'),
      fileId('src_a_b.ts'),
    ];
    expect(new Set(variants).size).toBe(variants.length);
  });

  it('keeps File, Folder and Document nodes for one path distinct', () => {
    // markdown.ts relies on this: a markdown file's Document node must not
    // collide with that same file's File node.
    const ids = [fileId('docs/guide.md'), folderId('docs/guide.md'), docId('docs/guide.md')];
    expect(new Set(ids).size).toBe(3);
  });

  it('keeps the _<kind> suffix downstream code probes with endsWith', () => {
    expect(fileId('src/a.ts').endsWith('_file')).toBe(true);
    expect(folderId('src').endsWith('_folder')).toBe(true);
    expect(docId('README.md').endsWith('_doc')).toBe(true);
  });

  it('is deterministic', () => {
    expect(fileId('src/a-b.ts')).toBe(fileId('src/a-b.ts'));
  });

  it('stays within [a-z0-9_] and survives makeId unchanged', () => {
    const dashed = fileId('src/a-b.ts');
    const underscored = fileId('src/a_b.ts');

    expect(dashed).toMatch(ID_CHARSET);
    expect(makeId(dashed)).toBe(dashed);
    expect(makeId(underscored)).toBe(underscored);

    // The distinction must survive into CONTAINS edge IDs built via makeId —
    // that composition is where a lossy ID re-introduces collisions one layer down.
    expect(makeId('folder', dashed, 'contains')).not.toBe(
      makeId('folder', underscored, 'contains'),
    );
  });

  it('holds the charset and round-trip invariants for punctuation-heavy paths', () => {
    for (const path of ['src/a-b.ts', 'a b/c.ts', 'src/@scope/pkg.ts', 'src/über.ts', '.env.ts']) {
      const id = fileId(path);
      expect(id).toMatch(ID_CHARSET);
      expect(makeId(id)).toBe(id);
    }
  });
});

describe('file identity — extraction', () => {
  it('gives the File nodes of a-b.ts and a_b.ts distinct IDs', async () => {
    const source = 'export function run() { return 1; }\n';
    const dashed = await parseFile('/tmp/src/a-b.ts', source, 'src/a-b.ts');
    const underscored = await parseFile('/tmp/src/a_b.ts', source, 'src/a_b.ts');

    const dashedFile = dashed.nodes.find((n) => n.label === 'File');
    const underscoredFile = underscored.nodes.find((n) => n.label === 'File');

    expect(dashedFile?.id).toBe(fileId('src/a-b.ts'));
    expect(underscoredFile?.id).toBe(fileId('src/a_b.ts'));
    expect(dashedFile?.id).not.toBe(underscoredFile?.id);
  });

  it('emits CONTAINS edges that reference the File node actually emitted', async () => {
    const result = await parseFile(
      '/tmp/src/a-b.ts',
      'export function run() { return 1; }\n',
      'src/a-b.ts',
    );
    const ids = new Set(result.nodes.map((n) => n.id));

    expect(result.edges.length).toBeGreaterThan(0);
    for (const edge of result.edges) {
      expect(ids.has(edge.sourceId)).toBe(true);
    }
  });
});

describe('migrated ad-hoc symbol IDs', () => {
  // parse.ts minted `${filePath}::namespace::${name}` / `${filePath}::fn::${name}`
  // and variables.ts minted `var:${filePath}:${name}`. Those contained `:` and `.`,
  // which makeId mangled when composing edge IDs.
  const cases = [
    { kind: 'Namespace', name: 'Acme' },
    { kind: 'Function', name: 'handler' },
    { kind: 'Variable', name: 'config' },
  ];

  it('produces IDs within [a-z0-9_] that survive an edge-ID round-trip', () => {
    for (const { kind, name } of cases) {
      const dashed = symbolId({ filePath: 'src/a-b.ts', scope: [], name, kind });
      const underscored = symbolId({ filePath: 'src/a_b.ts', scope: [], name, kind });

      expect(dashed).toMatch(ID_CHARSET);
      expect(makeId(dashed)).toBe(dashed);
      expect(makeId(fileId('src/a-b.ts'), dashed, 'contains')).not.toBe(
        makeId(fileId('src/a_b.ts'), underscored, 'contains'),
      );
    }
  });

  it('keeps the three kinds distinct for one file and name', () => {
    const ids = cases.map(({ kind, name: _ }) =>
      symbolId({ filePath: 'src/a.ts', scope: [], name: 'thing', kind }),
    );
    expect(new Set(ids).size).toBe(3);
  });
});

describe('graph integrity — dashed and underscored siblings', () => {
  const tmpRepo = join(tmpdir(), `monograph-file-identity-${Date.now()}`);

  afterAll(() => rmSync(tmpRepo, { recursive: true, force: true }));

  it('resolves every edge endpoint to a real node', async () => {
    // A fixture tree whose file AND folder names collide under the old
    // punctuation-collapsing scheme.
    mkdirSync(join(tmpRepo, 'src', 'a-b'), { recursive: true });
    mkdirSync(join(tmpRepo, 'src', 'a_b'), { recursive: true });
    writeFileSync(join(tmpRepo, 'src', 'a-b.ts'), 'export function fromDashed() { return 1; }\n');
    writeFileSync(join(tmpRepo, 'src', 'a_b.ts'), 'export function fromUnderscored() { return 2; }\n');
    writeFileSync(join(tmpRepo, 'src', 'a-b', 'leaf.ts'), 'export const dashedLeaf = 1;\n');
    writeFileSync(join(tmpRepo, 'src', 'a_b', 'leaf.ts'), 'export const underscoredLeaf = 2;\n');
    writeFileSync(join(tmpRepo, '.monographignore'), 'GRAPH_REPORT.md\n');

    await buildAsync(tmpRepo);

    const db = openDb(join(tmpRepo, '.monomind', 'monograph.db'));
    try {
      const nodeIds = new Set(
        (db.prepare('SELECT id FROM nodes').all() as { id: string }[]).map((n) => n.id),
      );
      const edges = db.prepare('SELECT id, source_id, target_id, relation FROM edges').all() as {
        id: string;
        source_id: string;
        target_id: string;
        relation: string;
      }[];

      expect(edges.length).toBeGreaterThan(0);
      const dangling = edges.filter(
        (e) => !nodeIds.has(e.source_id) || !nodeIds.has(e.target_id),
      );
      expect(dangling).toEqual([]);

      // All four files survived as distinct File nodes — under the old scheme the
      // two pairs collapsed to one node each.
      const filePaths = (
        db.prepare("SELECT file_path FROM nodes WHERE label = 'File'").all() as {
          file_path: string | null;
        }[]
      ).map((r) => r.file_path);
      for (const rel of ['src/a-b.ts', 'src/a_b.ts', 'src/a-b/leaf.ts', 'src/a_b/leaf.ts']) {
        expect(filePaths).toContain(rel);
      }

      // A File node's ID is what its containment edges actually reference.
      // (Only File->symbol CONTAINS edges are persisted: the structure phase's
      // folder nodes and folder->file edges are used as a work list and never
      // written to the DB — pre-existing behaviour, unrelated to node identity.)
      const containsSources = new Set(
        (
          db.prepare("SELECT source_id FROM edges WHERE relation = 'CONTAINS'").all() as {
            source_id: string;
          }[]
        ).map((r) => r.source_id),
      );
      expect(containsSources.has(fileId('src/a-b.ts'))).toBe(true);
      expect(containsSources.has(fileId('src/a_b.ts'))).toBe(true);
    } finally {
      closeDb(db);
    }
  }, 120_000);
});
