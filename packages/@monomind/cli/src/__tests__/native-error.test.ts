import { describe, expect, it } from 'vitest';
import { classifyNativeModuleError, formatErrorWithCause } from '../utils/native-error.js';

describe('formatErrorWithCause', () => {
  it('returns just the message for a plain Error with no cause', () => {
    expect(formatErrorWithCause(new Error('boom'))).toBe('boom');
  });

  it('appends an Error cause message', () => {
    const cause = new Error('the real reason');
    expect(formatErrorWithCause(new Error('wrapper', { cause }))).toBe('wrapper: the real reason');
  });

  it('appends a non-Error cause via String()', () => {
    const err = new Error('wrapper');
    (err as { cause?: unknown }).cause = 'plain string cause';
    expect(formatErrorWithCause(err)).toBe('wrapper: plain string cause');
  });

  it('stringifies non-Error values as-is', () => {
    expect(formatErrorWithCause('not an error')).toBe('not an error');
  });
});

describe('classifyNativeModuleError', () => {
  it('recognizes the NODE_MODULE_VERSION ABI-mismatch pattern from issue #231, verbatim', () => {
    const text = `MonographError: Failed to open database at .../.monomind/monograph.db
  cause: Error: The module '.../better-sqlite3/build/Release/better_sqlite3.node'
  was compiled against a different Node.js version using
  NODE_MODULE_VERSION 141. This version of Node.js requires
  NODE_MODULE_VERSION 147. Please try re-compiling or re-installing
  the module (for instance, using \`npm rebuild\` or \`npm install\`).`;

    const result = classifyNativeModuleError(text);
    expect(result).not.toBeNull();
    expect(result).toContain('ABI 141');
    expect(result).toContain('ABI 147');
    expect(result).toContain('NODE_MODULE_VERSION mismatch');
  });

  it('returns null for unrelated error text', () => {
    expect(classifyNativeModuleError('TypeError: cannot read property of undefined')).toBeNull();
  });

  it('matches the LAST attempt, not the first, when build.log has accumulated several (it is append-only and never truncated)', () => {
    const text = [
      'attempt 1: NODE_MODULE_VERSION 130. This version of Node.js requires NODE_MODULE_VERSION 140.',
      'attempt 2: NODE_MODULE_VERSION 141. This version of Node.js requires NODE_MODULE_VERSION 147.',
    ].join('\n');

    const result = classifyNativeModuleError(text);
    expect(result).toContain('ABI 141');
    expect(result).toContain('ABI 147');
    expect(result).not.toContain('ABI 130');
    expect(result).not.toContain('ABI 140');
  });
});
