export type FallowErrorKind =
  | { kind: 'FileReadError'; path: string; cause?: string }
  | { kind: 'ParseError'; path?: string; message: string }
  | { kind: 'ResolveError'; specifier: string; fromFile?: string }
  | { kind: 'ConfigError'; field?: string; message: string }
  | { kind: 'GitError'; command: string; message: string }
  | { kind: 'IoError'; message: string };

export interface FallowErrorOptions {
  code?: string;
  help?: string;
  context?: string;
}

export class FallowError extends Error {
  readonly errorKind: FallowErrorKind;
  readonly code?: string;
  readonly help?: string;
  readonly context?: string;

  constructor(kind: FallowErrorKind, opts: FallowErrorOptions = {}) {
    super(FallowError.formatMessage(kind));
    this.name = 'FallowError';
    this.errorKind = kind;
    this.code = opts.code;
    this.help = opts.help;
    this.context = opts.context;
  }

  withHelp(help: string): FallowError {
    return new FallowError(this.errorKind, { code: this.code, help, context: this.context });
  }

  withContext(context: string): FallowError {
    return new FallowError(this.errorKind, { code: this.code, help: this.help, context });
  }

  withCode(code: string): FallowError {
    return new FallowError(this.errorKind, { code, help: this.help, context: this.context });
  }

  format(): string {
    const parts: string[] = [this.message];
    if (this.code) parts.unshift(`[${this.code}]`);
    if (this.context) parts.push(`  Context: ${this.context}`);
    if (this.help) parts.push(`  Help: ${this.help}`);
    return parts.join('\n');
  }

  static formatMessage(kind: FallowErrorKind): string {
    switch (kind.kind) {
      case 'FileReadError': return `Failed to read file: ${kind.path}${kind.cause ? ` (${kind.cause})` : ''}`;
      case 'ParseError': return `Parse error${kind.path ? ` in ${kind.path}` : ''}: ${kind.message}`;
      case 'ResolveError': return `Cannot resolve '${kind.specifier}'${kind.fromFile ? ` from ${kind.fromFile}` : ''}`;
      case 'ConfigError': return `Configuration error${kind.field ? ` (${kind.field})` : ''}: ${kind.message}`;
      case 'GitError': return `Git error running '${kind.command}': ${kind.message}`;
      case 'IoError': return `I/O error: ${kind.message}`;
    }
  }

  static fileRead(filePath: string, cause?: string): FallowError {
    return new FallowError({ kind: 'FileReadError', path: filePath, cause }, { code: 'E001' });
  }

  static parse(message: string, filePath?: string): FallowError {
    return new FallowError({ kind: 'ParseError', path: filePath, message }, { code: 'E002' });
  }

  static resolve(specifier: string, fromFile?: string): FallowError {
    return new FallowError({ kind: 'ResolveError', specifier, fromFile }, { code: 'E003' });
  }

  static config(message: string, field?: string): FallowError {
    return new FallowError({ kind: 'ConfigError', field, message }, { code: 'E004' });
  }

  static git(command: string, message: string): FallowError {
    return new FallowError({ kind: 'GitError', command, message }, { code: 'E005' });
  }

  static io(message: string): FallowError {
    return new FallowError({ kind: 'IoError', message }, { code: 'E006' });
  }
}

export function isFallowError(err: unknown): err is FallowError {
  return err instanceof FallowError;
}

export function formatFallowError(err: unknown): string {
  if (err instanceof FallowError) return err.format();
  if (err instanceof Error) return err.message;
  return String(err);
}
