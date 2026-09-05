import Database from 'better-sqlite3';
import louvain from 'graphology-communities-louvain';
import { describe, expect, it } from 'vitest';
import { loadGraphFromEdges } from '../../../graph/loader.js';
import {
  CLUSTERING_RELATION_WEIGHTS,
  communitiesPhase,
  loadClusteringEdges,
} from '../../../pipeline/phases/communities.js';
import type { PipelineContext } from '../../../pipeline/types.js';
import { CREATE_COMMUNITIES, CREATE_EDGES, CREATE_NODES } from '../../../storage/schema.js';
import type { MonographEdge } from '../../../types.js';

/**
 * Two files whose ONLY meaningful link is a *resolved* call: `a.ts::run` calls
 * `b.ts::helper`. That CALLS edge is written straight to the `edges` table by
 * the scope-resolution phase and never appears in `parse` or `cross-file`
 * phase output — which is exactly the gap this fixture exists to prove.
 */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_NODES);
  db.exec(CREATE_EDGES);
  db.exec(CREATE_COMMUNITIES);
  db.exec(`
    INSERT INTO nodes (id, label, name, norm_label, file_path, is_exported) VALUES
      ('a.ts', 'File', 'a.ts', 'a.ts', 'a.ts', 0),
      ('a.ts::fn::run', 'Function', 'run', 'run', 'a.ts', 1),
      ('b.ts', 'File', 'b.ts', 'b.ts', 'b.ts', 0),
      ('b.ts::fn::helper', 'Function', 'helper', 'helper', 'b.ts', 1);
  `);
  return db;
}

/** The edges the parse phase emits and inserts: containment only, per file. */
const PARSE_EDGES: MonographEdge[] = [
  {
    id: 'e-contains-a',
    sourceId: 'a.ts',
    targetId: 'a.ts::fn::run',
    relation: 'CONTAINS',
    confidence: 'EXTRACTED',
    confidenceScore: 1,
  },
  {
    id: 'e-contains-b',
    sourceId: 'b.ts',
    targetId: 'b.ts::fn::helper',
    relation: 'CONTAINS',
    confidence: 'EXTRACTED',
    confidenceScore: 1,
  },
];

function seedEdges(db: Database.Database): void {
  const insert = db.prepare(
    'INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const e of PARSE_EDGES) {
    insert.run(e.id, e.sourceId, e.targetId, e.relation, e.confidence, e.confidenceScore);
  }
  // Written by scope-resolution directly into the DB — no phase output carries it.
  insert.run('e-calls-resolved', 'a.ts::fn::run', 'b.ts::fn::helper', 'CALLS', 'EXTRACTED', 0.75);
}

function makeCtx(db: Database.Database): PipelineContext {
  return {
    repoPath: '/tmp',
    db,
    graph: {} as never,
    options: { ignore: [], codeOnly: false } as never,
    onProgress: () => {},
  } as unknown as PipelineContext;
}

describe('communitiesPhase clustering input', () => {
  it('the old input (parse + cross-file output) has no edge between the two files', () => {
    // Baseline that makes this test discriminating: clustering the phase outputs
    // the old implementation consumed leaves `run` and `helper` in separate
    // components, because the resolved CALLS edge is not in either output.
    const legacyInput: MonographEdge[] = [...PARSE_EDGES /* cross-file resolvedEdges: none */];
    expect(
      legacyInput.some(
        (e) =>
          (e.sourceId === 'a.ts::fn::run' && e.targetId === 'b.ts::fn::helper') ||
          (e.sourceId === 'b.ts::fn::helper' && e.targetId === 'a.ts::fn::run'),
      ),
    ).toBe(false);

    const legacyCommunities = louvain(loadGraphFromEdges(legacyInput), { randomWalk: false });
    expect(legacyCommunities['a.ts::fn::run']).not.toBe(legacyCommunities['b.ts::fn::helper']);
  });

  it('loads resolved CALLS edges that only exist in the committed graph', () => {
    const db = makeDb();
    seedEdges(db);

    const edges = loadClusteringEdges(db);
    const resolvedCall = edges.find(
      (e) => e.sourceId === 'a.ts::fn::run' && e.targetId === 'b.ts::fn::helper',
    );
    expect(resolvedCall).toBeDefined();
    expect(resolvedCall?.weight).toBe(CLUSTERING_RELATION_WEIGHTS.CALLS);
  });

  it('puts two files linked only by a resolved call in the same community', async () => {
    const db = makeDb();
    seedEdges(db);

    const result = await communitiesPhase.execute(makeCtx(db), new Map());

    expect(result.memberships.get('a.ts::fn::run')).toBeDefined();
    expect(result.memberships.get('a.ts::fn::run')).toBe(
      result.memberships.get('b.ts::fn::helper'),
    );

    // And the assignment is persisted to the canonical graph.
    const rows = db
      .prepare("SELECT id, community_id FROM nodes WHERE id LIKE '%::fn::%'")
      .all() as Array<{ id: string; community_id: number | null }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].community_id).toBe(rows[1].community_id);
  });

  it('excludes relation families that are not evidence of coupling', () => {
    const db = makeDb();
    db.prepare(
      'INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('e-ref', 'a.ts', 'b.ts', 'REFERENCES', 'INFERRED', 0.5);

    expect(loadClusteringEdges(db)).toHaveLength(0);
  });

  it('declares deps on every phase that writes a clustering relation', () => {
    for (const dep of ['scope-resolution', 'bridge-resolver', 'wildcard-synthesis', 'mro']) {
      expect(communitiesPhase.deps).toContain(dep);
    }
  });
});
