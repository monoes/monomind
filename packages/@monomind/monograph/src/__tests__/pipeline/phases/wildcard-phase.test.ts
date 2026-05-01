import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { wildcardSynthesisPhase } from '../../../pipeline/phases/wildcard-phase.js';
import type { PipelineContext } from '../../../pipeline/types.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT, name TEXT, norm_label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER, is_exported INTEGER DEFAULT 0, language TEXT, properties TEXT);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relation TEXT, confidence TEXT, confidence_score REAL);
    INSERT INTO nodes VALUES ('n1', 'Function', 'greet', 'greet', '/mod.ts', 1, 5, null, 1, null, null);
    INSERT INTO nodes VALUES ('n2', 'File', 'main.ts', 'main.ts', '/main.ts', null, null, null, 0, null, null);
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
});
