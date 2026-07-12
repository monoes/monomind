import { describe, it, expect } from 'vitest';
import { detectDeadCode, detectDeadCodeNodes, formatDeadCode } from '../../graph/dead-code.js';
import { openDb } from '../../storage/db.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'monograph-deadcode-test-'));
  return openDb(join(dir, 'test.db'));
}

function insertFileNode(db: Database.Database, filePath: string) {
  const id = filePath.replace(/[/.]/g, '_') + '_file';
  db.prepare(`INSERT INTO nodes (id, label, name, norm_label, file_path, is_exported) VALUES (?, 'File', ?, ?, ?, 0)`)
    .run(id, filePath.split('/').pop(), filePath.split('/').pop(), filePath);
  return id;
}

function insertFunction(db: Database.Database, name: string, filePath: string, opts?: { exported?: boolean; startLine?: number }) {
  const id = filePath.replace(/[/.]/g, '_') + '_' + name + '_function';
  const fileId = filePath.replace(/[/.]/g, '_') + '_file';
  db.prepare(`INSERT INTO nodes (id, label, name, norm_label, file_path, start_line, is_exported) VALUES (?, 'Function', ?, ?, ?, ?, ?)`)
    .run(id, name, name.toLowerCase(), filePath, opts?.startLine ?? 1, opts?.exported ? 1 : 0);
  // CONTAINS edge from File → Function
  db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'CONTAINS', 'EXTRACTED', 1.0)`)
    .run(`${fileId}_${id}_contains`, fileId, id);
  return id;
}

function insertCallEdge(db: Database.Database, src: string, tgt: string) {
  db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'CALLS', 'EXTRACTED', 1.0)`)
    .run(`${src}_${tgt}_calls`, src, tgt);
}

function insertReExportEdge(db: Database.Database, srcFileId: string, tgtFileId: string) {
  db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'RE_EXPORTS', 'INFERRED', 0.8)`)
    .run(`${srcFileId}_${tgtFileId}_reexports`, srcFileId, tgtFileId);
}

describe('detectDeadCode', () => {
  it('returns empty array for empty graph', () => {
    const db = makeTempDb();
    expect(detectDeadCode(db)).toEqual([]);
    db.close();
  });

  it('does NOT flag non-exported functions', () => {
    const db = makeTempDb();
    insertFileNode(db, 'src/utils.ts');
    insertFunction(db, 'helper', 'src/utils.ts', { exported: false });
    expect(detectDeadCode(db)).toEqual([]);
    db.close();
  });

  it('flags exported function with no inbound edges', () => {
    const db = makeTempDb();
    insertFileNode(db, 'src/utils.ts');
    const id = insertFunction(db, 'unused', 'src/utils.ts', { exported: true });
    expect(detectDeadCode(db)).toContain(id);
    db.close();
  });

  it('does NOT flag functions with CALLS edges', () => {
    const db = makeTempDb();
    insertFileNode(db, 'src/a.ts');
    insertFileNode(db, 'src/b.ts');
    const callerId = insertFunction(db, 'caller', 'src/a.ts', { exported: true });
    const calleeId = insertFunction(db, 'callee', 'src/b.ts', { exported: true });
    insertCallEdge(db, callerId, calleeId);
    const result = detectDeadCode(db);
    expect(result).not.toContain(calleeId);
    db.close();
  });

  it('skips test files', () => {
    const db = makeTempDb();
    insertFileNode(db, 'src/__tests__/foo.test.ts');
    insertFunction(db, 'testHelper', 'src/__tests__/foo.test.ts', { exported: true });
    expect(detectDeadCode(db)).toEqual([]);
    db.close();
  });

  it('skips dist files', () => {
    const db = makeTempDb();
    insertFileNode(db, 'packages/foo/dist/utils.ts');
    insertFunction(db, 'built', 'packages/foo/dist/utils.ts', { exported: true });
    expect(detectDeadCode(db)).toEqual([]);
    db.close();
  });

  it('skips index files', () => {
    const db = makeTempDb();
    insertFileNode(db, 'src/index.ts');
    insertFunction(db, 'main', 'src/index.ts', { exported: true });
    expect(detectDeadCode(db)).toEqual([]);
    db.close();
  });

  it('does NOT suppress on a same-name coincidence alone (no real edge)', () => {
    // Regression test for P2-18(a): the old suppression matched on NAME EQUALITY
    // anywhere in the codebase, so a genuinely-dead `shared()` in a.ts was hidden
    // just because an unrelated `shared` also existed in b.ts. With no actual
    // RE_EXPORTS/IMPORTS edge between them, the candidate must still be flagged.
    const db = makeTempDb();
    insertFileNode(db, 'src/a.ts');
    insertFileNode(db, 'src/b.ts');
    const id = insertFunction(db, 'shared', 'src/a.ts', { exported: true });
    insertFunction(db, 'shared', 'src/b.ts', { exported: false });
    expect(detectDeadCode(db)).toContain(id);
    db.close();
  });

  it('does NOT suppress on same-name-in-index.ts alone (no real RE_EXPORTS edge)', () => {
    // Regression test for P2-18(a): a function sharing a name with something
    // index.ts happens to also define is not the same as being re-exported by it.
    const db = makeTempDb();
    insertFileNode(db, 'src/utils.ts');
    insertFileNode(db, 'src/index.ts');
    const id = insertFunction(db, 'helper', 'src/utils.ts', { exported: true });
    insertFunction(db, 'helper', 'src/index.ts', { exported: true });
    expect(detectDeadCode(db)).toContain(id);
    db.close();
  });

  it('skips functions re-exported through a REAL RE_EXPORTS edge from a barrel', () => {
    const db = makeTempDb();
    const utilsFileId = insertFileNode(db, 'src/utils.ts');
    const indexFileId = insertFileNode(db, 'src/index.ts');
    insertFunction(db, 'helper', 'src/utils.ts', { exported: true });
    // Actual barrel edge: src/index.ts RE_EXPORTS src/utils.ts's File node.
    insertReExportEdge(db, indexFileId, utilsFileId);
    expect(detectDeadCode(db)).toEqual([]);
    db.close();
  });
});

describe('detectDeadCodeNodes', () => {
  it('returns structured nodes with file path and line', () => {
    const db = makeTempDb();
    insertFileNode(db, 'src/utils.ts');
    insertFunction(db, 'unused', 'src/utils.ts', { exported: true, startLine: 42 });
    const nodes = detectDeadCodeNodes(db);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      name: 'unused',
      filePath: 'src/utils.ts',
      startLine: 42,
      label: 'Function',
    });
    db.close();
  });
});

describe('formatDeadCode', () => {
  it('returns "none detected" for empty list', () => {
    expect(formatDeadCode([])).toBe('Dead code: none detected.');
  });

  it('includes candidate count and file locations', () => {
    const result = formatDeadCode([{
      id: 'test_id',
      name: 'unused',
      filePath: 'src/utils.ts',
      startLine: 42,
      label: 'Function',
    }]);
    expect(result).toContain('1 exported function');
    expect(result).toContain('src/utils.ts:42');
    expect(result).toContain('Candidates only');
    expect(result).not.toContain('lacks cross-file');
  });
});
