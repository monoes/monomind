/**
 * Tests for .claude/helpers/handlers/edit-handler.cjs
 * Builds a minimal mock hCtx and calls handler.handle(hCtx) directly.
 * Verifies: session.metric, intelligence.recordEdit, security alerts,
 * test/build suggestions, and that no unconditional [OK] footer is printed.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const EH_PATH = path.resolve(__dirname, '../../.claude/helpers/handlers/edit-handler.cjs');

function loadEH() {
  delete require.cache[EH_PATH];
  return require(EH_PATH);
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-test-'));
  fs.mkdirSync(path.join(tmpDir, '.monomind', 'graph'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeHCtx(overrides = {}) {
  return {
    hookInput: {},
    toolInput: {},
    args: [],
    CWD: tmpDir,
    session: null,
    intelligence: null,
    _recordRecentEdit: () => {},
    _findAffectedTests: () => [],
    _maybeRebuildMonograph: () => {},
    _requireMonograph: () => null,
    ...overrides,
  };
}

// ── session.metric ─────────────────────────────────────────────────────────────

describe('edit-handler session.metric', () => {
  it('calls session.metric("edits") when session is present', async () => {
    const eh = loadEH();
    const mockMetric = vi.fn();
    const hCtx = makeHCtx({ session: { metric: mockMetric } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    expect(mockMetric).toHaveBeenCalledWith('edits');
  });

  it('does not throw when session is null', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({ session: null });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(eh.handle(hCtx)).resolves.not.toThrow();
  });

  it('does not throw when session.metric throws', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      session: {
        metric: () => {
          throw new Error('no active session');
        },
      },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(eh.handle(hCtx)).resolves.not.toThrow();
  });
});

// ── intelligence.recordEdit ────────────────────────────────────────────────────

describe('edit-handler intelligence.recordEdit', () => {
  it('calls intelligence.recordEdit with file from hookInput', async () => {
    const eh = loadEH();
    const mockRecord = vi.fn();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/src/auth.ts' },
      intelligence: { recordEdit: mockRecord },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    expect(mockRecord).toHaveBeenCalledWith('/src/auth.ts');
  });

  it('falls back to toolInput.file_path', async () => {
    const eh = loadEH();
    const mockRecord = vi.fn();
    const hCtx = makeHCtx({
      hookInput: {},
      toolInput: { file_path: '/src/index.ts' },
      intelligence: { recordEdit: mockRecord },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    expect(mockRecord).toHaveBeenCalledWith('/src/index.ts');
  });

  it('does not throw when intelligence is null', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({ intelligence: null });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(eh.handle(hCtx)).resolves.not.toThrow();
  });
});

// ── no unconditional [OK] footer ─────────────────────────────────────────────

describe('edit-handler completion message', () => {
  it('does not print [OK] Edit recorded (token-efficiency: dropped per-edit noise)', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).not.toContain('[OK] Edit recorded');
  });
});

// ── security-sensitive file alert ──────────────────────────────────────────────

describe('edit-handler security alert', () => {
  it('prints [SECURITY_EDIT] for auth-related file', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/src/auth/jwt-validator.ts' },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('[SECURITY_EDIT]');
  });

  it('prints [SECURITY_EDIT] for file with "security" in path', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/packages/security/validator.ts' },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('[SECURITY_EDIT]');
  });

  it('does NOT print [SECURITY_EDIT] for non-security file', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/src/components/button.tsx' },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).not.toContain('[SECURITY_EDIT]');
  });

  it('prints [SECURITY_EDIT] for file containing "token"', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/src/token-manager.ts' },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('[SECURITY_EDIT]');
  });
});

// ── smart test/build suggestions ──────────────────────────────────────────────

describe('edit-handler test/build suggestions', () => {
  it('prints [AUTO_SUGGEST] for .test.ts file', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/tests/auth.test.ts' },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('[AUTO_SUGGEST]');
    expect(output).toContain('npm test');
  });

  it('prints [AUTO_SUGGEST] for package.json edit', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/project/package.json' },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('[AUTO_SUGGEST]');
    expect(output).toContain('npm install');
  });

  it('prints [AUTO_SUGGEST] for tsconfig.json edit', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/project/tsconfig.json' },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('[AUTO_SUGGEST]');
    expect(output).toContain('npm run build');
  });

  it('does NOT print [AUTO_SUGGEST] for regular source file', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/src/utils/helpers.ts' },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).not.toContain('[AUTO_SUGGEST]');
  });
});

// ── affected tests detection ───────────────────────────────────────────────────

describe('edit-handler affected tests', () => {
  it('prints [AFFECTED_TESTS] when _findAffectedTests returns results', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/src/auth.ts' },
      _findAffectedTests: () => ['/tests/auth.test.ts', '/tests/session.test.ts'],
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('[AFFECTED_TESTS]');
  });

  it('does NOT print [AFFECTED_TESTS] for test files themselves', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/tests/auth.test.ts' },
      _findAffectedTests: () => ['/tests/other.test.ts'],
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    // Test files should not trigger affected tests output for themselves
    expect(output).not.toContain('[AFFECTED_TESTS]');
  });
});

// ── monograph rebuild (#328) ───────────────────────────────────────────────────

describe('edit-handler monograph rebuild', () => {
  const RESOLVE_PATH = path.resolve(__dirname, '../../.claude/helpers/utils/monograph-resolve.cjs');
  let savedEnv;

  beforeEach(() => {
    savedEnv = { PATH: process.env.PATH, npm_config_cache: process.env.npm_config_cache };
    process.env.npm_config_cache = path.join(tmpDir, 'no-npm-cache');
    delete require.cache[RESOLVE_PATH];
  });
  afterEach(() => {
    process.env.PATH = savedEnv.PATH;
    if (savedEnv.npm_config_cache === undefined) delete process.env.npm_config_cache;
    else process.env.npm_config_cache = savedEnv.npm_config_cache;
    delete require.cache[RESOLVE_PATH];
  });

  function waitFor(pred, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end && !pred()) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
    return pred();
  }

  // Serve `npm root -g` from a fake global root holding a fake @monoes/monograph
  // whose buildAsync writes `marker`.
  function fakeGlobalMonograph(marker) {
    const globalRoot = path.join(tmpDir, 'global');
    const pkgDir = path.join(globalRoot, '@monoes', 'monograph');
    fs.mkdirSync(path.join(pkgDir, 'dist', 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@monoes/monograph',
        version: '9.9.9',
        type: 'module',
        exports: { '.': { import: './dist/src/index.js' } },
      }),
    );
    fs.writeFileSync(
      path.join(pkgDir, 'dist', 'src', 'index.js'),
      `import { writeFileSync } from 'node:fs';\nexport async function buildAsync(dir) { writeFileSync(${JSON.stringify(marker)}, dir); }\n`,
    );
    const shimDir = path.join(tmpDir, 'shim');
    fs.mkdirSync(shimDir, { recursive: true });
    fs.writeFileSync(path.join(shimDir, 'npm'), `#!/bin/sh\necho ${JSON.stringify(globalRoot)}\n`);
    fs.chmodSync(path.join(shimDir, 'npm'), 0o755);
    process.env.PATH = shimDir;
  }

  it('rebuilds with a globally installed @monoes/monograph (no bare-specifier import)', async () => {
    const marker = path.join(tmpDir, 'built');
    fakeGlobalMonograph(marker);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await loadEH().handle(makeHCtx({ hookInput: { file_path: path.join(tmpDir, 'a.ts') } }));
    expect(logSpy.mock.calls.map((c) => c[0]).join('\n')).toContain(
      '[MONOGRAPH] Incremental rebuild triggered',
    );
    expect(waitFor(() => fs.existsSync(marker))).toBe(true);
    const log = path.join(tmpDir, '.monomind', 'graph', 'build.log');
    expect(fs.existsSync(log) ? fs.readFileSync(log, 'utf-8') : '').not.toContain(
      'ERR_MODULE_NOT_FOUND',
    );
  });

  it('removes .rebuild-lock once the rebuild finishes', async () => {
    const marker = path.join(tmpDir, 'built');
    fakeGlobalMonograph(marker);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await loadEH().handle(makeHCtx({ hookInput: { file_path: path.join(tmpDir, 'a.ts') } }));
    const lock = path.join(tmpDir, '.monomind', 'graph', '.rebuild-lock');
    expect(waitFor(() => fs.existsSync(marker) && !fs.existsSync(lock))).toBe(true);
  });

  it('records one deduped build.log line when nothing can rebuild', async () => {
    process.env.PATH = '';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const lock = path.join(tmpDir, '.monomind', 'graph', '.rebuild-lock');
    for (let i = 0; i < 3; i++) {
      await loadEH().handle(makeHCtx({ hookInput: { file_path: path.join(tmpDir, 'a.ts') } }));
      fs.rmSync(lock, { force: true }); // skip the 5 s cooldown
    }
    const log = fs.readFileSync(path.join(tmpDir, '.monomind', 'graph', 'build.log'), 'utf-8');
    expect(log.trim().split('\n')).toHaveLength(1);
    expect(log).toContain('npm i -g --allow-scripts=better-sqlite3 @monoes/monograph');
  });
});
