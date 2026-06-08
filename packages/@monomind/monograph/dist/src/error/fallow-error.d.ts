export type FallowErrorKind = {
    kind: 'FileReadError';
    path: string;
    cause?: string;
} | {
    kind: 'ParseError';
    path?: string;
    message: string;
} | {
    kind: 'ResolveError';
    specifier: string;
    fromFile?: string;
} | {
    kind: 'ConfigError';
    field?: string;
    message: string;
} | {
    kind: 'GitError';
    command: string;
    message: string;
} | {
    kind: 'IoError';
    message: string;
};
export interface FallowErrorOptions {
    code?: string;
    help?: string;
    context?: string;
}
export declare class FallowError extends Error {
    readonly errorKind: FallowErrorKind;
    readonly code?: string;
    readonly help?: string;
    readonly context?: string;
    constructor(kind: FallowErrorKind, opts?: FallowErrorOptions);
    withHelp(help: string): FallowError;
    withContext(context: string): FallowError;
    withCode(code: string): FallowError;
    format(): string;
    static formatMessage(kind: FallowErrorKind): string;
    static fileRead(filePath: string, cause?: string): FallowError;
    static parse(message: string, filePath?: string): FallowError;
    static resolve(specifier: string, fromFile?: string): FallowError;
    static config(message: string, field?: string): FallowError;
    static git(command: string, message: string): FallowError;
    static io(message: string): FallowError;
}
export declare function isFallowError(err: unknown): err is FallowError;
export declare function formatFallowError(err: unknown): string;
//# sourceMappingURL=fallow-error.d.ts.map