import { describe, expect, it } from 'vitest';
import type { ExportUsage } from '../../../packages/@monomind/monograph/src/lsp/code-lens.ts';
import { buildCodeLenses } from '../../../packages/@monomind/monograph/src/lsp/code-lens.ts';

describe('buildCodeLenses', () => {
  it('returns empty array for no usages', () => {
    expect(buildCodeLenses([], 'file:///test.ts')).toEqual([]);
  });

  it('creates "0 references" lens for unused export', () => {
    const usages: ExportUsage[] = [
      {
        exportName: 'myFn',
        line: 10,
        col: 8,
        referenceLocations: [],
      },
    ];
    const lenses = buildCodeLenses(usages, 'file:///test.ts');
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.title).toBe('0 references');
    expect(lenses[0].range.start.line).toBe(9);
    expect(lenses[0].range.start.character).toBe(7);
  });

  it('creates reference count lens with showReferences command', () => {
    const usages: ExportUsage[] = [
      {
        exportName: 'helper',
        line: 5,
        col: 1,
        referenceLocations: [
          { uri: 'file:///a.ts', line: 3, character: 10 },
          { uri: 'file:///b.ts', line: 7, character: 2 },
        ],
      },
    ];
    const lenses = buildCodeLenses(usages, 'file:///test.ts');
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.title).toBe('2 references');
    expect(lenses[0].command?.command).toBe('editor.action.showReferences');
  });

  it('uses singular "reference" for count of 1', () => {
    const usages: ExportUsage[] = [
      {
        exportName: 'single',
        line: 1,
        col: 1,
        referenceLocations: [{ uri: 'file:///x.ts', line: 1, character: 0 }],
      },
    ];
    const lenses = buildCodeLenses(usages, 'file:///test.ts');
    expect(lenses[0].command?.title).toBe('1 reference');
  });
});
