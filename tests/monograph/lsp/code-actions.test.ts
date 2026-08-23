import { describe, expect, it } from 'vitest';
import type { UnusedExportLocation } from '../../../packages/@monomind/monograph/src/lsp/code-actions.ts';
import {
  buildDeleteFileActions,
  buildRemoveExportActions,
  buildSuppressActions,
} from '../../../packages/@monomind/monograph/src/lsp/code-actions.ts';

const fileLines = [
  'import { something } from "./dep";', // line 1 (index 0)
  '', // line 2
  'export function unusedHelper() {', // line 3
  '  return 42;', // line 4
  '}', // line 5
  '', // line 6
  'export const VALUE = 10;', // line 7
  '  export default class Foo {}', // line 8 (indented)
];

describe('buildRemoveExportActions', () => {
  it('returns empty when cursor is not on an unused export line', () => {
    const exports: UnusedExportLocation[] = [
      {
        exportName: 'unusedHelper',
        filePath: 'test.ts',
        uri: 'file:///test.ts',
        line: 3,
        col: 1,
      },
    ];
    const actions = buildRemoveExportActions(exports, 0, fileLines);
    expect(actions).toEqual([]);
  });

  it('removes "export function " prefix on matching line', () => {
    const exports: UnusedExportLocation[] = [
      {
        exportName: 'unusedHelper',
        filePath: 'test.ts',
        uri: 'file:///test.ts',
        line: 3,
        col: 1,
      },
    ];
    const actions = buildRemoveExportActions(exports, 2, fileLines);
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toContain('unusedHelper');
    expect(actions[0].kind).toBe('quickfix');
    expect(actions[0].isPreferred).toBe(true);
    const edit = actions[0].edit?.changes['file:///test.ts'][0];
    expect(edit.newText).toBe('');
    expect(edit.range.start.character).toBe(0);
  });

  it('removes "export const " prefix', () => {
    const exports: UnusedExportLocation[] = [
      {
        exportName: 'VALUE',
        filePath: 'test.ts',
        uri: 'file:///test.ts',
        line: 7,
        col: 1,
      },
    ];
    const actions = buildRemoveExportActions(exports, 6, fileLines);
    expect(actions).toHaveLength(1);
    expect(actions[0].edit?.changes['file:///test.ts'][0].range.end.character).toBe(
      'export const '.length,
    );
  });

  it('handles indented export default', () => {
    const exports: UnusedExportLocation[] = [
      {
        exportName: 'Foo',
        filePath: 'test.ts',
        uri: 'file:///test.ts',
        line: 8,
        col: 3,
      },
    ];
    const actions = buildRemoveExportActions(exports, 7, fileLines);
    expect(actions).toHaveLength(1);
    expect(actions[0].edit?.changes['file:///test.ts'][0].range.start.character).toBe(2);
  });

  it('respects maxActionsPerFile', () => {
    const exports: UnusedExportLocation[] = Array.from({ length: 20 }, (_, i) => ({
      exportName: `fn${i}`,
      filePath: 'test.ts',
      uri: 'file:///test.ts',
      line: 3,
      col: 1,
    }));
    const actions = buildRemoveExportActions(exports, 2, fileLines, 3);
    expect(actions.length).toBeLessThanOrEqual(3);
  });
});

describe('buildSuppressActions', () => {
  it('inserts monograph-ignore comment above the export', () => {
    const exports: UnusedExportLocation[] = [
      {
        exportName: 'unusedHelper',
        filePath: 'test.ts',
        uri: 'file:///test.ts',
        line: 3,
        col: 1,
      },
    ];
    const actions = buildSuppressActions(exports, 2, fileLines);
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toContain('Suppress');
    expect(actions[0].title).toContain('unusedHelper');
    const edit = actions[0].edit?.changes['file:///test.ts'][0];
    expect(edit.newText).toContain('monograph-ignore');
    expect(edit.range.start.line).toBe(2);
    expect(edit.range.start.character).toBe(0);
  });

  it('preserves indentation in the suppress comment', () => {
    const exports: UnusedExportLocation[] = [
      {
        exportName: 'Foo',
        filePath: 'test.ts',
        uri: 'file:///test.ts',
        line: 8,
        col: 3,
      },
    ];
    const actions = buildSuppressActions(exports, 7, fileLines);
    const newText = actions[0].edit?.changes['file:///test.ts'][0].newText;
    expect(newText).toMatch(/^\s{2}\/\/ monograph-ignore\n$/);
  });
});

describe('buildDeleteFileActions', () => {
  it('returns a single delete-file action', () => {
    const actions = buildDeleteFileActions('src/utils/dead-code.ts');
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('deleteFile');
    expect(actions[0].filePath).toBe('src/utils/dead-code.ts');
    expect(actions[0].isPreferred).toBe(false);
  });

  it('uses basename in the title', () => {
    const actions = buildDeleteFileActions('src/deep/nested/file.ts');
    expect(actions[0].title).toContain('file.ts');
    expect(actions[0].title).not.toContain('deep/nested');
  });
});
