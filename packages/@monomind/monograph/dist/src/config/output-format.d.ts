export type FallowOutputFormat = 'human' | 'json' | 'sarif' | 'compact' | 'markdown' | 'code-climate' | 'badge';
export declare const DEFAULT_OUTPUT_FORMAT: FallowOutputFormat;
export declare function parseFallowOutputFormat(s: string): FallowOutputFormat | undefined;
export declare function isFallowOutputFormat(s: string): s is FallowOutputFormat;
//# sourceMappingURL=output-format.d.ts.map