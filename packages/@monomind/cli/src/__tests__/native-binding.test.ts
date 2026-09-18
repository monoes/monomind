import { describe, expect, it } from 'vitest';
import {
  deriveRebuildTarget,
  diagnoseNativeLoadError,
  formatNativeDiagnosis,
  planAutoRebuild,
} from '../utils/native-binding.js';

const RUNTIME = { nodeVersion: 'v26.5.0', runtimeAbi: '147' };

/** The verbatim shape Node prints for an ABI mismatch (issue #231). */
function abiError(binaryPath: string, builtFor = '141', required = '147'): Error {
  return new Error(
    `The module '${binaryPath}'\n` +
      'was compiled against a different Node.js version using\n' +
      `NODE_MODULE_VERSION ${builtFor}. This version of Node.js requires\n` +
      `NODE_MODULE_VERSION ${required}. Please try re-compiling or re-installing\n` +
      'the module (for instance, using `npm rebuild` or `npm install`).',
  );
}

describe('deriveRebuildTarget', () => {
  it('names the intermediate package that owns the node_modules holding the binary — not the project, not the top-level global package (the exact thing #231 rebuilt five times without effect)', () => {
    const target = deriveRebuildTarget(
      '/usr/local/lib/node_modules/monomind/node_modules/@monoes/monomindcli/node_modules/' +
        'better-sqlite3/build/Release/better_sqlite3.node',
    );
    expect(target).toEqual({
      packageManager: 'npm',
      rebuildCwd: '/usr/local/lib/node_modules/monomind/node_modules/@monoes/monomindcli',
      packageDir:
        '/usr/local/lib/node_modules/monomind/node_modules/@monoes/monomindcli/node_modules/better-sqlite3',
    });
  });

  it('points a pnpm store path at the root that owns the store, since rebuilding inside .pnpm is not how pnpm works', () => {
    const target = deriveRebuildTarget(
      '/home/u/proj/node_modules/.pnpm/better-sqlite3@12.11.1/node_modules/better-sqlite3/' +
        'build/Release/better_sqlite3.node',
    );
    expect(target?.packageManager).toBe('pnpm');
    expect(target?.rebuildCwd).toBe('/home/u/proj');
  });

  it('handles a scoped package directory', () => {
    expect(
      deriveRebuildTarget('/a/b/node_modules/@foo/bar-native/build/Release/bar.node')?.packageDir,
    ).toBe('/a/b/node_modules/@foo/bar-native');
  });

  it('normalizes Windows separators', () => {
    expect(
      deriveRebuildTarget(
        'C:\\app\\node_modules\\better-sqlite3\\build\\Release\\better_sqlite3.node',
      )?.rebuildCwd,
    ).toBe('C:/app');
  });

  it('returns null when the path has no node_modules at all', () => {
    expect(deriveRebuildTarget('/opt/custom/better_sqlite3.node')).toBeNull();
  });
});

describe('diagnoseNativeLoadError', () => {
  it('names both ABIs, the running Node, the binary, and a fix command scoped to the owning directory', () => {
    const diag = diagnoseNativeLoadError(
      abiError(
        '/usr/local/lib/node_modules/monomind/node_modules/@monoes/monomindcli/node_modules/' +
          'better-sqlite3/build/Release/better_sqlite3.node',
      ),
      'better-sqlite3',
      RUNTIME,
    );
    expect(diag.status).toBe('abi-mismatch');
    expect(diag.builtForAbi).toBe('141');
    expect(diag.runtimeAbi).toBe('147');
    expect(diag.summary).toContain('ABI 141');
    expect(diag.summary).toContain('v26.5.0');
    expect(diag.summary).toContain('ABI 147');
    expect(diag.fix).toBe(
      'cd /usr/local/lib/node_modules/monomind/node_modules/@monoes/monomindcli && ' +
        'npm rebuild better-sqlite3 --build-from-source',
    );
  });

  it('forces a from-source rebuild for the ABI case, because a plain rebuild can reuse a cached prebuilt and change nothing (#231: byte-identical every time)', () => {
    const diag = diagnoseNativeLoadError(
      abiError('/a/node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
      'better-sqlite3',
      RUNTIME,
    );
    expect(diag.fix).toContain('--build-from-source');
  });

  it('uses pnpm rebuild for a pnpm store path', () => {
    const diag = diagnoseNativeLoadError(
      abiError(
        '/home/u/proj/node_modules/.pnpm/better-sqlite3@12.11.1/node_modules/better-sqlite3/' +
          'build/Release/better_sqlite3.node',
      ),
      'better-sqlite3',
      RUNTIME,
    );
    expect(diag.fix).toBe('cd /home/u/proj && pnpm rebuild better-sqlite3');
  });

  it('takes the most recent attempt when an append-only build.log holds several', () => {
    const stacked = new Error(
      'NODE_MODULE_VERSION 115. This version of Node.js requires\nNODE_MODULE_VERSION 120.\n' +
        'NODE_MODULE_VERSION 141. This version of Node.js requires\nNODE_MODULE_VERSION 147.',
    );
    expect(diagnoseNativeLoadError(stacked, 'better-sqlite3', RUNTIME).builtForAbi).toBe('141');
  });

  it('distinguishes a never-built binary from an ABI mismatch', () => {
    const diag = diagnoseNativeLoadError(
      new Error(
        'Could not locate the bindings file. Tried:\n' +
          ' → /a/node_modules/better-sqlite3/build/better_sqlite3.node',
      ),
      'better-sqlite3',
      RUNTIME,
    );
    expect(diag.status).toBe('missing-binary');
    expect(diag.summary).toContain('never built');
    expect(diag.fix).not.toContain('--build-from-source');
  });

  it('falls back to load-error for an unrecognized failure without inventing a cause', () => {
    const diag = diagnoseNativeLoadError(new Error('disk on fire'), 'better-sqlite3', RUNTIME);
    expect(diag.status).toBe('load-error');
    expect(diag.summary).toContain('disk on fire');
  });
});

describe('formatNativeDiagnosis', () => {
  it('shows the binary, the owning directory, and warns that rebuilding elsewhere will not touch it', () => {
    const text = formatNativeDiagnosis(
      diagnoseNativeLoadError(
        abiError('/g/node_modules/monomind/node_modules/better-sqlite3/build/Release/x.node'),
        'better-sqlite3',
        RUNTIME,
      ),
    );
    expect(text).toContain('binary  :');
    expect(text).toContain('owned by: /g/node_modules/monomind');
    expect(text).toContain('fix     : cd /g/node_modules/monomind && npm rebuild');
    expect(text).toContain('will not touch the file above');
  });
});

describe('planAutoRebuild', () => {
  const diag = () =>
    diagnoseNativeLoadError(
      abiError('/g/node_modules/better-sqlite3/build/Release/x.node'),
      'better-sqlite3',
      RUNTIME,
    );

  it('rebuilds when the owning directory is writable', () => {
    expect(planAutoRebuild(diag(), { isWritable: () => true }).attempt).toBe(true);
  });

  it('refuses to touch an install tree this user cannot write (e.g. a root-owned global install)', () => {
    const decision = planAutoRebuild(diag(), { isWritable: () => false });
    expect(decision.attempt).toBe(false);
    expect(decision.reason).toContain('not writable');
  });

  it('honors the opt-out', () => {
    expect(planAutoRebuild(diag(), { disabled: true, isWritable: () => true }).attempt).toBe(false);
  });

  it('does nothing when the binding already loads', () => {
    const ok = { ...diag(), status: 'ok' as const };
    expect(planAutoRebuild(ok, { isWritable: () => true }).attempt).toBe(false);
  });

  it('refuses when the install directory could not be located', () => {
    const noTarget = diagnoseNativeLoadError(
      abiError('/opt/loose/better_sqlite3.node'),
      'better-sqlite3',
      RUNTIME,
    );
    expect(planAutoRebuild(noTarget, { isWritable: () => true }).attempt).toBe(false);
  });
});
