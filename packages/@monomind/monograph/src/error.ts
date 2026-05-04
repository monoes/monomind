export type OutputFormat = 'text' | 'json' | 'compact';

export interface MonographError {
  code: string;
  message: string;
  details?: string;
}

export function emitError(message: string, exitCode: number, output: OutputFormat): MonographError {
  const err: MonographError = { code: `E${exitCode}`, message };
  if (output === 'json') {
    process.stderr.write(JSON.stringify({ error: err }) + '\n');
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  return err;
}

export function formatError(err: MonographError, output: OutputFormat): string {
  if (output === 'json') return JSON.stringify({ error: err });
  return `Error [${err.code}]: ${err.message}${err.details ? '\n' + err.details : ''}`;
}

export class MonographAnalysisError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: string,
  ) {
    super(message);
    this.name = 'MonographAnalysisError';
  }
}

export class MonographConfigError extends MonographAnalysisError {
  constructor(message: string, details?: string) {
    super(message, 'CONFIG_ERROR', details);
    this.name = 'MonographConfigError';
  }
}

export class MonographResolveError extends MonographAnalysisError {
  constructor(message: string, details?: string) {
    super(message, 'RESOLVE_ERROR', details);
    this.name = 'MonographResolveError';
  }
}
