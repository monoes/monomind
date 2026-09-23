/**
 * `monomind init` initializes the memory database by default — the same
 * `.swarm/memory.db` (plus `.claude/memory.db` copy) that `monomind memory
 * init` creates — independent of `--start-all`, idempotently, and never fatally.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMemoryDatabase } from '../src/commands/doctor-project-checks.js';
import { initCommand } from '../src/commands/init.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

output.setVerbosity('quiet');

const memState = vi.hoisted(() => ({ throwOnInit: false }));

vi.mock('../src/memory/memory-initializer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/memory/memory-initializer.js')>();
  return {
    ...actual,
    initializeMemoryDatabase: vi.fn(async (opts: Parameters<typeof actual.initializeMemoryDatabase>[0]) => {
      if (memState.throwOnInit) throw new Error('mocked: native module missing');
      return actual.initializeMemoryDatabase(opts);
    }),
  };
});

vi.mock('child_process', () => ({
  execSync: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  execFileSync: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  exec: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  execFile: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  spawn: vi.fn(() => {
    const proc = new EventEmitter() as EventEmitter & { unref: () => void; kill: () => void };
    proc.unref = () => {};
    proc.kill = () => {};
    return proc;
  }),
}));

async function readEntries(dbPath: string): Promise<string[]> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const rows = db.exec('SELECT key FROM memory_entries ORDER BY key');
  db.close();
  return rows.length ? rows[0].values.map((r) => String(r[0])) : [];
}

async function storeEntry(dbPath: string, key: string): Promise<void> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  db.run(
    "INSERT INTO memory_entries (id, key, namespace, content) VALUES (?, ?, 'default', 'kept')",
    [`id-${key}`, key],
  );
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

describe('init initializes memory by default', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;
  let originalCwd: string;
  let ctx: CommandContext;

  const swarmDb = () => path.join(tmpDir, '.swarm', 'memory.db');
  const claudeDb = () => path.join(tmpDir, '.claude', 'memory.db');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-memory-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-memory-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
    originalCwd = process.cwd();
    memState.throwOnInit = false;
    ctx = {
      args: [],
      flags: { _: [], yes: true, 'no-watch': true, 'no-start-all': true, 'no-install': true },
      cwd: tmpDir,
      interactive: false,
    };
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env.HOME = realHome;
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('creates the memory database with --no-start-all and doctor passes', async () => {
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(fs.existsSync(swarmDb())).toBe(true);
    expect(fs.existsSync(claudeDb())).toBe(true);
    expect(await readEntries(swarmDb())).toEqual([]);

    process.chdir(tmpDir);
    const check = await checkMemoryDatabase();
    expect(check.status).toBe('pass');
  }, 60000);

  it('keeps stored entries when init runs a second time', async () => {
    expect((await initCommand.action!(ctx)).success).toBe(true);
    await storeEntry(swarmDb(), 'survives-reinit');

    ctx.flags = { ...ctx.flags, force: true };
    expect((await initCommand.action!(ctx)).success).toBe(true);

    expect(await readEntries(swarmDb())).toEqual(['survives-reinit']);
  }, 90000);

  it('skips memory initialization with --no-memory', async () => {
    ctx.flags = { ...ctx.flags, memory: false };
    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(fs.existsSync(swarmDb())).toBe(false);
    expect(fs.existsSync(claudeDb())).toBe(false);
  }, 60000);

  it('parses --no-memory from the command line', async () => {
    const { CommandParser } = await import('../src/parser.js');
    const parser = new CommandParser();
    parser.registerCommand(initCommand);
    const parsed = parser.parse(['init', '--no-memory']);
    expect(parsed.flags.memory).toBe(false);
  });

  it('still initializes memory for --minimal', async () => {
    ctx.flags = { ...ctx.flags, minimal: true };
    expect((await initCommand.action!(ctx)).success).toBe(true);
    expect(fs.existsSync(swarmDb())).toBe(true);
  }, 60000);

  it('writes the database but no .claude copy with --skip-claude', async () => {
    ctx.flags = { ...ctx.flags, 'skip-claude': true };
    expect((await initCommand.action!(ctx)).success).toBe(true);
    expect(fs.existsSync(swarmDb())).toBe(true);
    expect(fs.existsSync(claudeDb())).toBe(false);
  }, 60000);

  it('leaves runtime memory alone with --only-claude', async () => {
    ctx.flags = { ...ctx.flags, 'only-claude': true };
    expect((await initCommand.action!(ctx)).success).toBe(true);
    expect(fs.existsSync(swarmDb())).toBe(false);
  }, 60000);

  it('succeeds with a warning naming the fix when memory init throws', async () => {
    memState.throwOnInit = true;
    const warn = vi.spyOn(output, 'printWarning');

    const result = await initCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(fs.existsSync(swarmDb())).toBe(false);
    const warnings = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnings).toContain('native module missing');
    expect(warnings).toContain('monomind memory init');
  }, 60000);
});
