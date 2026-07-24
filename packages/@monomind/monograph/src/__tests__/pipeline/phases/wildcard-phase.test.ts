import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { wildcardSynthesisPhase } from '../../../pipeline/phases/wildcard-phase.js';
import type { PipelineContext } from '../../../pipeline/types.js';
import { CREATE_NODES, CREATE_EDGES } from '../../../storage/schema.js';

// Uses the REAL production schema (including the edges FK constraint on
// source_id/target_id) with foreign_keys actually enabled — the original
// hand-rolled test schema had neither, so it silently passed inserts that
// would violate the real edges table's FK constraint in production (issue #40).
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_NODES);
  db.exec(CREATE_EDGES);
  db.exec(`
    INSERT INTO nodes (id, label, name, norm_label, file_path, start_line, end_line, is_exported)
      VALUES ('n1', 'Function', 'greet', 'greet', '/mod.ts', 1, 5, 1);
    INSERT INTO nodes (id, label, name, norm_label, file_path, is_exported)
      VALUES ('n2', 'File', 'main.ts', 'main.ts', '/main.ts', 0);
  `);
  return db;
}

function makeCtx(db: Database.Database): PipelineContext {
  return {
    repoPath: '/tmp',
    db,
    graph: {} as any,
    options: { ignore: [], codeOnly: false } as any,
    onProgress: () => {},
  } as any;
}

describe('wildcardSynthesisPhase', () => {
  it('has name "wildcard-synthesis" and deps including "parse" and "cross-file"', () => {
    expect(wildcardSynthesisPhase.name).toBe('wildcard-synthesis');
    expect(wildcardSynthesisPhase.deps).toContain('parse');
    expect(wildcardSynthesisPhase.deps).toContain('cross-file');
  });

  it('synthesizes IMPORTS edges for wildcard namespace member accesses', async () => {
    const db = makeDb();
    const source = `import * as mod from '/mod.ts';\nmod.greet("hello");`;
    const parseOutput = {
      allEdges: [],
      symbolNodes: [
        { id: 'n1', name: 'greet', label: 'Function', normLabel: 'greet', filePath: '/mod.ts', isExported: true },
        { id: 'n2', name: 'main.ts', label: 'File', normLabel: 'main.ts', filePath: '/main.ts', isExported: false },
      ],
      parseErrors: [],
      fileContents: new Map([['/main.ts', source]]),
    };
    const crossFileOutput = { resolvedEdges: [] };
    const deps = new Map<string, any>([['parse', parseOutput], ['cross-file', crossFileOutput]]);
    const result = await wildcardSynthesisPhase.execute(makeCtx(db), deps);
    expect((result as any).synthesizedCount).toBeGreaterThanOrEqual(0);
  });

  it('runs without error when no wildcard imports exist', async () => {
    const db = makeDb();
    const parseOutput = {
      allEdges: [],
      symbolNodes: [],
      parseErrors: [],
      fileContents: new Map([['/main.ts', 'import { greet } from "./mod.js"; greet("hello");']]),
    };
    const crossFileOutput = { resolvedEdges: [] };
    const deps = new Map<string, any>([['parse', parseOutput], ['cross-file', crossFileOutput]]);
    await expect(wildcardSynthesisPhase.execute(makeCtx(db), deps)).resolves.not.toThrow();
  });

  it('skips a file with no fileNodeIndex entry instead of fabricating a source_id and violating the edges FK constraint (issue #40)', async () => {
    // Regression: a file with no parsed symbols (e.g. blank, or a filetype
    // the parser emits no node for) has no entry in fileNodeIndex. The old
    // code fell back to a fabricated `file:${filePath}` id that was never a
    // real row in `nodes`, so the edge insert below violated the edges
    // table's FOREIGN KEY constraint on source_id and crashed the whole
    // monograph_build. /empty.ts here is exactly that case: it's present in
    // fileContents (parsed) but has NO corresponding node in symbolNodes.
    const db = makeDb();
    const source = `import * as mod from '/mod.ts';\nmod.greet("hello");`;
    const parseOutput = {
      allEdges: [],
      symbolNodes: [
        { id: 'n1', name: 'greet', label: 'Function', normLabel: 'greet', filePath: '/mod.ts', isExported: true },
      ],
      parseErrors: [],
      fileContents: new Map([['/empty.ts', source]]),
    };
    const crossFileOutput = { resolvedEdges: [] };
    const deps = new Map<string, any>([['parse', parseOutput], ['cross-file', crossFileOutput]]);

    await expect(wildcardSynthesisPhase.execute(makeCtx(db), deps)).resolves.not.toThrow();

    const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
    expect(edgeCount).toBe(0); // nothing could legitimately attach to a file with no real node
  });
});
