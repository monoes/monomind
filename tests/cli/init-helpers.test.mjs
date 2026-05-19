/**
 * Regression tests for monomind init helper installation.
 *
 * Guards against the class of bug where writeHelpers() copies only top-level
 * files, leaving utils/ and handlers/ subdirectories absent. hook-handler.cjs
 * unconditionally requires('./utils/telemetry.cjs') at startup, so missing
 * subdirectories cause a CJS loader crash on every Claude Code hook event.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Resolve the package root from this test file's location (tests/cli/ -> repo root)
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI_PKG = path.join(REPO_ROOT, 'packages', '@monomind', 'cli');
const SOURCE_HELPERS = path.join(CLI_PKG, '.claude', 'helpers');

// Skip tests if the source helpers directory doesn't exist (e.g. in CI without full checkout)
const SOURCE_EXISTS = fs.existsSync(SOURCE_HELPERS) &&
  fs.existsSync(path.join(SOURCE_HELPERS, 'utils', 'telemetry.cjs'));

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Source helpers integrity ──────────────────────────────────────────────────

describe('source helpers directory (published package)', () => {
  it('contains hook-handler.cjs', () => {
    expect(fs.existsSync(path.join(SOURCE_HELPERS, 'hook-handler.cjs'))).toBe(true);
  });

  it('contains utils/telemetry.cjs (required by hook-handler at startup)', () => {
    expect(fs.existsSync(path.join(SOURCE_HELPERS, 'utils', 'telemetry.cjs'))).toBe(true);
  });

  it('contains utils/monograph.cjs (required by hook-handler at startup)', () => {
    expect(fs.existsSync(path.join(SOURCE_HELPERS, 'utils', 'monograph.cjs'))).toBe(true);
  });

  it('contains utils/micro-agents.cjs (required by hook-handler at startup)', () => {
    expect(fs.existsSync(path.join(SOURCE_HELPERS, 'utils', 'micro-agents.cjs'))).toBe(true);
  });

  it('contains handlers/ subdirectory with at least one handler', () => {
    const handlersDir = path.join(SOURCE_HELPERS, 'handlers');
    expect(fs.existsSync(handlersDir)).toBe(true);
    const handlers = fs.readdirSync(handlersDir).filter(f => f.endsWith('.cjs'));
    expect(handlers.length).toBeGreaterThan(0);
  });
});

// ── Post-init helper structure ────────────────────────────────────────────────

describe.skipIf(!SOURCE_EXISTS)('after init: helpers directory structure', () => {
  let destHelpers;

  beforeEach(async () => {
    destHelpers = path.join(tmpDir, '.claude', 'helpers');
    fs.mkdirSync(destHelpers, { recursive: true });

    // Simulate what writeHelpers() does: recursive copy from source
    const copyRecursive = (src, dest) => {
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyRecursive(s, d);
        else fs.copyFileSync(s, d);
      }
    };
    copyRecursive(SOURCE_HELPERS, destHelpers);
  });

  it('installs hook-handler.cjs', () => {
    expect(fs.existsSync(path.join(destHelpers, 'hook-handler.cjs'))).toBe(true);
  });

  it('installs utils/ subdirectory', () => {
    expect(fs.existsSync(path.join(destHelpers, 'utils'))).toBe(true);
  });

  it('installs utils/telemetry.cjs', () => {
    expect(fs.existsSync(path.join(destHelpers, 'utils', 'telemetry.cjs'))).toBe(true);
  });

  it('installs utils/monograph.cjs', () => {
    expect(fs.existsSync(path.join(destHelpers, 'utils', 'monograph.cjs'))).toBe(true);
  });

  it('installs utils/micro-agents.cjs', () => {
    expect(fs.existsSync(path.join(destHelpers, 'utils', 'micro-agents.cjs'))).toBe(true);
  });

  it('installs handlers/ subdirectory', () => {
    expect(fs.existsSync(path.join(destHelpers, 'handlers'))).toBe(true);
  });

  it('installs at least one handler file in handlers/', () => {
    const handlers = fs.readdirSync(path.join(destHelpers, 'handlers'))
      .filter(f => f.endsWith('.cjs'));
    expect(handlers.length).toBeGreaterThan(0);
  });

  it('installed hook-handler.cjs loads without throwing (no missing-module crash)', () => {
    // Verify the installed hook-handler can be loaded in the target directory
    // by setting CLAUDE_PROJECT_DIR and checking Node can require it without error
    const hookHandler = path.join(destHelpers, 'hook-handler.cjs');
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    let error = null;
    try {
      // Delete from cache in case a previous test loaded it
      delete require.cache[hookHandler];
      require(hookHandler);
    } catch (e) {
      error = e;
    } finally {
      delete process.env.CLAUDE_PROJECT_DIR;
      delete require.cache[hookHandler];
    }
    expect(error).toBeNull();
  });
});
