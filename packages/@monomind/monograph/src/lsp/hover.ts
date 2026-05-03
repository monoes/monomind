import type { LspRange } from './code-lens.js';

export interface MonographHover {
  contents: string;   // Markdown
  range?: LspRange;
}

export interface UnusedExportInfo {
  exportName: string;
  line: number;       // 1-based
  col: number;
  referenceCount: number;
  suppressionHint?: string;
}

export interface DuplicationInfo {
  line: number;       // 1-based
  col: number;
  groupSize: number;
  instanceCount: number;
  similarityScore: number;
}

export function buildHover(
  unusedExports: UnusedExportInfo[],
  duplication: DuplicationInfo[],
  position: { line: number; character: number },  // 0-based LSP
  filePath: string,
): MonographHover | null {
  const lspLine = position.line;

  // Priority: unused export > duplication
  for (const ue of unusedExports) {
    if (ue.line - 1 === lspLine) {
      const lines = [
        `**Unused Export**: \`${ue.exportName}\``,
        '',
        `References found: **${ue.referenceCount}**`,
        '',
        ue.referenceCount === 0
          ? 'This export has no detected consumers outside the current file.'
          : 'This export may be consumed only internally.',
      ];
      if (ue.suppressionHint) lines.push('', `To suppress: ${ue.suppressionHint}`);
      return { contents: lines.join('\n') };
    }
  }

  for (const dup of duplication) {
    if (dup.line - 1 === lspLine) {
      const contents = [
        `**Code Duplication Detected**`,
        '',
        `- Clone group size: **${dup.groupSize}** instances`,
        `- Similarity: **${(dup.similarityScore * 100).toFixed(0)}%**`,
        '',
        'Consider extracting the duplicated logic into a shared function.',
      ].join('\n');
      return { contents };
    }
  }

  return null;
}
