export type OutputFormat = 'text' | 'json' | 'compact';
export interface MonographError {
    code: string;
    message: string;
    details?: string;
}
export declare function emitError(message: string, exitCode: number, output: OutputFormat): MonographError;
export declare function formatError(err: MonographError, output: OutputFormat): string;
export declare class MonographAnalysisError extends Error {
    readonly code: string;
    readonly details?: string | undefined;
    constructor(message: string, code: string, details?: string | undefined);
}
export declare class MonographConfigError extends MonographAnalysisError {
    constructor(message: string, details?: string);
}
export declare class MonographResolveError extends MonographAnalysisError {
    constructor(message: string, details?: string);
}
//# sourceMappingURL=error.d.ts.map