export type IssueKind =
  | 'unused-file' | 'unused-export' | 'unused-type' | 'private-type-leak'
  | 'unused-dependency' | 'unused-dev-dependency' | 'unused-enum-member'
  | 'unused-class-member' | 'unresolved-import' | 'unlisted-dependency'
  | 'duplicate-export' | 'code-duplication' | 'circular-dependency'
  | 'type-only-dependency' | 'test-only-dependency' | 'boundary-violation'
  | 'coverage-gaps' | 'feature-flag' | 'complexity' | 'stale-suppression';

export interface Suppression {
  line: number;
  commentLine: number;
  kind: IssueKind | null;
}

export interface StaleSuppression {
  path: string;
  line: number;
  col: number;
  isFileLevel: boolean;
  issueKind: IssueKind | null;
}

const NON_CORE_KINDS: Set<IssueKind> = new Set([
  'complexity', 'coverage-gaps', 'feature-flag', 'code-duplication',
  'unused-dependency', 'unused-dev-dependency', 'unlisted-dependency',
  'type-only-dependency', 'test-only-dependency', 'stale-suppression',
]);

interface FileSuppressionRecord {
  suppressions: Suppression[];
  used: boolean[];
}

export class SuppressionContext {
  private readonly byFile: Map<string, FileSuppressionRecord>;

  constructor(modules: Array<{ filePath: string; suppressions: Suppression[] }>) {
    this.byFile = new Map();
    for (const m of modules) {
      if (m.suppressions.length > 0) {
        this.byFile.set(m.filePath, { suppressions: m.suppressions, used: new Array(m.suppressions.length).fill(false) });
      }
    }
  }

  isSuppressed(filePath: string, line: number, kind: IssueKind): boolean {
    const rec = this.byFile.get(filePath);
    if (!rec) return false;
    for (let i = 0; i < rec.suppressions.length; i++) {
      const s = rec.suppressions[i];
      const matched = s.line === 0 ? (s.kind === null || s.kind === kind) : (s.line === line && (s.kind === null || s.kind === kind));
      if (matched) { rec.used[i] = true; return true; }
    }
    return false;
  }

  isFileSuppressed(filePath: string, kind: IssueKind): boolean {
    const rec = this.byFile.get(filePath);
    if (!rec) return false;
    for (let i = 0; i < rec.suppressions.length; i++) {
      const s = rec.suppressions[i];
      if (s.line === 0 && (s.kind === null || s.kind === kind)) { rec.used[i] = true; return true; }
    }
    return false;
  }

  get(filePath: string): Suppression[] | undefined { return this.byFile.get(filePath)?.suppressions; }

  usedCount(): number {
    let n = 0;
    for (const rec of this.byFile.values()) n += rec.used.filter(Boolean).length;
    return n;
  }

  findStale(): StaleSuppression[] {
    const stale: StaleSuppression[] = [];
    for (const [filePath, rec] of this.byFile) {
      for (let i = 0; i < rec.suppressions.length; i++) {
        if (rec.used[i]) continue;
        const s = rec.suppressions[i];
        if (s.kind !== null && NON_CORE_KINDS.has(s.kind)) continue;
        stale.push({ path: filePath, line: s.commentLine, col: 0, isFileLevel: s.line === 0, issueKind: s.kind });
      }
    }
    return stale;
  }
}

export function isSuppressed(suppressions: Suppression[], line: number, kind: IssueKind): boolean {
  return suppressions.some(s => s.line === 0 ? (s.kind === null || s.kind === kind) : (s.line === line && (s.kind === null || s.kind === kind)));
}

export function isFileSuppressed(suppressions: Suppression[], kind: IssueKind): boolean {
  return suppressions.some(s => s.line === 0 && (s.kind === null || s.kind === kind));
}
