export type SuppressionKind = 'unused-export' | 'unused-file' | 'unused-member' | 'complexity' | 'coverage-gaps' | 'code-duplication' | 'dead-code' | 'boundary' | 'codeowners';
export declare const NON_CORE_KINDS: SuppressionKind[];
export interface Suppression {
    path: string;
    line: number;
    col: number;
    kind: SuppressionKind;
    comment?: string;
}
export interface StaleSuppression extends Suppression {
    description(): string;
    explanation(): string;
}
export interface SuppressionContext {
    suppressions: Suppression[];
    consumed: Set<string>;
}
export declare function createSuppressionContext(suppressions: Suppression[]): SuppressionContext;
export declare function suppressionKey(s: Suppression): string;
export declare function markConsumed(ctx: SuppressionContext, path: string, line: number, kind: SuppressionKind): void;
export declare function findStale(ctx: SuppressionContext): StaleSuppression[];
//# sourceMappingURL=suppressions.d.ts.map