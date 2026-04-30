import { vi } from 'vitest';
import type { PipelineContext } from '../../src/pipeline/types.js';
import { godNodesPhase } from '../../src/pipeline/phases/god-nodes.js';
import { suggestPhase } from '../../src/pipeline/phases/suggest.js';

describe('god-nodes phase', () => {
  it('returns top nodes by degree, excluding File/Folder nodes', async () => {
    const ctx = { onProgress: vi.fn() } as unknown as PipelineContext;
    const deps = new Map<string, unknown>();
    deps.set('cross-file', {
      resolvedEdges: [
        { id: 'e1', sourceId: 'cls_a', targetId: 'fn_b', relation: 'CALLS', confidence: 'EXTRACTED', confidenceScore: 1.0 },
        { id: 'e2', sourceId: 'cls_a', targetId: 'fn_c', relation: 'CALLS', confidence: 'EXTRACTED', confidenceScore: 1.0 },
      ]
    });
    deps.set('parse', {
      symbolNodes: [
        { id: 'cls_a', label: 'Class', name: 'A', normLabel: 'a', isExported: true },
        { id: 'fn_b', label: 'Function', name: 'b', normLabel: 'b', isExported: false },
        { id: 'fn_c', label: 'Function', name: 'c', normLabel: 'c', isExported: false },
        { id: 'file_x', label: 'File', name: 'x.ts', normLabel: 'x.ts', isExported: false },
      ],
      allEdges: []
    });

    const result = await godNodesPhase.execute(ctx, deps) as { godNodes: unknown[] };
    const ids = result.godNodes.map((n: any) => n.id);
    expect(ids).toContain('cls_a');
    expect(ids).not.toContain('file_x');
  });
});

describe('suggest phase', () => {
  it('returns at least one signal type', async () => {
    const ctx = { onProgress: vi.fn() } as unknown as PipelineContext;
    const deps = new Map<string, unknown>();

    deps.set('parse', {
      symbolNodes: [
        { id: 'n1', label: 'Class', name: 'A', normLabel: 'a', isExported: false },
        { id: 'n2', label: 'Class', name: 'B', normLabel: 'b', isExported: false },
      ],
      allEdges: [{
        id: 'e1', sourceId: 'n1', targetId: 'n2',
        relation: 'CALLS', confidence: 'AMBIGUOUS', confidenceScore: 0.2
      }]
    });
    deps.set('cross-file', { resolvedEdges: [] });
    deps.set('mro', { mroEdges: [] });
    deps.set('communities', { memberships: new Map(), communityLabels: new Map() });
    deps.set('god-nodes', { godNodes: [] });
    deps.set('surprises', { surprises: [] });

    const result = await suggestPhase.execute(ctx, deps) as { questions: unknown[] };
    expect(result.questions.length).toBeGreaterThan(0);
    expect((result.questions[0] as any).type).toBe('ambiguous_edge');
  });
});
