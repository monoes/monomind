/**
 * Tests for .claude/helpers/session.cjs
 * Uses process.env.CLAUDE_PROJECT_DIR injection before each fresh require()
 * so module-level SESSION_DIR resolves to the isolated tmpDir.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SESSION_PATH = path.resolve(__dirname, '../../.claude/helpers/session.cjs');
const ORIG_CWD_ENV = process.env.CLAUDE_PROJECT_DIR;

let tmpDir;

function loadSession() {
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  delete require.cache[SESSION_PATH];
  return require(SESSION_PATH);
}

function sessionFile(dir) {
  return path.join(dir, '.monomind', 'sessions', 'current.json');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-test-'));
  // Create .monomind so getDataDir() picks the local path
  fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
});

afterEach(() => {
  if (ORIG_CWD_ENV !== undefined) process.env.CLAUDE_PROJECT_DIR = ORIG_CWD_ENV;
  else delete process.env.CLAUDE_PROJECT_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── start ──────────────────────────────────────────────────────────────────────

describe('session.start', () => {
  it('returns session object with id matching session-<timestamp>', () => {
    const s = loadSession();
    const sess = s.start();
    expect(sess.id).toMatch(/^session-\d+$/);
  });

  it('writes current.json to .monomind/sessions/', () => {
    const s = loadSession();
    s.start();
    expect(fs.existsSync(sessionFile(tmpDir))).toBe(true);
  });

  it('session has empty context and zero metrics', () => {
    const s = loadSession();
    const sess = s.start();
    expect(sess.context).toEqual({});
    expect(sess.metrics.edits).toBe(0);
    expect(sess.metrics.commands).toBe(0);
    expect(sess.metrics.tasks).toBe(0);
    expect(sess.metrics.errors).toBe(0);
  });

  it('session has startedAt ISO timestamp', () => {
    const s = loadSession();
    const sess = s.start();
    expect(new Date(sess.startedAt).getTime()).toBeGreaterThan(0);
  });
});

// ── restore ────────────────────────────────────────────────────────────────────

describe('session.restore', () => {
  it('returns null when no current.json exists', () => {
    const s = loadSession();
    expect(s.restore()).toBeNull();
  });

  it('returns session object when current.json exists', () => {
    const s = loadSession();
    s.start();
    const restored = s.restore();
    expect(restored).not.toBeNull();
    expect(restored.id).toMatch(/^session-\d+$/);
  });

  it('sets restoredAt on the restored session', () => {
    const s = loadSession();
    s.start();
    const restored = s.restore();
    expect(restored.restoredAt).toBeTruthy();
    expect(new Date(restored.restoredAt).getTime()).toBeGreaterThan(0);
  });
});

// ── end ────────────────────────────────────────────────────────────────────────

describe('session.end', () => {
  it('returns null when no active session', () => {
    const s = loadSession();
    expect(s.end()).toBeNull();
  });

  it('removes current.json after ending', () => {
    const s = loadSession();
    s.start();
    s.end();
    expect(fs.existsSync(sessionFile(tmpDir))).toBe(false);
  });

  it('archives to <session-id>.json', () => {
    const s = loadSession();
    const sess = s.start();
    s.end();
    const archivePath = path.join(tmpDir, '.monomind', 'sessions', sess.id + '.json');
    expect(fs.existsSync(archivePath)).toBe(true);
  });

  it('archived session has endedAt and duration', () => {
    const s = loadSession();
    s.start();
    const ended = s.end();
    expect(ended.endedAt).toBeTruthy();
    expect(ended.duration).toBeGreaterThanOrEqual(0);
  });
});

// ── status ─────────────────────────────────────────────────────────────────────

describe('session.status', () => {
  it('returns null when no active session', () => {
    const s = loadSession();
    expect(s.status()).toBeNull();
  });

  it('returns session object when active', () => {
    const s = loadSession();
    s.start();
    const result = s.status();
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('startedAt');
  });
});

// ── metric ─────────────────────────────────────────────────────────────────────

describe('session.metric', () => {
  it('returns null when no active session', () => {
    const s = loadSession();
    expect(s.metric('edits')).toBeNull();
  });

  it('increments a known metric field', () => {
    const s = loadSession();
    s.start();
    const result = s.metric('edits');
    expect(result.metrics.edits).toBe(1);
  });

  it('calling metric twice increments to 2', () => {
    const s = loadSession();
    s.start();
    s.metric('commands');
    const result = s.metric('commands');
    expect(result.metrics.commands).toBe(2);
  });

  it('does not mutate unknown metric key', () => {
    const s = loadSession();
    s.start();
    s.metric('unknownXYZ');
    const result = s.status();
    expect(result.metrics.unknownXYZ).toBeUndefined();
  });
});
