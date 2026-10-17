import type { PipelinePhase } from '../types.js';

/** SQL predicate: `col` is the path of a test file. */
export function testPathSql(col: string): string {
  return `(${col} LIKE '%.test.%' OR ${col} LIKE '%.spec.%' OR ${col} LIKE '%/__tests__/%' OR ${col} LIKE '%/tests/%' OR ${col} LIKE '%/test/%' OR ${col} LIKE '%\\_test.%' ESCAPE '\\' OR ${col} LIKE 'test\\_%' ESCAPE '\\')`;
}

/**
 * Derives `TESTS` edges — test File → the source it exercises — so an agent can
 * ask "what covers this?" and "what should I run after changing it?":
 *  - a test file that IMPORTS a non-test file tests that file (INFERRED: an
 *    import shows the test touches the file, not that it asserts anything);
 *  - a test-file function that CALLS a non-test symbol tests that symbol.
 * Always rebuilt from scratch from the committed IMPORTS/CALLS edges, so it can
 * never drift from them.
 */
export const testsEdgesPhase: PipelinePhase<{ edges: number }> = {
  name: 'tests-edges',
  deps: ['stale-sweep'],
  async execute(ctx) {
    const db = ctx.db;
    db.exec("DELETE FROM edges WHERE relation = 'TESTS'");

    db.exec(`
      INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, reason)
      SELECT 'tests:' || s.id || '>' || t.id, s.id, t.id, 'TESTS', 'INFERRED', 0.7,
             'test file imports this file'
      FROM edges e
      JOIN nodes s ON s.id = e.source_id AND s.label = 'File'
      JOIN nodes t ON t.id = e.target_id AND t.label = 'File'
      WHERE e.relation = 'IMPORTS'
        AND ${testPathSql('s.file_path')} AND NOT ${testPathSql('t.file_path')}`);

    // Resolves the calling function to its test File node by path.
    db.exec(`
      INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, reason)
      SELECT 'tests:' || f.id || '>' || t.id, f.id, t.id, 'TESTS', 'INFERRED', 0.9,
             'test code calls this symbol'
      FROM edges e
      JOIN nodes s ON s.id = e.source_id
      JOIN nodes f ON f.label = 'File' AND f.file_path = s.file_path
      JOIN nodes t ON t.id = e.target_id
      WHERE e.relation = 'CALLS' AND t.label != 'File'
        AND ${testPathSql('s.file_path')} AND NOT ${testPathSql('t.file_path')}`);

    const { n } = db.prepare("SELECT COUNT(*) AS n FROM edges WHERE relation = 'TESTS'").get() as {
      n: number;
    };
    return { edges: n };
  },
};
