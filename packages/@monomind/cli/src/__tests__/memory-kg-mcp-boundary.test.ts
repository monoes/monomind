// packages/@monomind/cli/src/__tests__/memory-kg-mcp-boundary.test.ts
// K8 regression: the public MCP boundary must declare and validate the real
// nested payload BEFORE anything is written, and must report what it dropped.
//
// The schema used to declare nodes/edges/rules as bare `{type:'object'}` and
// cast them to `any[]`. Consequences: an invalid item at index 3 failed only
// after items 0-2 had already been persisted (a partial graph the caller was
// never told about), and a payload above the per-call caps was silently sliced
// by kgIngest so "40 nodes" and "500 of 900 nodes" reported identically.
//
// K3 (origin attribution) is covered here too: two different tasks must ingest
// under two different origin refs, otherwise rolling one back withdraws the
// other's work. The store itself is mocked — this file is about what the
// boundary hands the store, not about what the store then does with it.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const kgIngest = vi.fn();
const kgIngestRules = vi.fn();
const heuristicExtract = vi.fn();

vi.mock('../memory/memory-kg.js', () => ({
  kgIngest,
  kgIngestRules,
  heuristicExtract,
  kgSearch: vi.fn(),
  kgRollback: vi.fn(),
  kgStats: vi.fn(),
  kgGlossary: vi.fn(),
}));

const okGraph = {
  success: true,
  nodesAdded: 0,
  nodesMerged: 0,
  edgesAdded: 0,
  edgesMerged: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  kgIngest.mockResolvedValue({ ...okGraph });
  kgIngestRules.mockResolvedValue({ success: true, verdicts: [], accepted: 0 });
  heuristicExtract.mockReturnValue({ nodes: [], edges: [] });
});

async function ingest(params: Record<string, unknown>) {
  const { memoryKgIngest } = await import('../mcp-tools/memory-tools.js');
  return (await memoryKgIngest.handler(params)) as Record<string, any>;
}

describe('memory_kg_ingest boundary validation (K8)', () => {
  it('declares the real nested item shape instead of a bare object', async () => {
    const { memoryKgIngest } = await import('../mcp-tools/memory-tools.js');
    const props = memoryKgIngest.inputSchema.properties as Record<string, any>;

    // A caller (or an LLM reading the schema) must be able to see which fields
    // exist and which are mandatory, not just "some object".
    expect(props.nodes.items.properties).toHaveProperty('name');
    expect(props.nodes.items.required).toContain('name');
    expect(props.edges.items.required).toEqual(
      expect.arrayContaining(['source', 'target', 'relation']),
    );
    expect(props.rules.items.required).toContain('rule');
  });

  it('rejects an invalid nested payload before writing anything — no partial graph', async () => {
    const res = await ingest({
      originRef: 'run-1',
      nodes: [
        { name: 'Alpha' },
        { name: 'Beta' },
        { name: 'Gamma' },
        { type: 'Service', description: 'no name at all' }, // index 3: invalid
      ],
    });

    expect(res.success).toBe(false);
    expect(res.rejected).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'nodes', index: 3 })]),
    );
    // The whole point: the three valid nodes ahead of it were NOT written.
    expect(kgIngest).not.toHaveBeenCalled();
  });

  it('rejects a malformed edge relation before writing anything', async () => {
    const res = await ingest({
      originRef: 'run-1',
      nodes: [{ name: 'A' }, { name: 'B' }],
      edges: [
        { source: 'A', target: 'B', relation: 'causes' },
        { source: 'A', target: 'B' },
      ],
    });

    expect(res.success).toBe(false);
    expect(res.rejected?.[0]).toMatchObject({ field: 'edges', index: 1 });
    expect(kgIngest).not.toHaveBeenCalled();
  });

  it('rejects a non-array nodes value instead of silently treating it as empty', async () => {
    const res = await ingest({ originRef: 'run-1', nodes: { name: 'Alpha' } });
    expect(res.success).toBe(false);
    expect(res.rejected?.[0]).toMatchObject({ field: 'nodes' });
    expect(kgIngest).not.toHaveBeenCalled();
  });

  it('reports what an over-cap payload dropped rather than silently slicing it', async () => {
    const nodes = Array.from({ length: 620 }, (_, i) => ({ name: `Entity ${i}` }));
    const res = await ingest({ originRef: 'run-1', nodes });

    expect(res.success).toBe(true);
    expect(res.truncated).toMatchObject({ nodes: 120 });
    expect(res.accepted).toMatchObject({ nodes: 500 });
    expect(kgIngest.mock.calls[0][0].nodes).toHaveLength(500);
  });

  it('reports accepted counts so "all stored" is distinguishable from "some dropped"', async () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({ name: `Entity ${i}` }));
    const res = await ingest({ originRef: 'run-1', nodes });

    expect(res.accepted).toMatchObject({ nodes: 40 });
    expect(res.truncated).toBeUndefined();
  });

  it('does not report success when the rule half of the ingest failed', async () => {
    kgIngestRules.mockResolvedValue({
      success: false,
      verdicts: [{ rule: 'Always run the tests', verdict: 'accepted' }],
      accepted: 0,
      failures: ['rule rule:always_run_the_tests: refused'],
      error: '1 write refused',
    });

    const res = await ingest({
      originRef: 'run-1',
      rules: [{ rule: 'Always run the tests before pushing' }],
    });

    // K1: an aggregate `accepted: 0` alongside an `accepted` verdict must not
    // be flattened into a generic success by the MCP layer.
    expect(res.success).toBe(false);
    expect(res.rules.accepted).toBe(0);
    expect(res.rules.failures).toBeTruthy();
  });
});

describe('origin refs are unique per operation (K3)', () => {
  it('gives two causal-edge assertions two different origin refs', async () => {
    const { memoryCausalEdge } = await import('../mcp-tools/memory-tools.js');

    await memoryCausalEdge.handler({
      sourceId: 'flaky-test',
      targetId: 'ci-timeout',
      relation: 'causes',
    });
    await memoryCausalEdge.handler({
      sourceId: 'stale-cache',
      targetId: 'build-failure',
      relation: 'causes',
    });

    const first = kgIngest.mock.calls[0][0].originRef as string;
    const second = kgIngest.mock.calls[1][0].originRef as string;
    expect(first).not.toBe(second);
    // Re-asserting the SAME edge must reuse its ref, so a rollback still
    // targets exactly that assertion.
    await memoryCausalEdge.handler({
      sourceId: 'flaky-test',
      targetId: 'ci-timeout',
      relation: 'causes',
    });
    expect(kgIngest.mock.calls[2][0].originRef).toBe(first);
  });

  it('gives two post-task hooks two different origin refs', async () => {
    const { hooksPostTask: postTask } = await import('../mcp-tools/hooks-routing.js');

    await postTask.handler({ taskId: 'task-alpha', success: true });
    await postTask.handler({ taskId: 'task-beta', success: true });

    const refs = kgIngest.mock.calls.map((c: any[]) => c[0].originRef as string);
    expect(refs).toHaveLength(2);
    expect(refs[0]).not.toBe(refs[1]);
    expect(refs[0]).toContain('task-alpha');
    expect(refs[1]).toContain('task-beta');
  });
});
