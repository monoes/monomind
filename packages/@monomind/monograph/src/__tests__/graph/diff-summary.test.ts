import { describe, it, expect } from 'vitest';
import { diffSnapshots, type GraphSnapshot } from '../../graph/diff.js';
import type { MonographNode, MonographEdge } from '../../types.js';

function node(id: string): MonographNode {
  return {
    id,
    label: 'function',
    name: id,
    normLabel: id,
    filePath: `${id}.ts`,
    startLine: 1,
    endLine: 10,
    communityId: 0,
    isExported: false,
    language: 'typescript',
    properties: {},
  } as MonographNode;
}

function edge(sourceId: string, targetId: string): MonographEdge {
  return { id: `${sourceId}->${targetId}`, sourceId, targetId, relation: 'imports' } as MonographEdge;
}

describe('GraphDiff.summary', () => {
  it('includes summary string in diff result', () => {
    const before: GraphSnapshot = { nodes: [node('a'), node('b')], edges: [], capturedAt: '' };
    const after: GraphSnapshot = { nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'c')], capturedAt: '' };
    const diff = diffSnapshots(before, after);
    expect(typeof diff.summary).toBe('string');
  });

  it('reports new nodes in summary', () => {
    const before: GraphSnapshot = { nodes: [node('a')], edges: [], capturedAt: '' };
    const after: GraphSnapshot = { nodes: [node('a'), node('b'), node('c')], edges: [], capturedAt: '' };
    const diff = diffSnapshots(before, after);
    expect(diff.summary).toMatch(/2 new node/);
  });

  it('reports removed nodes in summary', () => {
    const before: GraphSnapshot = { nodes: [node('a'), node('b')], edges: [], capturedAt: '' };
    const after: GraphSnapshot = { nodes: [node('a')], edges: [], capturedAt: '' };
    const diff = diffSnapshots(before, after);
    expect(diff.summary).toMatch(/1 node removed/);
  });

  it('reports new edges in summary', () => {
    const before: GraphSnapshot = { nodes: [node('a'), node('b')], edges: [], capturedAt: '' };
    const after: GraphSnapshot = { nodes: [node('a'), node('b')], edges: [edge('a', 'b')], capturedAt: '' };
    const diff = diffSnapshots(before, after);
    expect(diff.summary).toMatch(/1 new edge/);
  });

  it('reports removed edges in summary', () => {
    const before: GraphSnapshot = { nodes: [node('a'), node('b')], edges: [edge('a', 'b')], capturedAt: '' };
    const after: GraphSnapshot = { nodes: [node('a'), node('b')], edges: [], capturedAt: '' };
    const diff = diffSnapshots(before, after);
    expect(diff.summary).toMatch(/1 edge removed/);
  });

  it('returns "no changes" when graph is unchanged', () => {
    const snap: GraphSnapshot = { nodes: [node('a')], edges: [], capturedAt: '' };
    const diff = diffSnapshots(snap, snap);
    expect(diff.summary).toMatch(/no changes/i);
  });

  it('combines multiple changes in one summary', () => {
    const before: GraphSnapshot = {
      nodes: [node('a'), node('b')],
      edges: [edge('a', 'b')],
      capturedAt: '',
    };
    const after: GraphSnapshot = {
      nodes: [node('a'), node('c')],
      edges: [edge('a', 'c')],
      capturedAt: '',
    };
    const diff = diffSnapshots(before, after);
    // Should mention new node, removed node, new edge, removed edge
    expect(diff.summary.length).toBeGreaterThan(5);
    expect(typeof diff.summary).toBe('string');
  });
});
