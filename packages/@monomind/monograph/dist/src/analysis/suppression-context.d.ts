export type IssueKind = 'unused-file' | 'unused-export' | 'unused-type' | 'private-type-leak' | 'unused-dependency' | 'unused-dev-dependency' | 'unused-enum-member' | 'unused-class-member' | 'unresolved-import' | 'unlisted-dependency' | 'duplicate-export' | 'code-duplication' | 'circular-dependency' | 'type-only-dependency' | 'test-only-dependency' | 'boundary-violation' | 'coverage-gaps' | 'feature-flag' | 'complexity' | 'stale-suppression';
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
export declare class SuppressionContext {
    private readonly byFile;
    constructor(modules: Array<{
        filePath: string;
        suppressions: Suppression[];
    }>);
    isSuppressed(filePath: string, line: number, kind: IssueKind): boolean;
    isFileSuppressed(filePath: string, kind: IssueKind): boolean;
    get(filePath: string): Suppression[] | undefined;
    usedCount(): number;
    findStale(): StaleSuppression[];
}
export declare function isSuppressed(suppressions: Suppression[], line: number, kind: IssueKind): boolean;
export declare function isFileSuppressed(suppressions: Suppression[], kind: IssueKind): boolean;
//# sourceMappingURL=suppression-context.d.ts.map