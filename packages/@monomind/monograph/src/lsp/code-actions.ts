import type { LspRange } from './code-lens.js';

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

export interface LspWorkspaceEdit {
  changes: Record<string, LspTextEdit[]>;
}

export interface CodeAction {
  title: string;
  kind: 'quickfix' | 'refactor';
  diagnostics?: string[];
  edit?: LspWorkspaceEdit;
  isPreferred?: boolean;
}

export interface UnusedExportLocation {
  exportName: string;
  filePath: string;
  uri: string;
  line: number;         // 1-based
  col: number;
}

export type ExportKeywordVariant = 'export' | 'export default' | 'export const' | 'export function' | 'export class' | 'export type' | 'export interface' | 'export enum';

function detectExportVariant(sourceLine: string): { prefix: string; start: number } | null {
  const variants = [
    'export default ',
    'export const ',
    'export function ',
    'export class ',
    'export abstract class ',
    'export interface ',
    'export type ',
    'export enum ',
    'export ',
  ];
  const trimmed = sourceLine.trimStart();
  const indent = sourceLine.length - trimmed.length;
  for (const v of variants) {
    if (trimmed.startsWith(v)) {
      return { prefix: v, start: indent };
    }
  }
  return null;
}

export function buildRemoveExportActions(
  unusedExports: UnusedExportLocation[],
  cursorLine: number,   // 0-based LSP
  fileLines: string[],
  maxActionsPerFile = 10,
): CodeAction[] {
  const actions: CodeAction[] = [];
  const inRange = unusedExports.filter(e => e.line - 1 === cursorLine);
  for (const ue of inRange.slice(0, maxActionsPerFile)) {
    const sourceLine = fileLines[ue.line - 1] ?? '';
    const variant = detectExportVariant(sourceLine);
    if (!variant) continue;
    const removeRange: LspRange = {
      start: { line: ue.line - 1, character: variant.start },
      end:   { line: ue.line - 1, character: variant.start + variant.prefix.length },
    };
    actions.push({
      title: `Remove 'export' from '${ue.exportName}'`,
      kind: 'quickfix',
      isPreferred: true,
      edit: {
        changes: {
          [ue.uri]: [{ range: removeRange, newText: '' }],
        },
      },
    });
  }
  return actions;
}

export function buildSuppressActions(
  unusedExports: UnusedExportLocation[],
  cursorLine: number,   // 0-based LSP
  fileLines: string[],
): CodeAction[] {
  const actions: CodeAction[] = [];
  const inRange = unusedExports.filter(e => e.line - 1 === cursorLine);
  for (const ue of inRange) {
    const targetLine = ue.line - 1;  // 0-based
    const sourceLine = fileLines[targetLine] ?? '';
    const indent = sourceLine.length - sourceLine.trimStart().length;
    const suppressComment = ' '.repeat(indent) + '// monograph-ignore\n';
    const insertRange: LspRange = {
      start: { line: targetLine, character: 0 },
      end:   { line: targetLine, character: 0 },
    };
    actions.push({
      title: `Suppress monograph warning for '${ue.exportName}'`,
      kind: 'quickfix',
      edit: {
        changes: {
          [ue.uri]: [{ range: insertRange, newText: suppressComment }],
        },
      },
    });
  }
  return actions;
}
