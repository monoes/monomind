export interface LspPosition {
  line: number;       // 0-based
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspCommand {
  title: string;
  command: string;
  arguments?: unknown[];
}

export interface MonographCodeLens {
  range: LspRange;
  command?: LspCommand;
}

export interface ExportUsage {
  exportName: string;
  line: number;      // 1-based
  col: number;       // 1-based
  referenceLocations: Array<{ uri: string; line: number; character: number }>;
}

export function buildCodeLenses(
  usages: ExportUsage[],
  documentUri: string,
): MonographCodeLens[] {
  return usages.map(usage => {
    const lspLine = usage.line - 1;  // 1-based → 0-based
    const lspCol  = usage.col  - 1;
    const range: LspRange = {
      start: { line: lspLine, character: lspCol },
      end:   { line: lspLine, character: lspCol + usage.exportName.length },
    };
    const refCount = usage.referenceLocations.length;
    if (refCount === 0) {
      return {
        range,
        command: { title: '0 references', command: 'monograph.noop' },
      };
    }
    return {
      range,
      command: {
        title: `${refCount} reference${refCount === 1 ? '' : 's'}`,
        command: 'editor.action.showReferences',
        arguments: [documentUri, { line: lspLine, character: lspCol }, usage.referenceLocations],
      },
    };
  });
}
