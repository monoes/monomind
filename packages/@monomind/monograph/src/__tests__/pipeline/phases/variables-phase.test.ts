import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { variablesPhase } from '../../../pipeline/phases/variables-phase.js';
import type { PipelineContext } from '../../../pipeline/types.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, name TEXT NOT NULL,
      norm_label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER,
      community_id INTEGER, is_exported INTEGER DEFAULT 0,
      language TEXT, properties TEXT
    );
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

describe('variablesPhase', () => {
  it('has name "variables" and deps ["parse"]', () => {
    expect(variablesPhase.name).toBe('variables');
    expect(variablesPhase.deps).toContain('parse');
  });

  it('inserts Variable nodes for exported consts', async () => {
    const db = makeDb();
    const parseOutput = {
      allEdges: [],
      symbolNodes: [],
      parseErrors: [],
      fileContents: new Map([
        ['/tmp/app.ts', 'export const API_URL = "https://example.com";\nconst SECRET = "x";'],
      ]),
    };
    const deps = new Map([['parse', parseOutput]]);
    await variablesPhase.execute(makeCtx(db), deps);
    const rows = db.prepare('SELECT name, is_exported FROM nodes WHERE label = ?').all('Variable');
    const names = (rows as any[]).map((r: any) => r.name);
    expect(names).toContain('API_URL');
  });

  it('returns variableCount', async () => {
    const db = makeDb();
    const parseOutput = {
      allEdges: [],
      symbolNodes: [],
      parseErrors: [],
      fileContents: new Map([
        ['/tmp/b.ts', 'export const X = 1;\nexport const Y = 2;'],
      ]),
    };
    const deps = new Map([['parse', parseOutput]]);
    const result = await variablesPhase.execute(makeCtx(db), deps);
    expect((result as any).variableCount).toBeGreaterThanOrEqual(2);
  });

  it('skips files with no variables gracefully', async () => {
    const db = makeDb();
    const parseOutput = {
      allEdges: [],
      symbolNodes: [],
      parseErrors: [],
      fileContents: new Map([['/tmp/empty.ts', '// no vars here']]),
    };
    const deps = new Map([['parse', parseOutput]]);
    await expect(variablesPhase.execute(makeCtx(db), deps)).resolves.not.toThrow();
  });
});
