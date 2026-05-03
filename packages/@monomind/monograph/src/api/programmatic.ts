// Stable one-shot entry points for embedding monograph as a library.

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

export function isProgrammaticError(v: unknown): v is ProgrammaticError {
  return typeof v === 'object' && v !== null && 'code' in v && 'exitCode' in v;
}

export function makeProgrammaticError(
  code: string,
  message: string,
  exitCode = 1,
  extras?: Partial<ProgrammaticError>,
): ProgrammaticError {
  return { code, message, exitCode, ...extras };
}

/** Validate AnalysisOptions — throws ProgrammaticError if invalid. */
export function validateAnalysisOptions(opts: AnalysisOptions): void {
  if (!opts.root) throw makeProgrammaticError('MISSING_ROOT', 'root directory is required', 2);
  if (opts.threads !== undefined && (opts.threads < 1 || opts.threads > 64)) {
    throw makeProgrammaticError('INVALID_THREADS', 'threads must be between 1 and 64', 2);
  }
}

/** Serialize a ProgrammaticError to a JSON-lines compatible envelope. */
export function programmaticErrorToJson(err: ProgrammaticError): string {
  return JSON.stringify({
    status: 'error',
    code: err.code,
    message: err.message,
    help: err.help,
    context: err.context,
    exitCode: err.exitCode,
  });
}
