import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { surprisesPhase } from '../../../pipeline/phases/surprises.js';
import type { PipelineContext } from '../../../pipeline/types.js';

function makeCtx(db: Database.Database): PipelineContext {
  return { repoPath: '/tmp', db, graph: {} as any, options: { ignore: [], codeOnly: false } as any, onProgress: () => {} } as any;
}

describe('surprises 5-factor scoring', () => {
  it('cross-filetype edges score higher than same-filetype', async () => {
    // Labels are uniform (all 'Function') and all in same community so that
    // crossType and crossCommunity bonuses are equal for both edges.
    // The only differentiator is file type: e1 crosses CODE→DOCUMENT, e2 stays CODE→CODE.
    const parseOutput = {
      allEdges: [
        { id: 'e1', sourceId: 'n1', targetId: 'n2', relation: 'REFERENCES', confidence: 'INFERRED', confidenceScore: 0.5 },
        { id: 'e2', sourceId: 'n3', targetId: 'n4', relation: 'REFERENCES', confidence: 'INFERRED', confidenceScore: 0.5 },
      ],
      symbolNodes: [
        { id: 'n1', label: 'Function', name: 'doStuff', filePath: '/src/a.ts', isExported: true, normLabel: 'function' },
        { id: 'n2', label: 'Function', name: 'readme', filePath: '/docs/README.md', isExported: false, normLabel: 'function' },
        { id: 'n3', label: 'Function', name: 'doOther', filePath: '/src/b.ts', isExported: true, normLabel: 'function' },
        { id: 'n4', label: 'Function', name: 'helper', filePath: '/src/c.ts', isExported: true, normLabel: 'function' },
      ],
      parseErrors: [], fileContents: new Map(),
    };
    const crossFileOutput = { resolvedEdges: [], importGraph: new Map() };
    // All nodes in same community so crossCommunity bonus is equal (zero) for both edges
    const communitiesOutput = { memberships: new Map([['n1', 0], ['n2', 0], ['n3', 0], ['n4', 0]]) };

    const db = new Database(':memory:');
    const deps = new Map([
      ['parse', parseOutput],
      ['cross-file', crossFileOutput],
      ['communities', communitiesOutput],
    ]);

    const result = await surprisesPhase.execute(makeCtx(db), deps);
    const crossType = result.surprises.find(s => s.edge.id === 'e1');
    const sameType = result.surprises.find(s => s.edge.id === 'e2');
    expect(crossType).toBeDefined();
    expect(sameType).toBeDefined();
    expect(crossType!.score).toBeGreaterThan(sameType!.score);
  });
});
