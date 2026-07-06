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

  it('skips functions with same-name node in another file', () => {
    const db = makeTempDb();
    insertFileNode(db, 'src/a.ts');
    insertFileNode(db, 'src/b.ts');
    insertFunction(db, 'shared', 'src/a.ts', { exported: true });
    // Same name in another file (import binding)
    insertFunction(db, 'shared', 'src/b.ts', { exported: false });
    expect(detectDeadCode(db)).toEqual([]);
    db.close();
  });

  it('skips functions re-exported through barrel index', () => {
    const db = makeTempDb();
    insertFileNode(db, 'src/utils.ts');
    insertFileNode(db, 'src/index.ts');
    insertFunction(db, 'helper', 'src/utils.ts', { exported: true });
    // Same name in index.ts (barrel re-export)
    insertFunction(db, 'helper', 'src/index.ts', { exported: true });
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
