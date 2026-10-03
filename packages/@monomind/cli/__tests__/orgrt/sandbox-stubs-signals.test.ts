// packages/@monomind/cli/__tests__/orgrt/sandbox-stubs-signals.test.ts
// The holder is run by node itself (--import tsx), not through the tsx wrapper, which would relay or absorb the signals.
// Real processes, real files in a temp dir (never the real HOME), no model. A process that holds sandbox stubs and is
// ended by SIGTERM or SIGINT removes them before it dies (parallel-sweep-3 p1t: a deadline kill left ~/.mcp.json); a
// SIGKILL cannot run a handler, so what it leaves is reclaimed from the ledger afterwards; a path that was there
// before the run, or that someone filled or replaced, is never removed.
import { type ChildProcess, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readLedger } from '../../src/orgrt/sandbox-stubs-ledger.js';
import { SandboxStubs, sandboxStubPaths } from '../../src/orgrt/sandbox-stubs.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, 'stubs-holder.fixture.ts');

const dirs: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function layout() {
  const base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'stubsig-'));
  dirs.push(base);
  const cwd = join(base, 'repo');
  const home = join(base, 'home');
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  mkdirSync(join(cwd, '.git'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  const paths = sandboxStubPaths({ cwd, home, writableRoots: [cwd, home], env: {} });
  return { base, cwd, home, paths, ledger: join(base, 'ledger', 'ledger.json') };
}

/** Starts the holder with a temp HOME and resolves once it holds its stubs. */
async function holder(l: ReturnType<typeof layout>, mode = 'plain') {
  const child = spawn(process.execPath, ['--import', 'tsx', fixture, l.ledger, JSON.stringify(l.paths), mode], {
    env: { ...process.env, HOME: l.home, MONOMIND_ORGRT_STUBS_DIR: join(l.base, 'ledger') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (c) => reject(new Error(`holder exited early (${c})`)));
    child.stdout?.on('data', (d) => String(d).includes('ready') && resolve());
  });
  child.removeAllListeners('exit');
  return child;
}
const ended = (c: ChildProcess) =>
  new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    c.once('exit', (code, signal) => resolve({ code, signal })),
  );
const present = (paths: string[]) => paths.filter((p) => existsSync(p));

describe('a process holding sandbox stubs that receives SIGTERM or SIGINT', () => {
  for (const sig of ['SIGTERM', 'SIGINT'] as const)
    it(`${sig}: removes the stubs it created and ledger entries, then dies by the signal`, async () => {
      const l = layout();
      const pre = present(l.paths); // the two .claude directories the layout makes
      const c = await holder(l);
      expect(present(l.paths).length).toBeGreaterThan(pre.length + 5); // the stubs are really there
      expect(readLedger(l.ledger).length).toBeGreaterThan(5);
      const done = ended(c);
      c.kill(sig);
      expect(await done).toEqual({ code: null, signal: sig }); // default disposition kept: same status as before
      expect(present(l.paths)).toEqual(pre);
      expect(readLedger(l.ledger)).toEqual([]);
    }, 30_000);

  it('SIGTERM with a graceful handler of its own (org run, org serve): that handler decides, the hook does not kill it', async () => {
    const l = layout();
    const pre = present(l.paths);
    const c = await holder(l, 'graceful');
    const done = ended(c);
    c.kill('SIGTERM');
    expect(await done).toEqual({ code: 0, signal: null }); // its own exit, after its own release
    expect(present(l.paths)).toEqual(pre);
  }, 30_000);

  it('never removes a path that existed before the run, empty or not, nor one someone filled or replaced during it', async () => {
    const l = layout();
    const mcp = l.paths.find((p) => p.startsWith(l.home) && p.endsWith('.mcp.json')) as string;
    const rc = l.paths.find((p) => p.endsWith('repo/.bashrc')) as string;
    writeFileSync(mcp, ''); // a pre-existing empty 0444 file, like an owner-held ~/.mcp.json: not ours
    chmodSync(mcp, 0o444);
    writeFileSync(rc, '# mine\n'); // pre-existing and non-empty
    const pre = present(l.paths);
    const c = await holder(l);
    const filled = l.paths.find((p) => p.endsWith('repo/.gitconfig')) as string;
    chmodSync(filled, 0o644);
    writeFileSync(filled, '[user]\n'); // filled during the run
    const done = ended(c);
    c.kill('SIGTERM');
    await done;
    expect(readFileSync(mcp, 'utf8')).toBe('');
    expect(readFileSync(rc, 'utf8')).toBe('# mine\n');
    expect(readFileSync(filled, 'utf8')).toBe('[user]\n');
    expect(present(l.paths).sort()).toEqual([...pre, filled].sort());
  }, 30_000);
});

describe('SIGKILL cannot run a handler; the ledger reclaim afterwards removes only what the runtime created', () => {
  it('leaves the stubs, then reclaim() removes them, a path that was there before stays, and a second reclaim is harmless', async () => {
    const l = layout();
    const mcp = l.paths.find((p) => p.startsWith(l.home) && p.endsWith('.mcp.json')) as string;
    writeFileSync(mcp, '');
    chmodSync(mcp, 0o444);
    const pre = present(l.paths); // includes the pre-existing .mcp.json
    const c = await holder(l);
    const created = present(l.paths).filter((p) => !pre.includes(p));
    expect(created.length).toBeGreaterThan(5);
    const done = ended(c);
    c.kill('SIGKILL');
    expect((await done).signal).toBe('SIGKILL');
    expect(present(l.paths).length).toBe(pre.length + created.length); // litter, as p1t left ~/.mcp.json
    const removed = new SandboxStubs(l.ledger).reclaim();
    expect(removed.sort()).toEqual(created.sort());
    expect(present(l.paths)).toEqual(pre); // the pre-existing .mcp.json is not ours: never removed
    expect(readFileSync(mcp, 'utf8')).toBe('');
    expect(readLedger(l.ledger)).toEqual([]);
    expect(new SandboxStubs(l.ledger).reclaim()).toEqual([]); // twice is harmless
    expect(present(l.paths)).toEqual(pre);
  }, 30_000);
});
