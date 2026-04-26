/**
 * Tests for Communication Flows as Explicit Graph Edges (Task 40).
 *
 * 16 tests covering CommunicationGraph, FlowEnforcer, and flow visualizers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CommunicationGraph } from '../../packages/@monomind/cli/src/swarm/communication-graph.js';
import { FlowEnforcer } from '../../packages/@monomind/cli/src/swarm/flow-enforcer.js';
import { toAscii, toDOT } from '../../packages/@monomind/cli/src/swarm/flow-visualizer.js';
import type { FlowEdge } from '../../packages/@monomind/shared/src/types/communication-flow.js';

/* ------------------------------------------------------------------ */
/*  CommunicationGraph                                                 */
/* ------------------------------------------------------------------ */

describe('CommunicationGraph', () => {
  const edges: FlowEdge[] = [
    ['coordinator', 'coder'],
    ['coordinator', 'tester'],
    ['coder', 'tester'],
    ['tester', 'reviewer'],
  ];

  let graph: CommunicationGraph;

  beforeEach(() => {
    graph = new CommunicationGraph(edges);
  });

  it('isAuthorized returns true for a declared edge', () => {
    expect(graph.isAuthorized('coordinator', 'coder')).toBe(true);
  });

  it('isAuthorized returns false for an undeclared edge', () => {
    expect(graph.isAuthorized('coder', 'coordinator')).toBe(false);
  });

  it('empty flows = unrestricted (all authorized)', () => {
    const unrestricted = new CommunicationGraph([]);
    expect(unrestricted.isAuthorized('any', 'other')).toBe(true);
    expect(unrestricted.isAuthorized('x', 'y')).toBe(true);
  });

  it('getTargets returns correct outbound slugs', () => {
    const targets = graph.getTargets('coordinator');
    expect(targets).toEqual(expect.arrayContaining(['coder', 'tester']));
    expect(targets).toHaveLength(2);
  });

  it('getSources returns correct inbound slugs', () => {
    const sources = graph.getSources('tester');
    expect(sources).toEqual(expect.arrayContaining(['coordinator', 'coder']));
    expect(sources).toHaveLength(2);
  });

  it('hasCycles returns true for A -> B -> C -> A cycle', () => {
    const cyclic = new CommunicationGraph([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
    ]);
    expect(cyclic.hasCycles()).toBe(true);
  });

  it('hasCycles returns false for acyclic graph', () => {
    expect(graph.hasCycles()).toBe(false);
  });

  it('allEdges returns all declared edges', () => {
    expect(graph.allEdges()).toEqual(edges);
  });

  it('directional: A -> B authorized does NOT mean B -> A authorized', () => {
    const directed = new CommunicationGraph([['A', 'B']]);
    expect(directed.isAuthorized('A', 'B')).toBe(true);
    expect(directed.isAuthorized('B', 'A')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  FlowEnforcer                                                       */
/* ------------------------------------------------------------------ */

describe('FlowEnforcer', () => {
  const edges: FlowEdge[] = [
    ['coordinator', 'coder'],
    ['coder', 'tester'],
  ];

  it('authorized message returns { authorized: true }', () => {
    const graph = new CommunicationGraph(edges);
    const enforcer = new FlowEnforcer(graph, 'swarm-1', true);
    const result = enforcer.checkAndRecord('coordinator', 'coder', 'start coding');
    expect(result.authorized).toBe(true);
    expect(result.violation).toBeUndefined();
  });

  it('unauthorized + enforce=false returns authorized:true with violation action=logged', () => {
    const graph = new CommunicationGraph(edges);
    const enforcer = new FlowEnforcer(graph, 'swarm-1', false);
    const result = enforcer.checkAndRecord('tester', 'coordinator', 'hey boss');
    expect(result.authorized).toBe(true);
    expect(result.violation).toBeDefined();
    expect(result.violation!.action).toBe('logged');
    expect(result.violation!.fromAgentSlug).toBe('tester');
    expect(result.violation!.toAgentSlug).toBe('coordinator');
  });

  it('unauthorized + enforce=true returns authorized:false with violation action=blocked', () => {
    const graph = new CommunicationGraph(edges);
    const enforcer = new FlowEnforcer(graph, 'swarm-1', true);
    const result = enforcer.checkAndRecord('tester', 'coordinator', 'blocked msg');
    expect(result.authorized).toBe(false);
    expect(result.violation).toBeDefined();
    expect(result.violation!.action).toBe('blocked');
  });

  it('getViolations returns recorded violations', () => {
    const graph = new CommunicationGraph(edges);
    const enforcer = new FlowEnforcer(graph, 'swarm-1', true);

    enforcer.checkAndRecord('tester', 'coordinator', 'msg-1');
    enforcer.checkAndRecord('coder', 'coordinator', 'msg-2');

    const violations = enforcer.getViolations();
    expect(violations).toHaveLength(2);
    expect(violations[0].swarmId).toBe('swarm-1');
    expect(violations[1].messagePreview).toBe('msg-2');
  });
});

/* ------------------------------------------------------------------ */
/*  Flow Visualizer                                                    */
/* ------------------------------------------------------------------ */

describe('Flow Visualizer', () => {
  const edges: FlowEdge[] = [
    ['coordinator', 'coder'],
    ['coder', 'tester'],
  ];

  it('toAscii contains "from --> to" for each edge', () => {
    const output = toAscii(edges);
    expect(output).toContain('coordinator --> coder');
    expect(output).toContain('coder --> tester');
  });

  it('toAscii with empty edges shows "unrestricted"', () => {
    const output = toAscii([]);
    expect(output.toLowerCase()).toContain('unrestricted');
  });

  it('toDOT produces valid DOT syntax', () => {
    const output = toDOT(edges, 'test_flow');
    expect(output).toContain('digraph test_flow {');
    expect(output).toContain('"coordinator" -> "coder"');
    expect(output).toContain('"coder" -> "tester"');
    expect(output).toContain('}');
  });
});
