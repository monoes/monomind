export function emitError(message, exitCode, output) {
    const err = { code: `E${exitCode}`, message };
    if (output === 'json') {
        process.stderr.write(JSON.stringify({ error: err }) + '\n');
    }
    else {
        process.stderr.write(`Error: ${message}\n`);
    }
    return err;
}
export function formatError(err, output) {
    if (output === 'json')
        return JSON.stringify({ error: err });
    return `Error [${err.code}]: ${err.message}${err.details ? '\n' + err.details : ''}`;
}
export class MonographAnalysisError extends Error {
    code;
    details;
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'MonographAnalysisError';
    }
}
export class MonographConfigError extends MonographAnalysisError {
    constructor(message, details) {
        super(message, 'CONFIG_ERROR', details);
        this.name = 'MonographConfigError';
    }
}
export class MonographResolveError extends MonographAnalysisError {
    constructor(message, details) {
        super(message, 'RESOLVE_ERROR', details);
        this.name = 'MonographResolveError';
    }
}
//# sourceMappingURL=error.js.map