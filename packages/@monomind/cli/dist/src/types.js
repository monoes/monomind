/**
 * CLI Type Definitions
 * Modernized type system for the Monomind CLI
 */
// ============================================
// Error Types
// ============================================
export class CLIError extends Error {
    code;
    exitCode;
    details;
    constructor(message, code, exitCode = 1, details) {
        super(message);
        this.code = code;
        this.exitCode = exitCode;
        this.details = details;
        this.name = 'CLIError';
    }
}
//# sourceMappingURL=types.js.map