export type FallowIssueKind = 'unused-file' | 'unused-export' | 'unused-type' | 'private-type-leak' | 'unused-dependency' | 'unused-dev-dependency' | 'unused-enum-member' | 'unused-class-member' | 'unresolved-import' | 'unlisted-dependency' | 'duplicate-export' | 'code-duplication' | 'circular-dependency' | 'type-only-dependency' | 'test-only-dependency' | 'boundary-violation' | 'coverage-gaps' | 'feature-flag' | 'complexity' | 'stale-suppression';
export interface FallowSuppression {
    line: number;
    commentLine: number;
    kind: FallowIssueKind | null;
}
export declare function parseFallowIssueKind(s: string): FallowIssueKind | undefined;
export declare function issueKindToDiscriminant(kind: FallowIssueKind): number;
export declare function issueKindFromDiscriminant(d: number): FallowIssueKind | undefined;
export declare function isFallowSuppression(line: number): boolean;
export declare function isFileWideSuppression(suppression: FallowSuppression): boolean;
//# sourceMappingURL=fallow-suppression.d.ts.map