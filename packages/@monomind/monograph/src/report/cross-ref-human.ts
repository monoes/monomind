import { relative } from 'node:path';

export type CrossRefDeadCodeKind =
  | { type: 'unused-file' }
  | { type: 'unused-export'; exportName: string }
  | { type: 'unused-type'; typeName: string };

export interface CrossRefHumanFinding {
  cloneFile: string;
  startLine: number;
  endLine: number;
  deadCodeKind: CrossRefDeadCodeKind;
  groupIndex: number;
}

export interface CrossRefHumanResult {
  findings: CrossRefHumanFinding[];
  clonesInUnusedFiles: number;
  clonesWithUnusedExports: number;
}

function rel(p: string, root: string): string { return relative(root, p); }

function deadCodeReason(kind: CrossRefDeadCodeKind): string {
  if (kind.type === 'unused-file') return 'entire file is unused';
  if (kind.type === 'unused-export') return `export '${kind.exportName}' is unused`;
  return `type '${(kind as { type: 'unused-type'; typeName: string }).typeName}' is unused`;
}

export function buildCrossReferenceLines(result: CrossRefHumanResult, root: string): string[] {
  if (result.findings.length === 0) return [];
  const lines: string[] = [
    '',
    '● Duplicated + Unused (safe to delete)',
    '',
  ];
  for (const f of result.findings) {
    const location = `${rel(f.cloneFile, root)}:${f.startLine}-${f.endLine}`;
    lines.push(`  ${location} (${deadCodeReason(f.deadCodeKind)})`);
  }
  lines.push('');
  return lines;
}

export function printCrossReferenceFindings(result: CrossRefHumanResult, root: string, quiet = false): void {
  if (result.findings.length === 0 || quiet) return;
  for (const line of buildCrossReferenceLines(result, root)) console.log(line);
  const { findings: { length: total }, clonesInUnusedFiles: files, clonesWithUnusedExports: exports_ } = result;
  console.error(`  ${total} combined finding(s): ${files} in unused file(s), ${exports_} overlapping unused export(s)`);
}
