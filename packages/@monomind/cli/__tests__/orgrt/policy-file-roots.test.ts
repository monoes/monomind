// packages/@monomind/cli/__tests__/orgrt/policy-file-roots.test.ts
/**
 * #303: the in-process file tools (Read/Write/Edit/Glob/Grep) confined every
 * role to `cwd` while the Bash sandbox already made `$TMPDIR`, the org root
 * and `policy.sandbox.allowWrite` writable — so a role could create a scratch
 * file with Bash but not Read or Edit it, and degraded to heredocs. This file
 * proves the widened PolicyEngine roots (5th ctor param) close that gap
 * without opening a bigger one.
 *
 * Every positive case below FAILS pre-fix with "path escapes org workdir"
 * (the cwd-only check denies everything outside it). Every negative case
 * ALREADY PASSES pre-fix — that is the point: they are the proof the
 * widening does not leak, so they must stay green before *and* after.
 *
 * $HOME is deliberately never a root (see file-roots.ts) — several cases
 * below construct a throwaway HOME (never the operator's real one) and
 * restore `process.env.HOME`/`XDG_RUNTIME_DIR` afterward, the same pattern
 * used by init-project-scope.test.ts and friends.
 */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';

const REAL_TMPDIR = realpathSync(tmpdir());
const scratch = (prefix: string) => realpathSync(mkdtempSync(join(REAL_TMPDIR, prefix)));
const mkBus = () => new OrgBus('o', 'r', scratch('pfr-bus-'));

let prevHome: string | undefined;
let prevXdg: string | undefined;
afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  prevHome = undefined;
  if (prevXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = prevXdg;
  prevXdg = undefined;
});
function fakeHome(): string {
  prevHome = process.env.HOME;
  const home = scratch('pfr-home-');
  process.env.HOME = home;
  return home;
}
function fakeXdgRuntimeDir(): string {
  prevXdg = process.env.XDG_RUNTIME_DIR;
  const dir = join(REAL_TMPDIR, `pfr-xdg-${process.pid}-${Math.floor(Math.random() * 1e9)}`);
  process.env.XDG_RUNTIME_DIR = dir;
  return dir;
}

describe('PolicyEngine roots (#303) — positive: widened roots actually work', () => {
  it("allows a Write into a new file under $TMPDIR — the issue's verbatim reproduction", async () => {
    const cwd = scratch('pfr-cwd-');
    const tmpRoot = scratch('pfr-tmproot-');
    const target = join(tmpRoot, 'checker.mjs');
    const p = new PolicyEngine('verifier', {}, mkBus(), cwd, [tmpRoot]);
    const d = await p.decide('Write', { file_path: target, content: 'console.log(1)\n' });
    expect(d.behavior).toBe('allow');
  });

  it('allows a Read of a file that already exists under $TMPDIR — the round trip', async () => {
    const cwd = scratch('pfr-cwd-');
    const tmpRoot = scratch('pfr-tmproot-');
    const target = join(tmpRoot, 'checker.mjs');
    writeFileSync(target, 'console.log(1)\n');
    const p = new PolicyEngine('verifier', {}, mkBus(), cwd, [tmpRoot]);
    const d = await p.decide('Read', { file_path: target });
    expect(d.behavior).toBe('allow');
  });

  it('allows an Edit under an explicit policy.sandbox.allowWrite entry', async () => {
    const cwd = scratch('pfr-cwd-');
    const allowed = scratch('pfr-allowed-');
    const target = join(allowed, 'f.ts');
    writeFileSync(target, 'export const a = 1;\n');
    const p = new PolicyEngine('coder', {}, mkBus(), cwd, [allowed]);
    const d = await p.decide('Edit', { file_path: target, old_string: 'a = 1', new_string: 'a = 2' });
    expect(d.behavior).toBe('allow');
  });

  it('allows a Read under the org root even though it is outside cwd (e.g. the run evidence dir)', async () => {
    const orgRoot = scratch('pfr-orgroot-');
    const cwd = join(orgRoot, 'work', 'some-role');
    mkdirSync(cwd, { recursive: true });
    const evidenceDir = join(orgRoot, 'runs', 'run-1', 'evidence');
    mkdirSync(evidenceDir, { recursive: true });
    const report = join(evidenceDir, 'report.md');
    writeFileSync(report, '# evidence\n');
    const p = new PolicyEngine('verifier', {}, mkBus(), cwd, [orgRoot]);
    const d = await p.decide('Read', { file_path: report });
    expect(d.behavior).toBe('allow');
  });

  it('an absolute fileRead glob grants a path under it and still denies an outside sibling', async () => {
    const cwd = scratch('pfr-cwd-');
    const allowedDir = scratch('pfr-absglob-allowed-');
    const siblingDir = scratch('pfr-absglob-sibling-');
    writeFileSync(join(allowedDir, 'in.txt'), 'ok\n');
    writeFileSync(join(siblingDir, 'out.txt'), 'nope\n');
    const p = new PolicyEngine('researcher', { fileRead: [`${allowedDir}/**`] }, mkBus(), cwd);
    const inside = await p.decide('Read', { file_path: join(allowedDir, 'in.txt') });
    const outside = await p.decide('Read', { file_path: join(siblingDir, 'out.txt') });
    expect(inside.behavior).toBe('allow');
    expect(outside.behavior).toBe('deny');
  });

  it('unchanged default: with no extra roots, in-cwd paths allow and an out-of-tree path still denies', async () => {
    const cwd = scratch('pfr-cwd-');
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'a.ts'), 'export {};\n');
    const outside = scratch('pfr-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'nope\n');
    const p = new PolicyEngine('coder', {}, mkBus(), cwd);
    const inTree = await p.decide('Read', { file_path: join(cwd, 'src', 'a.ts') });
    const outOfTree = await p.decide('Read', { file_path: join(outside, 'secret.txt') });
    expect(inTree.behavior).toBe('allow');
    expect(outOfTree.behavior).toBe('deny');
  });
});

describe('PolicyEngine roots (#303) — negative: the widening must not leak', () => {
  it('a $TMPDIR-rooted symlink to ~/.ssh is still denied on Read (credential escape)', async () => {
    const home = fakeHome();
    const sshDir = join(home, '.ssh');
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(join(sshDir, 'id_rsa'), 'FAKE-KEY\n');
    const tmpRoot = scratch('pfr-tmproot-');
    symlinkSync(sshDir, join(tmpRoot, 'esc'));
    const cwd = scratch('pfr-cwd-');
    const p = new PolicyEngine('coder', {}, mkBus(), cwd, [tmpRoot]);
    const d = await p.decide('Read', { file_path: join(tmpRoot, 'esc', 'id_rsa') });
    expect(d.behavior).toBe('deny');
  });

  it('a $TMPDIR-rooted symlink to a checkout outside every root is denied on Write', async () => {
    const tmpRoot = scratch('pfr-tmproot-');
    const outsideCheckout = scratch('pfr-outside-checkout-');
    symlinkSync(outsideCheckout, join(tmpRoot, 'esc2'));
    const cwd = scratch('pfr-cwd-');
    const p = new PolicyEngine('coder', {}, mkBus(), cwd, [tmpRoot]);
    const d = await p.decide('Write', { file_path: join(tmpRoot, 'esc2', 'new.ts') });
    expect(d.behavior).toBe('deny');
  });

  it('a $TMPDIR "../sibling" traversal is denied even though the sibling shares a parent', async () => {
    const tmpRoot = scratch('pfr-tmproot-');
    const sibling = scratch('pfr-sibling-');
    writeFileSync(join(sibling, 'secret'), 'nope\n');
    const cwd = scratch('pfr-cwd-');
    const p = new PolicyEngine('coder', {}, mkBus(), cwd, [tmpRoot]);
    const d = await p.decide('Read', {
      file_path: join(tmpRoot, '..', basename(sibling), 'secret'),
    });
    expect(d.behavior).toBe('deny');
  });

  it('a Write into the org root\'s own .git via ".." traversal is still denied (#258)', async () => {
    const repoRoot = scratch('pfr-repo-');
    const orgRoot = join(repoRoot, '.monomind', 'orgs', 'x');
    mkdirSync(orgRoot, { recursive: true });
    mkdirSync(join(repoRoot, '.git'), { recursive: true });
    const p = new PolicyEngine('coder', {}, mkBus(), repoRoot, [orgRoot]);
    const d = await p.decide('Write', {
      file_path: join(orgRoot, '..', '..', '..', '.git', 'config'),
    });
    expect(d.behavior).toBe('deny');
  });

  it("a 'commit'-level Write into the org root's .git/hooks is denied", async () => {
    const orgRoot = scratch('pfr-orgroot-');
    mkdirSync(join(orgRoot, '.git', 'hooks'), { recursive: true });
    const cwd = scratch('pfr-cwd-');
    const p = new PolicyEngine('coder', { git: 'commit' } as never, mkBus(), cwd, [orgRoot]);
    const d = await p.decide('Write', { file_path: join(orgRoot, '.git', 'hooks', 'pre-commit') });
    expect(d.behavior).toBe('deny');
  });

  it('allowWrite: [home] does not open guard-undoing config for Write (HOME_DENY_WRITE)', async () => {
    const home = fakeHome();
    const cwd = scratch('pfr-cwd-');
    const p = new PolicyEngine('coder', {}, mkBus(), cwd, [home]);
    for (const rel of ['.gitconfig', '.bashrc', '.claude.json']) {
      const d = await p.decide('Write', { file_path: join(home, rel) });
      expect(d.behavior, rel).toBe('deny');
    }
  });

  it('allowWrite: [home] does not open credential stores for Read (HOME_DENY_READ)', async () => {
    const home = fakeHome();
    mkdirSync(join(home, '.ssh'), { recursive: true });
    writeFileSync(join(home, '.ssh', 'id_rsa'), 'FAKE-KEY\n');
    writeFileSync(join(home, '.git-credentials'), 'https://x:y@github.com\n');
    mkdirSync(join(home, '.config', 'gh'), { recursive: true });
    writeFileSync(join(home, '.config', 'gh', 'hosts.yml'), 'github.com:\n  oauth_token: x\n');
    const cwd = scratch('pfr-cwd-');
    const p = new PolicyEngine('coder', {}, mkBus(), cwd, [home]);
    for (const rel of ['.ssh/id_rsa', '.git-credentials', '.config/gh/hosts.yml']) {
      const d = await p.decide('Read', { file_path: join(home, rel) });
      expect(d.behavior, rel).toBe('deny');
    }
  });

  it("allowWrite: ['/'] still denies the XDG runtime dir and a daemon socket path", async () => {
    const xdg = fakeXdgRuntimeDir();
    const cwd = scratch('pfr-cwd-');
    const p = new PolicyEngine('coder', {}, mkBus(), cwd, ['/']);
    const runtimeHit = await p.decide('Read', { file_path: join(xdg, 'bus') });
    const socketHit = await p.decide('Read', { file_path: '/run/dbus/system_bus_socket' });
    expect(runtimeHit.behavior).toBe('deny');
    expect(socketHit.behavior).toBe('deny');
  });

  it('a path under a fake $HOME that is not a credential and not in allowWrite is still denied — $HOME is not a root', async () => {
    const home = fakeHome();
    mkdirSync(join(home, 'other-project', 'src'), { recursive: true });
    writeFileSync(join(home, 'other-project', 'src', 'x.ts'), 'export {};\n');
    const cwd = scratch('pfr-cwd-');
    // No allowWrite naming `home` at all.
    const p = new PolicyEngine('coder', {}, mkBus(), cwd);
    const d = await p.decide('Read', { file_path: join(home, 'other-project', 'src', 'x.ts') });
    expect(d.behavior).toBe('deny');
  });

  it('a path-less Glob/Grep under a restricted scope is still denied after the refactor (:284-289 survives)', async () => {
    const cwd = scratch('pfr-cwd-');
    const tmpRoot = scratch('pfr-tmproot-');
    const p = new PolicyEngine('coder', { fileRead: ['src/**'] }, mkBus(), cwd, [tmpRoot]);
    const d = await p.decide('Glob', { pattern: '**/*.env' });
    expect(d.behavior).toBe('deny');
  });
});
