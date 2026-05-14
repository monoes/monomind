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
export class ValidationError extends CLIError {
    constructor(message, details) {
        super(message, 'VALIDATION_ERROR', 1, details);
        this.name = 'ValidationError';
    }
}
export class ConfigError extends CLIError {
    constructor(message, details) {
        super(message, 'CONFIG_ERROR', 1, details);
        this.name = 'ConfigError';
    }
}
export class CommandNotFoundError extends CLIError {
    constructor(commandName) {
        super(`Unknown command: ${commandName}`, 'COMMAND_NOT_FOUND', 127);
        this.name = 'CommandNotFoundError';
    }
}
//# sourceMappingURL=types.js.map