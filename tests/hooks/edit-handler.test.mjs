/**
 * Tests for .claude/helpers/handlers/edit-handler.cjs
 * Builds a minimal mock hCtx and calls handler.handle(hCtx) directly.
 * Verifies: session.metric, intelligence.recordEdit, security alerts,
 * test/build suggestions, and the [OK] completion message.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

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
      session: { metric: () => { throw new Error('no active session'); } },
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

// ── always prints [OK] ─────────────────────────────────────────────────────────

describe('edit-handler completion message', () => {
  it('always prints [OK] Edit recorded', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[OK] Edit recorded');
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
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[SECURITY_EDIT]');
  });

  it('prints [SECURITY_EDIT] for file with "security" in path', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/packages/security/validator.ts' },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[SECURITY_EDIT]');
  });

  it('does NOT print [SECURITY_EDIT] for non-security file', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/src/components/button.tsx' },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).not.toContain('[SECURITY_EDIT]');
  });

  it('prints [SECURITY_EDIT] for file containing "token"', async () => {
    const eh = loadEH();
    const hCtx = makeHCtx({
      hookInput: { file_path: '/src/token-manager.ts' },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await eh.handle(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
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
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
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
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
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
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
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
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
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
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
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
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    // Test files should not trigger affected tests output for themselves
    expect(output).not.toContain('[AFFECTED_TESTS]');
  });
});
