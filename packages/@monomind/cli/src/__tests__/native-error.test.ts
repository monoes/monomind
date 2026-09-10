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

  // Reproduces a real crash hit while live-testing `monomind init` against
  // the published 2.10.15 package: `npm install @monoes/monograph`'s
  // better-sqlite3 dependency had its install script blocked, so the
  // background build crashed loading a .node binary that was never built —
  // a different failure from the ABI-mismatch case above (missing, not
  // wrong-version). Verbatim shape from the `bindings` package, including
  // the long candidate-path list real Node prints — this is also the
  // fixture doctor-project-checks.test.ts uses to prove the freshness check
  // scans far enough to see it.
  const REAL_BINDINGS_NOT_FOUND_LOG = `file:///project/node_modules/@monoes/monograph/dist/src/storage/db.js:27
        throw new MonographError(\`Failed to open database at \${dbPath}\`, err);
              ^

MonographError: Failed to open database at /project/.monomind/monograph.db
    at openDb (file:///project/node_modules/@monoes/monograph/dist/src/storage/db.js:27:15)
    at buildAsyncLocked (file:///project/node_modules/@monoes/monograph/dist/src/pipeline/orchestrator.js:157:16)
    at buildAsync (file:///project/node_modules/@monoes/monograph/dist/src/pipeline/orchestrator.js:104:15)
    at async file:///project/[eval1]:4:7 {
  cause: Error: Could not locate the bindings file. Tried:
   → /project/node_modules/better-sqlite3/build/better_sqlite3.node
   → /project/node_modules/better-sqlite3/build/Debug/better_sqlite3.node
   → /project/node_modules/better-sqlite3/build/Release/better_sqlite3.node
   → /project/node_modules/better-sqlite3/out/Debug/better_sqlite3.node
   → /project/node_modules/better-sqlite3/Debug/better_sqlite3.node
   → /project/node_modules/better-sqlite3/out/Release/better_sqlite3.node
   → /project/node_modules/better-sqlite3/Release/better_sqlite3.node
   → /project/node_modules/better-sqlite3/build/default/better_sqlite3.node
   → /project/node_modules/better-sqlite3/compiled/26.5.0/darwin/arm64/better_sqlite3.node
   → /project/node_modules/better-sqlite3/addon-build/release/install-root/better_sqlite3.node
   → /project/node_modules/better-sqlite3/addon-build/debug/install-root/better_sqlite3.node
   → /project/node_modules/better-sqlite3/addon-build/default/install-root/better_sqlite3.node
   → /project/node_modules/better-sqlite3/lib/binding/node-v147-darwin-arm64/better_sqlite3.node
      at bindings (/project/node_modules/bindings/bindings.js:126:9)
      at new Database (/project/node_modules/better-sqlite3/lib/database.js:48:64)
      at openDb (file:///project/node_modules/@monoes/monograph/dist/src/storage/db.js:12:20)
}

Node.js v26.5.0
`;

  it('recognizes a missing (never-built) native binding, distinct from an ABI mismatch, and names the module', () => {
    const result = classifyNativeModuleError(REAL_BINDINGS_NOT_FOUND_LOG);
    expect(result).not.toBeNull();
    expect(result).toContain('better-sqlite3');
    expect(result).toContain('never built');
    expect(result).not.toMatch(/ABI \d+/); // distinct from the version-mismatch branch's message
  });

  it('falls back to a generic module reference when no node_modules path is present', () => {
    const result = classifyNativeModuleError('Error: Could not locate the bindings file. Tried:\n(no paths listed)');
    expect(result).not.toBeNull();
    expect(result).toContain('A native module');
    expect(result).toContain('npm rebuild <module>');
  });
});
