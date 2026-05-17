/**
 * Tests for .claude/helpers/memory.cjs
 * Spawn-based (script uses process.cwd() at module level for MEMORY_FILE path).
 * All operations tested via CLI args with cwd=tmpDir so reads/writes land there.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../.claude/helpers/memory.cjs');

function run(args, { cwd } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: cwd || os.tmpdir(),
    encoding: 'utf-8',
    timeout: 5000,
    env: { ...process.env },
  });
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── get ─────────────────────────────────────────────────────────────────────

describe('memory.cjs get', () => {
  it('get with no args returns {} when memory is empty', () => {
    const r = run(['get'], { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{}');
  });

  it('get missing key returns undefined', () => {
    const r = run(['get', 'missingKey'], { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('undefined');
  });

  it('get returns value set previously', () => {
    run(['set', 'greeting', 'hello'], { cwd: tmpDir });
    const r = run(['get', 'greeting'], { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('"hello"');
  });

  it('get with no args returns full memory object including all set keys', () => {
    run(['set', 'alpha', 'a'], { cwd: tmpDir });
    run(['set', 'beta', 'b'], { cwd: tmpDir });
    const r = run(['get'], { cwd: tmpDir });
    const obj = JSON.parse(r.stdout.trim());
    expect(obj.alpha).toBe('a');
    expect(obj.beta).toBe('b');
  });
});

// ── set ─────────────────────────────────────────────────────────────────────

describe('memory.cjs set', () => {
  it('set prints "Set: <key>" on success', () => {
    const r = run(['set', 'mykey', 'myval'], { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('Set: mykey');
  });

  it('set creates .monomind/data/memory.json', () => {
    run(['set', 'k', 'v'], { cwd: tmpDir });
    const memFile = path.join(tmpDir, '.monomind', 'data', 'memory.json');
    expect(fs.existsSync(memFile)).toBe(true);
  });

  it('set writes key and value to memory file', () => {
    run(['set', 'color', 'blue'], { cwd: tmpDir });
    const memFile = path.join(tmpDir, '.monomind', 'data', 'memory.json');
    const data = JSON.parse(fs.readFileSync(memFile, 'utf-8'));
    expect(data.color).toBe('blue');
  });

  it('set adds _updated timestamp automatically', () => {
    run(['set', 'k', 'v'], { cwd: tmpDir });
    const memFile = path.join(tmpDir, '.monomind', 'data', 'memory.json');
    const data = JSON.parse(fs.readFileSync(memFile, 'utf-8'));
    expect(data._updated).toBeDefined();
    expect(() => new Date(data._updated)).not.toThrow();
  });

  it('set supports multi-word values via CLI args join', () => {
    run(['set', 'sentence', 'hello', 'world'], { cwd: tmpDir });
    const r = run(['get', 'sentence'], { cwd: tmpDir });
    expect(r.stdout.trim()).toBe('"hello world"');
  });

  it('set without key prints error to stderr', () => {
    const r = run(['set'], { cwd: tmpDir });
    expect(r.stderr).toContain('Key required');
  });
});

// ── delete ─────────────────────────────────────────────────────────────────

describe('memory.cjs delete', () => {
  it('delete removes an existing key', () => {
    run(['set', 'toRemove', 'yes'], { cwd: tmpDir });
    run(['delete', 'toRemove'], { cwd: tmpDir });
    const r = run(['get', 'toRemove'], { cwd: tmpDir });
    expect(r.stdout.trim()).toBe('undefined');
  });

  it('delete prints "Deleted: <key>"', () => {
    run(['set', 'x', 'y'], { cwd: tmpDir });
    const r = run(['delete', 'x'], { cwd: tmpDir });
    expect(r.stdout.trim()).toBe('Deleted: x');
  });

  it('delete without key prints error to stderr', () => {
    const r = run(['delete'], { cwd: tmpDir });
    expect(r.stderr).toContain('Key required');
  });
});

// ── clear ──────────────────────────────────────────────────────────────────

describe('memory.cjs clear', () => {
  it('clear removes all keys', () => {
    run(['set', 'a', '1'], { cwd: tmpDir });
    run(['set', 'b', '2'], { cwd: tmpDir });
    run(['clear'], { cwd: tmpDir });
    const r = run(['get'], { cwd: tmpDir });
    expect(r.stdout.trim()).toBe('{}');
  });

  it('clear prints "Memory cleared"', () => {
    const r = run(['clear'], { cwd: tmpDir });
    expect(r.stdout.trim()).toBe('Memory cleared');
  });
});

// ── keys ───────────────────────────────────────────────────────────────────

describe('memory.cjs keys', () => {
  it('keys returns empty string when no user keys', () => {
    const r = run(['keys'], { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('keys lists user-defined keys', () => {
    run(['set', 'foo', 'bar'], { cwd: tmpDir });
    run(['set', 'baz', 'qux'], { cwd: tmpDir });
    const r = run(['keys'], { cwd: tmpDir });
    const lines = r.stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
    expect(lines).toContain('foo');
    expect(lines).toContain('baz');
  });

  it('keys filters out _prefixed internal keys like _updated', () => {
    run(['set', 'mykey', 'val'], { cwd: tmpDir });
    const r = run(['keys'], { cwd: tmpDir });
    const lines = r.stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
    expect(lines).not.toContain('_updated');
    expect(lines).toContain('mykey');
  });
});

// ── usage message ──────────────────────────────────────────────────────────

describe('memory.cjs usage', () => {
  it('unknown command prints usage', () => {
    const r = run(['unknown'], { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage');
  });

  it('no command prints usage', () => {
    const r = run([], { cwd: tmpDir });
    expect(r.stdout).toContain('Usage');
  });
});
