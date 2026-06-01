/**
 * Core graph package tests
 *
 * Covers: buildGraph, godNodes, cohesionScore, splitOversizedCommunities,
 * suggestQuestions (LOW_COHESION fix), graphDiff, collectFiles, corpusHealth.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import Graph from 'graphology';
import { buildGraph } from '../src/build.js';
import { godNodes, graphStats, buildAnalysis, suggestQuestions, graphDiff } from '../src/analyze.js';
import { cohesionScore, splitOversizedCommunities } from '../src/cluster.js';
import { corpusHealth } from '../src/detect.js';
import { loadGraph } from '../src/export.js';
import { walk } from '../src/extract/tree-sitter-runner.js';
import type { ExtractionResult, ClassifiedFile, SerializedGraph } from '../src/types.js';
import type { SyntaxNodeLike } from '../src/extract/tree-sitter-runner.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeExtraction(
  nodes: Array<{ id: string; label?: string; community?: number }>,
  edges: Array<{ source: string; target: string; relation?: string }>,
): ExtractionResult {
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      label: n.label ?? n.id,
      fileType: 'code',
      sourceFile: `src/${n.id}.ts`,
      ...(n.community !== undefined ? { community: n.community } : {}),
    })),
    edges: edges.map(e => ({
      source: e.source,
      target: e.target,
      relation: e.relation ?? 'imports',
      confidence: 'EXTRACTED' as const,
    })),
    filesProcessed: nodes.length,
    fromCache: 0,
    errors: [],
  };
}

// ── buildGraph ────────────────────────────────────────────────────────────────

describe('buildGraph', () => {
  it('adds all nodes', () => {
    const g = buildGraph(makeExtraction([{ id: 'A' }, { id: 'B' }], []));
    expect(g.order).toBe(2);
    expect(g.hasNode('A')).toBe(true);
    expect(g.hasNode('B')).toBe(true);
  });

  it('adds edges', () => {
    const g = buildGraph(makeExtraction([{ id: 'A' }, { id: 'B' }], [{ source: 'A', target: 'B' }]));
    expect(g.size).toBe(1);
    expect(g.hasEdge('A', 'B')).toBe(true);
  });

  it('skips self-loops', () => {
    const g = buildGraph(makeExtraction([{ id: 'A' }], [{ source: 'A', target: 'A' }]));
    expect(g.size).toBe(0);
  });

  it('deduplicates nodes by id', () => {
    const extraction: ExtractionResult = {
      nodes: [
        { id: 'A', label: 'first', fileType: 'code', sourceFile: 'a.ts' },
        { id: 'A', label: 'second', fileType: 'code', sourceFile: 'a.ts' },
      ],
      edges: [],
      filesProcessed: 1,
      fromCache: 0,
      errors: [],
    };
    const g = buildGraph(extraction);
    expect(g.order).toBe(1);
  });

  it('stubs unknown edge endpoints as external nodes', () => {
    const g = buildGraph(makeExtraction([{ id: 'A' }], [{ source: 'A', target: 'UNKNOWN' }]));
    expect(g.hasNode('UNKNOWN')).toBe(true);
    expect(g.getNodeAttribute('UNKNOWN', 'fileType')).toBe('unknown');
  });

  it('bumps weight on duplicate edges instead of throwing', () => {
    const ext: ExtractionResult = {
      nodes: [
        { id: 'A', label: 'A', fileType: 'code', sourceFile: 'a.ts' },
        { id: 'B', label: 'B', fileType: 'code', sourceFile: 'b.ts' },
      ],
      edges: [
        { source: 'A', target: 'B', relation: 'imports', confidence: 'EXTRACTED' },
        { source: 'A', target: 'B', relation: 'imports', confidence: 'EXTRACTED' },
      ],
      filesProcessed: 2,
      fromCache: 0,
      errors: [],
    };
    const g = buildGraph(ext);
    expect(g.size).toBe(1);
    const edge = g.edge('A', 'B');
    expect(g.getEdgeAttribute(edge, 'weight')).toBe(2);
  });
});

// ── godNodes ──────────────────────────────────────────────────────────────────

describe('godNodes', () => {
  it('returns nodes sorted by degree descending', () => {
    const g = buildGraph(makeExtraction(
      [{ id: 'hub' }, { id: 'leaf1' }, { id: 'leaf2' }, { id: 'leaf3' }],
      [
        { source: 'leaf1', target: 'hub' },
        { source: 'leaf2', target: 'hub' },
        { source: 'leaf3', target: 'hub' },
      ],
    ));
    const top = godNodes(g, 5);
    expect(top[0].id).toBe('hub');
    expect(top[0].degree).toBe(3);
  });

  it('respects topN limit', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}` }));
    const g = buildGraph(makeExtraction(nodes, []));
    expect(godNodes(g, 3)).toHaveLength(3);
  });

  it('returns empty array for empty graph', () => {
    const g = new Graph();
    expect(godNodes(g, 10)).toHaveLength(0);
  });
});

// ── cohesionScore ─────────────────────────────────────────────────────────────

describe('cohesionScore', () => {
  it('returns 1.0 when all edges are internal', () => {
    const g = buildGraph(makeExtraction(
      [{ id: 'A' }, { id: 'B' }],
      [{ source: 'A', target: 'B' }],
    ));
    expect(cohesionScore(g, ['A', 'B'])).toBe(1.0);
  });

  it('returns 0.0 when all edges are external', () => {
    const g = buildGraph(makeExtraction(
      [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      [{ source: 'A', target: 'C' }, { source: 'B', target: 'C' }],
    ));
    // Community {A,B}: both edges go to C (external)
    expect(cohesionScore(g, ['A', 'B'])).toBe(0);
  });

  it('returns 1.0 for a community with no edges', () => {
    const g = buildGraph(makeExtraction([{ id: 'A' }, { id: 'B' }], []));
    expect(cohesionScore(g, ['A', 'B'])).toBe(1.0);
  });
});

// ── splitOversizedCommunities — Math.max spread bug ───────────────────────────

describe('splitOversizedCommunities', () => {
  it('does not throw for very large number of communities', () => {
    const g = new Graph();
    // Create enough communities to exceed the ~100k spread limit
    const communities: Record<number, string[]> = {};
    for (let i = 0; i < 200_000; i++) {
      g.addNode(`n${i}`);
      communities[i] = [`n${i}`];
    }
    expect(() => splitOversizedCommunities(g, communities, 0.5)).not.toThrow();
  });

  it('assigns nextId above the highest existing community id', () => {
    const g = new Graph();
    ['a','b','c','d','e'].forEach(id => g.addNode(id));
    // Community 100 has 5 members, threshold 0.25 of 5 = 1.25 → any community >1 is "oversized"
    const communities = { 100: ['a','b','c','d','e'] };
    // Should not throw and should return some communities
    const result = splitOversizedCommunities(g, communities, 0.25);
    expect(Object.keys(result).length).toBeGreaterThanOrEqual(1);
    // All new community IDs must be > 100
    const ids = Object.keys(result).map(Number);
    expect(Math.min(...ids)).toBeGreaterThanOrEqual(100);
  });
});

// ── suggestQuestions — LOW_COHESION edge counting fix ─────────────────────────

describe('suggestQuestions', () => {
  it('detects low-cohesion communities with odd cross-edge counts', () => {
    // Build a graph: community 0 = {A,B}, community 1 = {C}
    // Edges: A→B (internal), A→C, B→C, A→C again... but graph is multi:false
    // So: 1 internal edge (A→B), 2 cross edges (A→C, B→C) → ratio 2/3 ≈ 0.67 < 0.7
    // With 3 cross edges (add B→D where D is community 2): ratio 3/4 = 0.75 > 0.7
    const g = buildGraph(makeExtraction(
      [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
      [
        { source: 'A', target: 'B' }, // internal (comm 0)
        { source: 'A', target: 'C' }, // cross
        { source: 'B', target: 'C' }, // cross
        { source: 'B', target: 'D' }, // cross
      ],
    ));
    g.setNodeAttribute('A', 'community', 0);
    g.setNodeAttribute('B', 'community', 0);
    g.setNodeAttribute('C', 'community', 1);
    g.setNodeAttribute('D', 'community', 2);

    // Community 0: 1 internal, 3 cross → ratio = 3/4 = 0.75 > 0.7 → should flag
    const questions = suggestQuestions(g, { 0: ['A', 'B'], 1: ['C'], 2: ['D'] });
    const lowCohesion = questions.filter(q => q.type === 'LOW_COHESION_COMMUNITY');
    expect(lowCohesion.some(q => q.nodes.includes('A') || q.nodes.includes('B'))).toBe(true);
  });
});

// ── graphDiff ─────────────────────────────────────────────────────────────────

describe('graphDiff', () => {
  const makeSerial = (
    nodes: string[],
    links: Array<{ source: string; target: string; relation?: string }>,
  ): SerializedGraph => ({
    version: '1',
    builtAt: new Date().toISOString(),
    projectPath: '/test',
    nodes: nodes.map(id => ({ id })),
    links: links.map(l => ({ source: l.source, target: l.target, relation: l.relation ?? 'imports' })),
    directed: true,
    multigraph: false,
  });

  it('detects added and removed nodes', () => {
    const before = makeSerial(['A', 'B'], []);
    const after = makeSerial(['A', 'C'], []);
    const diff = graphDiff(before, after);
    expect(diff.addedNodes).toContain('C');
    expect(diff.removedNodes).toContain('B');
    expect(diff.addedNodes).not.toContain('A');
  });

  it('detects added and removed edges', () => {
    const before = makeSerial(['A', 'B', 'C'], [{ source: 'A', target: 'B' }]);
    const after = makeSerial(['A', 'B', 'C'], [{ source: 'A', target: 'C' }]);
    const diff = graphDiff(before, after);
    expect(diff.addedEdges).toHaveLength(1);
    expect(diff.addedEdges[0].target).toBe('C');
    expect(diff.removedEdges[0].target).toBe('B');
  });

  it('returns empty diff for identical graphs', () => {
    const g = makeSerial(['A', 'B'], [{ source: 'A', target: 'B' }]);
    const diff = graphDiff(g, g);
    expect(diff.addedNodes).toHaveLength(0);
    expect(diff.removedNodes).toHaveLength(0);
    expect(diff.addedEdges).toHaveLength(0);
    expect(diff.removedEdges).toHaveLength(0);
  });
});

// ── corpusHealth ──────────────────────────────────────────────────────────────

describe('corpusHealth', () => {
  const makeFiles = (count: number, sizeEach = 5000, fileType: 'code' | 'document' = 'code'): ClassifiedFile[] =>
    Array.from({ length: count }, (_, i) => ({
      path: `/src/file${i}.ts`,
      fileType,
      language: 'typescript',
      sizeBytes: sizeEach,
    }));

  it('warns when corpus has fewer than 5 code files', () => {
    const warnings = corpusHealth(makeFiles(3));
    expect(warnings.some(w => w.includes('very small'))).toBe(true);
  });

  it('warns for very small total size', () => {
    const files = makeFiles(10, 100); // 10 files × 100 bytes = 1KB total
    const warnings = corpusHealth(files);
    expect(warnings.some(w => w.includes('total size is very small'))).toBe(true);
  });

  it('warns for very large corpus', () => {
    const files = makeFiles(10, 6_000_000); // 60MB
    const warnings = corpusHealth(files);
    expect(warnings.some(w => w.includes('very large'))).toBe(true);
  });

  it('returns no warnings for healthy corpus', () => {
    const codeFiles = makeFiles(20, 10_000, 'code');
    const docFiles = makeFiles(5, 2_000, 'document');
    const warnings = corpusHealth([...codeFiles, ...docFiles]);
    expect(warnings).toHaveLength(0);
  });
});

// ── graphStats ────────────────────────────────────────────────────────────────

describe('graphStats', () => {
  it('reports correct node and edge counts', () => {
    const g = buildGraph(makeExtraction(
      [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      [{ source: 'A', target: 'B' }, { source: 'B', target: 'C' }],
    ));
    const stats = graphStats(g);
    expect(stats.nodes).toBe(3);
    expect(stats.edges).toBe(2);
  });

  it('counts communities correctly', () => {
    const g = buildGraph(makeExtraction([{ id: 'A' }, { id: 'B' }], []));
    g.setNodeAttribute('A', 'community', 0);
    g.setNodeAttribute('B', 'community', 1);
    const stats = graphStats(g);
    expect(stats.communities).toBe(2);
  });
});

// ── export / loadGraph ────────────────────────────────────────────────────────

describe('loadGraph', () => {
  it('throws a clear error for malformed JSON missing nodes array', () => {
    const p = join(tmpdir(), `test-graph-${Date.now()}.json`);
    writeFileSync(p, JSON.stringify({ directed: true }));
    expect(() => loadGraph(p)).toThrow(/Malformed graph\.json/);
    unlinkSync(p);
  });

  it('throws a clear error when links is not an array', () => {
    const p = join(tmpdir(), `test-graph-${Date.now()}.json`);
    writeFileSync(p, JSON.stringify({ directed: true, nodes: [], links: 'bad' }));
    expect(() => loadGraph(p)).toThrow(/Malformed graph\.json/);
    unlinkSync(p);
  });
});

// ── walk leave callback ───────────────────────────────────────────────────────

describe('walk leave callback', () => {
  function makeNode(type: string, children: SyntaxNodeLike[] = []): SyntaxNodeLike {
    return { type, text: type, startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, children, childForFieldName: () => null, descendantsOfType: () => [] };
  }

  it('calls leave after all children are visited', () => {
    const order: string[] = [];
    const root = makeNode('root', [makeNode('child1'), makeNode('child2')]);
    walk(root, (n) => order.push(`enter:${n.type}`), (n) => order.push(`leave:${n.type}`));
    expect(order).toEqual(['enter:root','enter:child1','leave:child1','enter:child2','leave:child2','leave:root']);
  });

  it('stack pushed in enter is popped in leave — no cross-sibling leak', () => {
    const stack: string[] = [];
    const root = makeNode('class', [makeNode('method', [makeNode('call')])]);
    walk(root,
      (n) => { stack.push(n.type); },
      (n) => { expect(stack[stack.length-1]).toBe(n.type); stack.pop(); }
    );
    expect(stack).toHaveLength(0);
  });
});
