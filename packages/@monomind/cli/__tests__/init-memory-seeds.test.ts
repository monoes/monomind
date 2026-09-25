/**
 * init seeds project memory (the stack profile and conventions it detected).
 * It used to do that by running `npx --yes monomind@latest memory store` once
 * per seed: a registry download on every init, ignoring --no-memory and
 * --no-install, and killed by an 8s timeout on a cold npx cache. Seeds are now
 * stored in-process into the database init just created, and only when memory
 * is enabled.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../src/commands/init.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

output.setVerbosity('quiet');

const calls = vi.hoisted(() => ({ commands: [] as string[] }));

vi.mock('child_process', () => {
  const record = (cmd: unknown, args?: unknown) => {
    calls.commands.push([cmd, ...(Array.isArray(args) ? args : [])].join(' '));
    throw new Error('mocked: no real process execution in tests');
  };
  return {
    execSync: vi.fn(record),
    execFileSync: vi.fn(record),
    exec: vi.fn(record),
    execFile: vi.fn(record),
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
      proc.unref = () => {};
      proc.kill = () => {};
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      return proc;
    }),
  };
});

/** Keys of the seeds stored in `dir`'s memory store (where `memory search` reads). */
async function seededKeys(dir: string): Promise<string[]> {
  const { listEntries } = await import('../src/memory/memory-initializer.js');
  const previous = process.env.MONOMIND_CWD;
  process.env.MONOMIND_CWD = dir;
  try {
    const listed = await listEntries({ namespace: 'project', limit: 50 });
    return (listed.entries ?? []).map((e: { key: string }) => e.key);
  } finally {
    if (previous === undefined) delete process.env.MONOMIND_CWD;
    else process.env.MONOMIND_CWD = previous;
  }
}

describe('init memory seeds', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;
  const run = (flags: Record<string, unknown> = {}) =>
    initCommand.action!({
      args: [],
      flags: { _: [], 'no-watch': true, 'no-start-all': true, 'no-install': true, ...flags },
      cwd: tmpDir,
      interactive: false,
    } as CommandContext);

  beforeEach(() => {
    calls.commands.length = 0;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-seeds-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-seeds-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    try {
      const bridge = await import('../src/memory/memory-bridge.js');
      await bridge.shutdownBridge();
    } catch {}
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('stores the seeds in-process, without npx', async () => {
    expect((await run()).success).toBe(true);
    expect(calls.commands.filter((c) => /\bnpx\b.*memory store/.test(c))).toEqual([]);
    expect((await seededKeys(tmpDir)).some((k) => k.startsWith('project-profile-'))).toBe(true);
  }, 120000);

  it('stores nothing with --no-memory', async () => {
    expect((await run({ 'no-memory': true })).success).toBe(true);
    expect(calls.commands.filter((c) => /memory store/.test(c))).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, '.swarm', 'memory.db'))).toBe(false);
    expect(await seededKeys(tmpDir)).toEqual([]);
  }, 120000);
});
