// Stable one-shot entry points for embedding monograph as a library.
export function isProgrammaticError(v) {
    return typeof v === 'object' && v !== null && 'code' in v && 'exitCode' in v;
}
export function makeProgrammaticError(code, message, exitCode = 1, extras) {
    return { code, message, exitCode, ...extras };
}
/** Validate AnalysisOptions — throws ProgrammaticError if invalid. */
export function validateAnalysisOptions(opts) {
    if (!opts.root)
        throw makeProgrammaticError('MISSING_ROOT', 'root directory is required', 2);
    if (opts.threads !== undefined && (opts.threads < 1 || opts.threads > 64)) {
        throw makeProgrammaticError('INVALID_THREADS', 'threads must be between 1 and 64', 2);
    }
}
/** Serialize a ProgrammaticError to a JSON-lines compatible envelope. */
export function programmaticErrorToJson(err) {
    return JSON.stringify({
        status: 'error',
        code: err.code,
        message: err.message,
        help: err.help,
        context: err.context,
        exitCode: err.exitCode,
    });
}
export async function detectDeadCodeProgrammatic(opts) {
    return JSON.stringify({ kind: 'dead-code', root: opts.root, results: [], message: 'Run via CLI: npx monograph analyze' });
}
export async function detectCircularDependenciesProgrammatic(opts) {
    return JSON.stringify({ kind: 'cycles', root: opts.root, results: [], message: 'Run via CLI: npx monograph analyze --cycles' });
}
export async function detectBoundaryViolationsProgrammatic(opts) {
    return JSON.stringify({ kind: 'boundaries', root: opts.root, results: [], message: 'Run via CLI: npx monograph check-boundaries' });
}
export async function detectDuplicationProgrammatic(opts) {
    return JSON.stringify({ kind: 'duplication', root: opts.root, results: [], message: 'Run via CLI: npx monograph find-dupes' });
}
export async function computeComplexityProgrammatic(opts) {
    return JSON.stringify({ kind: 'complexity', root: opts.root, results: [], message: 'Run via CLI: npx monograph health' });
}
export async function computeHealthProgrammatic(opts) {
    return JSON.stringify({ kind: 'health', root: opts.root, results: [], message: 'Run via CLI: npx monograph health --reporter json' });
}
//# sourceMappingURL=programmatic.js.map