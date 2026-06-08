export class FallowError extends Error {
    errorKind;
    code;
    help;
    context;
    constructor(kind, opts = {}) {
        super(FallowError.formatMessage(kind));
        this.name = 'FallowError';
        this.errorKind = kind;
        this.code = opts.code;
        this.help = opts.help;
        this.context = opts.context;
    }
    withHelp(help) {
        return new FallowError(this.errorKind, { code: this.code, help, context: this.context });
    }
    withContext(context) {
        return new FallowError(this.errorKind, { code: this.code, help: this.help, context });
    }
    withCode(code) {
        return new FallowError(this.errorKind, { code, help: this.help, context: this.context });
    }
    format() {
        const parts = [this.message];
        if (this.code)
            parts.unshift(`[${this.code}]`);
        if (this.context)
            parts.push(`  Context: ${this.context}`);
        if (this.help)
            parts.push(`  Help: ${this.help}`);
        return parts.join('\n');
    }
    static formatMessage(kind) {
        switch (kind.kind) {
            case 'FileReadError': return `Failed to read file: ${kind.path}${kind.cause ? ` (${kind.cause})` : ''}`;
            case 'ParseError': return `Parse error${kind.path ? ` in ${kind.path}` : ''}: ${kind.message}`;
            case 'ResolveError': return `Cannot resolve '${kind.specifier}'${kind.fromFile ? ` from ${kind.fromFile}` : ''}`;
            case 'ConfigError': return `Configuration error${kind.field ? ` (${kind.field})` : ''}: ${kind.message}`;
            case 'GitError': return `Git error running '${kind.command}': ${kind.message}`;
            case 'IoError': return `I/O error: ${kind.message}`;
        }
    }
    static fileRead(filePath, cause) {
        return new FallowError({ kind: 'FileReadError', path: filePath, cause }, { code: 'E001' });
    }
    static parse(message, filePath) {
        return new FallowError({ kind: 'ParseError', path: filePath, message }, { code: 'E002' });
    }
    static resolve(specifier, fromFile) {
        return new FallowError({ kind: 'ResolveError', specifier, fromFile }, { code: 'E003' });
    }
    static config(message, field) {
        return new FallowError({ kind: 'ConfigError', field, message }, { code: 'E004' });
    }
    static git(command, message) {
        return new FallowError({ kind: 'GitError', command, message }, { code: 'E005' });
    }
    static io(message) {
        return new FallowError({ kind: 'IoError', message }, { code: 'E006' });
    }
}
export function isFallowError(err) {
    return err instanceof FallowError;
}
export function formatFallowError(err) {
    if (err instanceof FallowError)
        return err.format();
    if (err instanceof Error)
        return err.message;
    return String(err);
}
//# sourceMappingURL=fallow-error.js.map