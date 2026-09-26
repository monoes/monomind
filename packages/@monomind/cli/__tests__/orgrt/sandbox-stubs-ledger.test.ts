// packages/@monomind/cli/__tests__/orgrt/sandbox-stubs-ledger.test.ts
/** The crash ledger of sandbox-stubs.ts: stubs a dead runtime left behind are
 *  reclaimed by the next one, under the same rule as its own cleanup. */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultStubLedger,
  type LedgerEntry,
  SandboxStubs,
  sandboxStubPaths,
} from '../../src/orgrt/sandbox-stubs.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A pid that no longer runs. */
const deadPid = (): number => spawnSync('true').pid as number;

function layout() {
  const base = mkdtempSync(join(tmpdir(), 'stub-ledger-'));
  dirs.push(base);
  const cwd = join(base, 'repo');
  const home = join(base, 'home');
  mkdirSync(cwd);
  mkdirSync(join(home, '.claude'), { recursive: true });
  const ledger = join(base, 'state', 'ledger.json');
  const paths = sandboxStubPaths({ cwd, home, writableRoots: [cwd, home], env: {} });
  return { base, cwd, home, ledger, paths };
}

const read = (ledger: string): LedgerEntry[] => JSON.parse(readFileSync(ledger, 'utf8')).entries;

/** A runtime that created its stubs and then died without cleaning up. */
function crashedRun(l: ReturnType<typeof layout>, pid = deadPid()): string[] {
  const created = new SandboxStubs(l.ledger).hold('org:run-1', l.paths);
  const entries = read(l.ledger).map((e) => ({ ...e, pid }));
  writeFileSync(l.ledger, JSON.stringify({ entries }));
  return created;
}

describe('the sandbox stub ledger', () => {
  it('lives in a per-machine state dir, overridable by MONOMIND_ORGRT_STUBS_DIR', () => {
    expect(defaultStubLedger({ MONOMIND_ORGRT_STUBS_DIR: '/state' })).toBe('/state/ledger.json');
    expect(defaultStubLedger({})).toMatch(/\.monomind\/orgrt-sandbox-stubs\/ledger\.json$/);
  });

  it('records every stub it creates and forgets it on normal cleanup', () => {
    const l = layout();
    const stubs = new SandboxStubs(l.ledger);
    const created = stubs.hold('org:run-1', l.paths);
    const entries = read(l.ledger);
    expect(entries.map((e) => e.path).sort()).toEqual([...created].sort());
    const dot = entries.find((e) => e.path === join(l.cwd, '.claude'));
    expect(dot).toMatchObject({ kind: 'dir', pid: process.pid, runId: 'org:run-1' });
    expect(typeof dot?.ino).toBe('number');
    expect(typeof dot?.dev).toBe('number');
    expect(Number.isNaN(Date.parse(dot?.createdAt ?? ''))).toBe(false);
    expect(entries.find((e) => e.path === join(l.cwd, '.bashrc'))?.kind).toBe('file');
    stubs.release('org:run-1');
    expect(read(l.ledger)).toEqual([]);
  });

  it("reclaims a dead runtime's stubs before creating its own", () => {
    const l = layout();
    const left = crashedRun(l);
    const next = new SandboxStubs(l.ledger);
    expect(next.reclaim().sort()).toEqual([...left].sort());
    for (const p of left) expect(existsSync(p)).toBe(false);
    expect(read(l.ledger)).toEqual([]);
  });

  it('reclaims on the first hold, then creates fresh stubs', () => {
    const l = layout();
    const left = crashedRun(l);
    const next = new SandboxStubs(l.ledger);
    const created = next.hold('org:run-2', l.paths);
    expect(created.sort()).toEqual([...left].sort());
    expect(read(l.ledger).every((e) => e.pid === process.pid && e.runId === 'org:run-2')).toBe(
      true,
    );
  });

  it('keeps the stubs of a runtime that is still alive', () => {
    const l = layout();
    const left = crashedRun(l, process.ppid);
    expect(new SandboxStubs(l.ledger).reclaim()).toEqual([]);
    for (const p of left) expect(existsSync(p)).toBe(true);
    expect(read(l.ledger)).toHaveLength(left.length);
  });

  it('adopts a dead runtime’s stubs while another live runtime may be using them', () => {
    const l = layout();
    const left = crashedRun(l);
    const live = { ...read(l.ledger)[0], path: join(l.base, 'other', '.bashrc'), pid: process.ppid };
    writeFileSync(l.ledger, JSON.stringify({ entries: [...read(l.ledger), live] }));
    const next = new SandboxStubs(l.ledger);
    expect(next.reclaim()).toEqual([]);
    for (const p of left) expect(existsSync(p)).toBe(true);
    // Held by this runtime now, and removed when its run ends.
    expect(read(l.ledger).filter((e) => e.pid === process.pid)).toHaveLength(left.length);
    expect(next.release('org:run-2').sort()).toEqual([...left].sort());
    expect(read(l.ledger)).toEqual([live]);
  });

  it('leaves a leftover that was written to, replaced or filled, and forgets it', () => {
    const l = layout();
    crashedRun(l);
    const written = join(l.cwd, '.bashrc');
    chmodSync(written, 0o644);
    writeFileSync(written, 'export X=1\n');
    const replaced = join(l.home, '.claude', 'commands');
    unlinkSync(replaced);
    mkdirSync(replaced);
    const filled = join(l.cwd, '.claude');
    writeFileSync(join(filled, 'mine.md'), 'x');
    const removed = new SandboxStubs(l.ledger).reclaim();
    expect(removed).not.toContain(written);
    expect(removed).not.toContain(replaced);
    expect(removed).not.toContain(filled);
    expect(readFileSync(written, 'utf8')).toBe('export X=1\n');
    expect(existsSync(replaced)).toBe(true);
    expect(existsSync(join(filled, 'mine.md'))).toBe(true);
    expect(read(l.ledger)).toEqual([]);
  });

  it('never reclaims a path that is not a stub name, whatever the ledger says', () => {
    const l = layout();
    const precious = join(l.cwd, 'precious.txt');
    writeFileSync(precious, '');
    const st = lstatSync(precious);
    const entry: LedgerEntry = {
      path: precious,
      ino: st.ino,
      dev: st.dev,
      kind: 'file',
      pid: deadPid(),
      runId: 'forged',
      createdAt: new Date().toISOString(),
    };
    mkdirSync(join(l.base, 'state'));
    writeFileSync(l.ledger, JSON.stringify({ entries: [entry] }));
    expect(new SandboxStubs(l.ledger).reclaim()).toEqual([]);
    expect(existsSync(precious)).toBe(true);
  });

  it('ignores a corrupt or missing ledger and writes a valid one', () => {
    const l = layout();
    expect(new SandboxStubs(l.ledger).reclaim()).toEqual([]);
    mkdirSync(join(l.base, 'state'));
    writeFileSync(l.ledger, '{"entries": [ not json');
    const stubs = new SandboxStubs(l.ledger);
    const created = stubs.hold('org:run-1', l.paths);
    expect(created.length).toBeGreaterThan(0);
    expect(read(l.ledger)).toHaveLength(created.length);
    writeFileSync(l.ledger, '{"entries": [{"path": 3}, null, "x"]}');
    expect(new SandboxStubs(l.ledger).reclaim()).toEqual([]);
    for (const p of created) expect(existsSync(p)).toBe(true);
  });
});

/** The Claude SDK sandbox runs every role with `bwrap --unshare-pid`, so a
 *  role's own `process.kill(hostPid, 0)` always throws ESRCH for the host
 *  daemon's real pid even though it is alive — reclaim() must not read that
 *  as dead. These inject a fake identity (never touching real /proc) so the
 *  same-boot/different-boot and same-namespace/different-namespace cases can
 *  be driven directly instead of relying on this machine's actual namespace. */
describe('pid-namespace and boot-id aware reclaim', () => {
  const identity = (pidNamespace: string, bootId: string) => ({
    pidNamespace: () => pidNamespace,
    bootId: () => bootId,
  });

  /** Same fields the ledger recorded, minus pidNamespace/bootId: what an
   *  entry written before this change looked like. */
  const asLegacy = (e: LedgerEntry, pid: number): LedgerEntry => ({
    path: e.path,
    ino: e.ino,
    dev: e.dev,
    kind: e.kind,
    pid,
    runId: e.runId,
    createdAt: e.createdAt,
  });

  it('reclaims a same-boot, same-namespace entry whose pid is dead', () => {
    const l = layout();
    const created = new SandboxStubs(l.ledger, identity('ns-A', 'boot-1')).hold('org:run-1', l.paths);
    const entries = read(l.ledger).map((e) => ({ ...e, pid: deadPid() }));
    writeFileSync(l.ledger, JSON.stringify({ entries }));
    const next = new SandboxStubs(l.ledger, identity('ns-A', 'boot-1'));
    expect(next.reclaim().sort()).toEqual([...created].sort());
    for (const p of created) expect(existsSync(p)).toBe(false);
    expect(read(l.ledger)).toEqual([]);
  });

  it('leaves a same-boot, different-namespace entry alone even when our own alive() check says dead', () => {
    const l = layout();
    const created = new SandboxStubs(l.ledger, identity('ns-A', 'boot-1')).hold('org:run-1', l.paths);
    // deadPid(): our sandboxed alive() would call this dead. A real cross-namespace
    // daemon looks exactly the same to us (ESRCH), which is the bug this guards.
    const entries = read(l.ledger).map((e) => ({ ...e, pid: deadPid(), pidNamespace: 'ns-B' }));
    writeFileSync(l.ledger, JSON.stringify({ entries }));
    const next = new SandboxStubs(l.ledger, identity('ns-A', 'boot-1'));
    expect(next.reclaim()).toEqual([]);
    for (const p of created) expect(existsSync(p)).toBe(true);
    expect(read(l.ledger)).toHaveLength(created.length);
  });

  it('reclaims a different-boot entry even though its pid still resolves to a live process', () => {
    const l = layout();
    const created = new SandboxStubs(l.ledger, identity('ns-A', 'boot-OLD')).hold('org:run-1', l.paths);
    // process.ppid: alive() would say alive, but a stale boot id means the pid
    // number is meaningless (possibly a different, unrelated process reusing it).
    const entries = read(l.ledger).map((e) => ({ ...e, pid: process.ppid }));
    writeFileSync(l.ledger, JSON.stringify({ entries }));
    const next = new SandboxStubs(l.ledger, identity('ns-A', 'boot-NEW'));
    expect(next.reclaim().sort()).toEqual([...created].sort());
    for (const p of created) expect(existsSync(p)).toBe(false);
    expect(read(l.ledger)).toEqual([]);
  });

  it('falls back to the bare pid check for a legacy entry with no namespace/boot fields', () => {
    const l = layout();
    const created = new SandboxStubs(l.ledger, identity('ns-A', 'boot-1')).hold('org:run-1', l.paths);
    const entries = read(l.ledger).map((e) => asLegacy(e, deadPid()));
    writeFileSync(l.ledger, JSON.stringify({ entries }));
    // Different namespace/boot than when it was written: must not matter for a legacy entry.
    const next = new SandboxStubs(l.ledger, identity('ns-B', 'boot-2'));
    expect(next.reclaim().sort()).toEqual([...created].sort());
    for (const p of created) expect(existsSync(p)).toBe(false);
  });

  it('keeps a legacy entry whose bare pid is alive', () => {
    const l = layout();
    const created = new SandboxStubs(l.ledger, identity('ns-A', 'boot-1')).hold('org:run-1', l.paths);
    const entries = read(l.ledger).map((e) => asLegacy(e, process.ppid));
    writeFileSync(l.ledger, JSON.stringify({ entries }));
    const next = new SandboxStubs(l.ledger, identity('ns-B', 'boot-2'));
    expect(next.reclaim()).toEqual([]);
    for (const p of created) expect(existsSync(p)).toBe(true);
  });
});
