import { describe, it, expect } from 'vitest';
import { buildMarkdownWithQuestions } from '../../src/reporting/graph-report.js';
import type { SuggestedQuestion } from '../../src/types.js';

describe('buildMarkdownWithQuestions', () => {
  it('renders Suggested Questions section when questions provided', () => {
    const questions: SuggestedQuestion[] = [
      { type: 'bridge_node', node: { id: 'n1', name: 'UserService', label: 'Class' } as any, commA: 0, commB: 1 },
      { type: 'ambiguous_edge', edge: { sourceId: 'n1', targetId: 'n2', confidence: 'AMBIGUOUS' } as any, reason: 'Dynamic dispatch' },
      { type: 'isolated_nodes', nodes: [{ id: 'n3', name: 'Orphan', label: 'Function' } as any], reason: 'No edges' },
    ];
    const md = buildMarkdownWithQuestions(1, 0, [], [], [], [], [], questions);
    expect(md).toContain('## Suggested Questions');
    expect(md).toContain('bridge_node');
    expect(md).toContain('UserService');
    expect(md).toContain('ambiguous_edge');
    expect(md).toContain('isolated_nodes');
    expect(md).toContain('Orphan');
  });

  it('omits Suggested Questions section when no questions', () => {
    const md = buildMarkdownWithQuestions(1, 0, [], [], [], [], [], []);
    expect(md).not.toContain('## Suggested Questions');
  });

  it('caps rendered questions at 20', () => {
    const questions: SuggestedQuestion[] = Array.from({ length: 25 }, (_, i) => ({
      type: 'ambiguous_edge' as const,
      edge: { sourceId: `n${i}`, targetId: `n${i}x`, confidence: 'AMBIGUOUS' } as any,
      reason: 'test',
    }));
    const md = buildMarkdownWithQuestions(1, 0, [], [], [], [], [], questions);
    const matches = md.match(/ambiguous_edge/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(20);
  });
});
