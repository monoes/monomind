/**
 * SubGraph Composition Tests — Task 48
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { compile } from '../../packages/@monobrain/hooks/src/subgraph/subgraph-compiler.js';
import { SubGraphRegistry } from '../../packages/@monobrain/hooks/src/subgraph/subgraph-registry.js';
import { validateKeyContracts, compose } from '../../packages/@monobrain/hooks/src/subgraph/subgraph-composer.js';
import type { CompiledSubGraph } from '../../packages/@monobrain/hooks/src/subgraph/types.js';

/** Helper to create a minimal CompiledSubGraph for composer tests */
function makeCompiled(overrides: Partial<CompiledSubGraph> & { subGraphId: string }): CompiledSubGraph {
  return {
    version: 1,
    category: 'test',
    agentCount: 2,
    edgeCount: 1,
    inputKeys: [],
    outputKeys: [],
    compiledAt: new Date().toISOString(),
    checksum: 'abc',
    raw: {
      id: overrides.subGraphId,
      version: 1,
      name: 'test',
      description: 'test',
      category: 'test',
      agents: [],
      internalEdges: [],
      inputKeys: [],
      outputKeys: [],
      defaultCoordinator: 'node-0',
      maxConcurrentAgents: 2,
    },
    ...overrides,
  };
}

// ── validateKeyContracts ──

describe('validateKeyContracts', () => {
  it('passes when outputKeys satisfy downstream inputKeys', () => {
    const sg1 = makeCompiled({ subGraphId: 'sg1', outputKeys: ['result', 'data'] });
    const sg2 = makeCompiled({ subGraphId: 'sg2', inputKeys: ['result'] });

    expect(() => validateKeyContracts([sg1, sg2])).not.toThrow();
  });

  it('throws when an inputKey is unsatisfied', () => {
    const sg1 = makeCompiled({ subGraphId: 'sg1', outputKeys: ['result'] });
    const sg2 = makeCompiled({ subGraphId: 'sg2', inputKeys: ['missing-key'] });

    expect(() => validateKeyContracts([sg1, sg2])).toThrow(/missing-key/);
  });

  it('does not validate the first subgraph inputKeys', () => {
    const sg1 = makeCompiled({ subGraphId: 'sg1', inputKeys: ['external-context'], outputKeys: ['data'] });
    const sg2 = makeCompiled({ subGraphId: 'sg2', inputKeys: ['data'] });

    expect(() => validateKeyContracts([sg1, sg2])).not.toThrow();
  });
});

// ── compose ──

describe('compose', () => {
  it('creates connection edges for sequential mode', () => {
    const sg1 = makeCompiled({ subGraphId: 'sg1', outputKeys: ['x'] });
    const sg2 = makeCompiled({ subGraphId: 'sg2', inputKeys: ['x'], outputKeys: ['y'] });
    const sg3 = makeCompiled({ subGraphId: 'sg3', inputKeys: ['y'] });

    const topo = compose([sg1, sg2, sg3], 'sequential', 'merge');

    expect(topo.connectionEdges).toHaveLength(2);
    expect(topo.connectionEdges[0].sourceNodeId).toBe('sg1');
    expect(topo.connectionEdges[0].targetNodeId).toBe('sg2');
    expect(topo.connectionEdges[1].sourceNodeId).toBe('sg2');
    expect(topo.connectionEdges[1].targetNodeId).toBe('sg3');
    expect(topo.connectionEdges[0].type).toBe('sequential');
  });

  it('creates no edges for parallel mode', () => {
    const sg1 = makeCompiled({ subGraphId: 'sg1' });
    const sg2 = makeCompiled({ subGraphId: 'sg2' });

    const topo = compose([sg1, sg2], 'parallel', 'merge');

    expect(topo.connectionEdges).toHaveLength(0);
    expect(topo.topology).toBe('parallel');
  });

  it('throws for fewer than 2 subgraphs', () => {
    const sg1 = makeCompiled({ subGraphId: 'sg1' });

    expect(() => compose([sg1], 'sequential', 'merge')).toThrow(/At least 2/);
  });

  it('throws for sequential with violated key contracts', () => {
    const sg1 = makeCompiled({ subGraphId: 'sg1', outputKeys: [] });
    const sg2 = makeCompiled({ subGraphId: 'sg2', inputKeys: ['needed'] });

    expect(() => compose([sg1, sg2], 'sequential', 'merge')).toThrow(/needed/);
  });
});

// ── SubGraphRegistry ──

describe('SubGraphRegistry', () => {
  beforeEach(() => {
    SubGraphRegistry.resetInstance();
  });

  it('registers and retrieves latest', () => {
    const registry = SubGraphRegistry.getInstance();
    const compiled = makeCompiled({ subGraphId: 'sg1', version: 1 });

    registry.register(compiled);
    const latest = registry.getLatest('sg1');

    expect(latest).toBeDefined();
    expect(latest!.subGraphId).toBe('sg1');
  });

  it('tracks multiple versions', () => {
    const registry = SubGraphRegistry.getInstance();
    const v1 = makeCompiled({ subGraphId: 'sg1', version: 1, checksum: 'aaa' });
    const v2 = makeCompiled({ subGraphId: 'sg1', version: 2, checksum: 'bbb' });

    registry.register(v1);
    registry.register(v2);

    expect(registry.listVersions('sg1')).toHaveLength(2);
    expect(registry.getLatest('sg1')!.version).toBe(2);
    expect(registry.getVersion('sg1', 1)!.version).toBe(1);
  });

  it('hasChanged returns true when checksum differs', () => {
    const registry = SubGraphRegistry.getInstance();
    const v1 = makeCompiled({ subGraphId: 'sg1', checksum: 'aaa' });
    registry.register(v1);

    const v2 = makeCompiled({ subGraphId: 'sg1', checksum: 'bbb' });
    expect(registry.hasChanged(v2)).toBe(true);
  });

  it('hasChanged returns false when checksum is the same', () => {
    const registry = SubGraphRegistry.getInstance();
    const v1 = makeCompiled({ subGraphId: 'sg1', checksum: 'same' });
    registry.register(v1);

    const v2 = makeCompiled({ subGraphId: 'sg1', checksum: 'same' });
    expect(registry.hasChanged(v2)).toBe(false);
  });
});

// ── SubGraphCompiler ──

describe('compile', () => {
  it('produces correct agentCount', () => {
    const result = compile(['architect', 'coder', 'tester']);
    expect(result.agentCount).toBe(3);
  });

  it('generates a SHA-256 checksum', () => {
    const result = compile(['architect', 'coder']);
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('auto-detects coordinator from slug containing "architect"', () => {
    const result = compile(['coder', 'system-architect', 'tester']);
    const coordinator = result.raw.agents.find((a) => a.role === 'coordinator');

    expect(coordinator).toBeDefined();
    expect(coordinator!.agentSlug).toBe('system-architect');
  });

  it('auto-detects coordinator from slug containing "coordinator"', () => {
    const result = compile(['coder', 'swarm-coordinator', 'tester']);
    const coordinator = result.raw.agents.find((a) => a.role === 'coordinator');

    expect(coordinator).toBeDefined();
    expect(coordinator!.agentSlug).toBe('swarm-coordinator');
  });

  it('falls back to first agent as coordinator if no match', () => {
    const result = compile(['coder', 'tester', 'reviewer']);
    const coordinator = result.raw.agents.find((a) => a.role === 'coordinator');

    expect(coordinator).toBeDefined();
    expect(coordinator!.agentSlug).toBe('coder');
  });
});
