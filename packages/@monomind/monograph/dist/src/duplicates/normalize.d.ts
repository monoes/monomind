import type { SourceToken, TokenKind } from './token-types.js';
export type DetectionMode = 'Exact' | 'NormalizeIdentifiers' | 'NormalizeLiterals' | 'NormalizeAll';
export interface ResolvedNormalization {
    normalizeIdentifiers: boolean;
    normalizeLiterals: boolean;
    normalizeKeywords: boolean;
}
export interface HashedToken {
    hash: number;
    originalIndex: number;
}
export declare function resolveNormalization(mode: DetectionMode): ResolvedNormalization;
export declare function normalizeAndHash(tokens: SourceToken[], mode: DetectionMode): HashedToken[];
export declare function normalizeAndHashResolved(tokens: SourceToken[], norm: ResolvedNormalization): HashedToken[];
export declare function hashTokenResolved(kind: TokenKind, norm: ResolvedNormalization): number;
//# sourceMappingURL=normalize.d.ts.map