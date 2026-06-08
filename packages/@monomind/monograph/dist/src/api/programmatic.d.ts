export type DuplicationMode = 'default' | 'aggressive' | 'lenient';
export type ComplexitySort = 'score' | 'loc' | 'name';
export type OwnershipEmailMode = 'full' | 'domain' | 'name';
export type TargetEffort = 'quick' | 'standard' | 'deep';
export interface AnalysisOptions {
    root: string;
    configPath?: string;
    threads?: number;
    productionOverride?: boolean;
    workspaceFilter?: string[];
    changedSince?: string;
}
export interface DeadCodeFilters {
    includeUnusedExports?: boolean;
    includeUnusedTypes?: boolean;
    includeUnusedEnums?: boolean;
    includeUnusedClasses?: boolean;
    includeUnusedFunctions?: boolean;
    includeDeadFiles?: boolean;
    includeCircularDeps?: boolean;
}
export interface DeadCodeOptions extends AnalysisOptions {
    filters?: DeadCodeFilters;
    limit?: number;
}
export interface DuplicationOptions extends AnalysisOptions {
    mode?: DuplicationMode;
    minLines?: number;
    minTokens?: number;
}
export interface ComplexityOptions extends AnalysisOptions {
    sort?: ComplexitySort;
    limit?: number;
    minComplexity?: number;
}
export interface ProgrammaticError {
    code: string;
    message: string;
    help?: string;
    context?: Record<string, unknown>;
    exitCode: number;
}
export declare function isProgrammaticError(v: unknown): v is ProgrammaticError;
export declare function makeProgrammaticError(code: string, message: string, exitCode?: number, extras?: Partial<ProgrammaticError>): ProgrammaticError;
/** Validate AnalysisOptions — throws ProgrammaticError if invalid. */
export declare function validateAnalysisOptions(opts: AnalysisOptions): void;
/** Serialize a ProgrammaticError to a JSON-lines compatible envelope. */
export declare function programmaticErrorToJson(err: ProgrammaticError): string;
export interface ProgrammaticRunOptions {
    root: string;
    tsconfig?: string;
    entry?: string | string[];
    production?: boolean;
    reporter?: 'json' | 'compact';
}
export declare function detectDeadCodeProgrammatic(opts: ProgrammaticRunOptions): Promise<string>;
export declare function detectCircularDependenciesProgrammatic(opts: ProgrammaticRunOptions): Promise<string>;
export declare function detectBoundaryViolationsProgrammatic(opts: ProgrammaticRunOptions): Promise<string>;
export declare function detectDuplicationProgrammatic(opts: ProgrammaticRunOptions): Promise<string>;
export declare function computeComplexityProgrammatic(opts: ProgrammaticRunOptions): Promise<string>;
export declare function computeHealthProgrammatic(opts: ProgrammaticRunOptions): Promise<string>;
//# sourceMappingURL=programmatic.d.ts.map