/**
 * Tests for .claude/helpers/loop-tracker.cjs
 * Spawn-based: script reads JSON from stdin and exits.
 * Uses CLAUDE_PROJECT_DIR env to control where loops/ are written.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../.claude/helpers/loop-tracker.cjs');

function run(stdinJson, { cwd } = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    input: stdinJson != null ? JSON.stringify(stdinJson) : undefined,
    cwd: cwd || os.tmpdir(),
    encoding: 'utf-8',
    timeout: 8000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd || os.tmpdir() },
  });
}

function readLoop(dir, sessionId) {
  const loopFile = path.join(dir, '.monomind', 'loops', `${sessionId}.json`);
  return JSON.parse(fs.readFileSync(loopFile, 'utf-8'));
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── early exits ─────────────────────────────────────────────────────────────

describe('loop-tracker early exits', () => {
  it('exits 0 when stdin is empty (TTY simulation via undefined input)', () => {
    // No stdin provided → readStdin returns '' → process.exit(0)
    const r = spawnSync(process.execPath, [SCRIPT], {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 6000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
    });
    expect(r.status).toBe(0);
  });

  it('exits 0 when stdin is whitespace only', () => {
    const r = spawnSync(process.execPath, [SCRIPT], {
      input: '   \n',
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 6000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
    });
    expect(r.status).toBe(0);
  });

  it('exits 0 when stdin is invalid JSON', () => {
    const r = spawnSync(process.execPath, [SCRIPT], {
      input: 'not valid json {{{',
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 6000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
    });
    expect(r.status).toBe(0);
  });

  it('exits 0 when hookInput has no sessionId', () => {
    const r = run({ tool_name: 'ScheduleWakeup', tool_input: { delaySeconds: 60, prompt: '/loop', reason: 'test' } }, { cwd: tmpDir });
    expect(r.status).toBe(0);
    // No loop file created
    const loopsDir = path.join(tmpDir, '.monomind', 'loops');
    const files = fs.existsSync(loopsDir) ? fs.readdirSync(loopsDir) : [];
    expect(files.length).toBe(0);
  });
});

// ── valid input → writes loop file ─────────────────────────────────────────

describe('loop-tracker writes loop state', () => {
  it('creates .monomind/loops/<sessionId>.json for valid input', () => {
    const input = {
      session_id: 'sess-abc123',
      tool_input: { delaySeconds: 120, prompt: '/do something', reason: 'scheduled' },
    };
    run(input, { cwd: tmpDir });
    const loopFile = path.join(tmpDir, '.monomind', 'loops', 'sess-abc123.json');
    expect(fs.existsSync(loopFile)).toBe(true);
  });

  it('loop file contains required fields', () => {
    const input = {
      session_id: 'sess-fields',
      tool_input: { delaySeconds: 60, prompt: '/task run', reason: 'test run' },
    };
    run(input, { cwd: tmpDir });
    const entry = readLoop(tmpDir, 'sess-fields');
    expect(entry).toHaveProperty('id', 'sess-fields');
    expect(entry).toHaveProperty('sessionId', 'sess-fields');
    expect(entry).toHaveProperty('type');
    expect(entry).toHaveProperty('status', 'waiting');
    expect(entry).toHaveProperty('prompt');
    expect(entry).toHaveProperty('startedAt');
    expect(entry).toHaveProperty('lastRunAt');
    expect(entry).toHaveProperty('nextRunAt');
    expect(entry).toHaveProperty('currentRep');
    expect(entry).toHaveProperty('maxReps');
    expect(entry).toHaveProperty('interval');
    expect(entry).toHaveProperty('source', 'schedule_wakeup_hook');
  });

  it('nextRunAt = lastRunAt + delaySeconds * 1000', () => {
    const input = {
      session_id: 'sess-time',
      tool_input: { delaySeconds: 300, prompt: '/task', reason: '' },
    };
    run(input, { cwd: tmpDir });
    const entry = readLoop(tmpDir, 'sess-time');
    expect(entry.nextRunAt - entry.lastRunAt).toBe(300 * 1000);
  });

  it('accepts sessionId via sessionId field (alternate key)', () => {
    const input = {
      sessionId: 'sess-alt',
      tool_input: { delaySeconds: 60, prompt: '/loop', reason: '' },
    };
    run(input, { cwd: tmpDir });
    const loopFile = path.join(tmpDir, '.monomind', 'loops', 'sess-alt.json');
    expect(fs.existsSync(loopFile)).toBe(true);
  });

  it('prompt is truncated to 300 chars', () => {
    const longPrompt = 'x'.repeat(500);
    const input = {
      session_id: 'sess-trunc',
      tool_input: { delaySeconds: 60, prompt: longPrompt, reason: '' },
    };
    run(input, { cwd: tmpDir });
    const entry = readLoop(tmpDir, 'sess-trunc');
    expect(entry.prompt.length).toBeLessThanOrEqual(300);
  });
});

// ── parseRepInfo ────────────────────────────────────────────────────────────

describe('loop-tracker parseRepInfo', () => {
  it('parses N/M from reason string', () => {
    const input = {
      session_id: 'sess-rep',
      tool_input: { delaySeconds: 60, prompt: '/do task', reason: 'repeat run 3/10 of something' },
    };
    run(input, { cwd: tmpDir });
    const entry = readLoop(tmpDir, 'sess-rep');
    expect(entry.currentRep).toBe(3);
    expect(entry.maxReps).toBe(10);
  });

  it('parses --rep from prompt when no N/M in reason', () => {
    const input = {
      session_id: 'sess-rep2',
      tool_input: { delaySeconds: 60, prompt: '/do task --rep 5', reason: 'scheduled' },
    };
    run(input, { cwd: tmpDir });
    const entry = readLoop(tmpDir, 'sess-rep2');
    expect(entry.currentRep).toBe(5);
  });

  it('parses --times from prompt', () => {
    const input = {
      session_id: 'sess-times',
      tool_input: { delaySeconds: 60, prompt: '/loop --times 7', reason: '' },
    };
    run(input, { cwd: tmpDir });
    const entry = readLoop(tmpDir, 'sess-times');
    expect(entry.maxReps).toBe(7);
  });

  it('defaults to currentRep=1, maxReps=0 when no rep info found', () => {
    const input = {
      session_id: 'sess-noRep',
      tool_input: { delaySeconds: 60, prompt: '/do something', reason: 'plain reason' },
    };
    run(input, { cwd: tmpDir });
    const entry = readLoop(tmpDir, 'sess-noRep');
    expect(entry.currentRep).toBe(1);
    expect(entry.maxReps).toBe(0);
  });
});

// ── detectType ──────────────────────────────────────────────────────────────

describe('loop-tracker detectType', () => {
  it('type=repeat when maxReps > 0', () => {
    const input = {
      session_id: 'sess-repeat1',
      tool_input: { delaySeconds: 60, prompt: '/do task', reason: 'run 2/5' },
    };
    run(input, { cwd: tmpDir });
    const entry = readLoop(tmpDir, 'sess-repeat1');
    expect(entry.type).toBe('repeat');
  });

  it('type=repeat when prompt starts with /monomind-repeat', () => {
    const input = {
      session_id: 'sess-repeat2',
      tool_input: { delaySeconds: 60, prompt: '/monomind-repeat --times 3 /do task', reason: '' },
    };
    run(input, { cwd: tmpDir });
    const entry = readLoop(tmpDir, 'sess-repeat2');
    expect(entry.type).toBe('repeat');
  });

  it('type=repeat when prompt starts with /loop', () => {
    const input = {
      session_id: 'sess-repeat3',
      tool_input: { delaySeconds: 60, prompt: '/loop check status', reason: '' },
    };
    run(input, { cwd: tmpDir });
    const entry = readLoop(tmpDir, 'sess-repeat3');
    expect(entry.type).toBe('repeat');
  });

  it('type=do for regular tasks', () => {
    const input = {
      session_id: 'sess-do1',
      tool_input: { delaySeconds: 60, prompt: '/do something', reason: 'scheduled' },
    };
    run(input, { cwd: tmpDir });
    const entry = readLoop(tmpDir, 'sess-do1');
    expect(entry.type).toBe('do');
  });
});
