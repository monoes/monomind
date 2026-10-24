// packages/@monomind/cli/__tests__/orgrt/codex-write-roots.test.ts
/**
 * A codex role's `policy.sandbox.allowWrite` becomes extra
 * `sandbox_workspace_write.writable_roots` of codex's own sandbox. Verified
 * against codex-cli 0.159.3 on decoy dirs: a listed root becomes writable
 * while a sibling and the home stay read-only, and `.git` inside a root stays
 * read-only. These tests cover the filtering and the argv.
 */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { codexSandboxArgs } from '../../src/orgrt/cli-sandbox.js';
import { codexExecArgs } from '../../src/orgrt/codex-runner-stream.js';
import { codexWriteRoots } from '../../src/orgrt/codex-write-roots.js';

function fixture() {
  const base = mkdtempSync(join(process.env.TMPDIR ?? '/var/tmp', 'cwr-'));
  const home = join(base, 'home');
  const cwd = join(home, 'work', 'cwd');
  const orgRoot = join(home, 'work');
  const extra = join(home, 'release');
  const other = join(home, 'other');
  for (const d of [cwd, extra, other, join(home, '.ssh')]) mkdirSync(d, { recursive: true });
  return { base, home, cwd, orgRoot, extra, other, env: {} as NodeJS.ProcessEnv };
}

const roots = (f: ReturnType<typeof fixture>, allowWrite?: string[], denyWrite?: string[]) =>
  codexWriteRoots({
    allowWrite,
    denyWrite,
    cwd: f.cwd,
    orgRoot: f.orgRoot,
    home: f.home,
    env: f.env,
  });

describe('codexWriteRoots', () => {
  it('adds nothing when the policy has no allowWrite', () => {
    const f = fixture();
    expect(roots(f)).toEqual({ roots: [], dropped: [] });
    expect(roots(f, [])).toEqual({ roots: [], dropped: [] });
  });

  it('keeps an existing directory outside the home root, resolved to its real path', () => {
    const f = fixture();
    const r = roots(f, [f.extra, f.extra, join(f.extra, '..', 'other')]);
    expect(r.dropped).toEqual([]);
    expect(r.roots).toEqual([f.extra, f.other]);
  });

  it('resolves a relative entry against the org root', () => {
    const f = fixture();
    mkdirSync(join(f.orgRoot, 'out'));
    expect(roots(f, ['out']).roots).toEqual([join(f.orgRoot, 'out')]);
  });

  it('drops /, the home and any ancestor of it', () => {
    const f = fixture();
    const r = roots(f, ['/', f.home, join(f.home, '..')]);
    expect(r.roots).toEqual([]);
    expect(r.dropped).toHaveLength(3);
    for (const d of r.dropped) expect(d.reason).toMatch(/home|\//);
  });

  it('drops a missing path and a file', () => {
    const f = fixture();
    writeFileSync(join(f.home, 'afile'), 'x');
    const r = roots(f, [join(f.home, 'missing'), join(f.home, 'afile')]);
    expect(r.roots).toEqual([]);
    expect(r.dropped.map((d) => d.reason)).toEqual([
      expect.stringMatching(/does not exist/),
      expect.stringMatching(/not a directory/),
    ]);
  });

  it('drops a symlink, whatever it points at', () => {
    const f = fixture();
    const link = join(f.home, 'link');
    symlinkSync(f.other, link);
    const r = roots(f, [link]);
    expect(r.roots).toEqual([]);
    expect(r.dropped[0].reason).toMatch(/symlink/);
  });

  it('drops credential and operator-protected locations, and roots holding them', () => {
    const f = fixture();
    const r = roots(f, [join(f.home, '.ssh'), f.orgRoot, join(f.home, '.ssh')]);
    // orgRoot holds cwd's protected .claude / .monomind once they exist; here
    // only .ssh is a real directory, so make the others real.
    expect(r.dropped[0].reason).toMatch(/protected|credential/);
    expect(r.roots).not.toContain(join(f.home, '.ssh'));
  });

  it('drops a root that holds a protected path of the org root', () => {
    const f = fixture();
    mkdirSync(join(f.orgRoot, '.claude'));
    mkdirSync(join(f.orgRoot, '.monomind'));
    const r = roots(f, [f.orgRoot]);
    expect(r.roots).toEqual([]);
    expect(r.dropped[0].reason).toMatch(/protected/);
  });

  it('drops the working directory itself as already writable', () => {
    const f = fixture();
    const r = roots(f, [f.cwd]);
    expect(r.roots).toEqual([]);
    expect(r.dropped[0].reason).toMatch(/already writable/);
  });

  it('refuses a root that holds or sits inside a denyWrite entry (codex cannot express a deny)', () => {
    const f = fixture();
    mkdirSync(join(f.extra, 'frozen'));
    const r = roots(f, [f.extra, f.other], [join(f.extra, 'frozen'), f.other]);
    expect(r.roots).toEqual([]);
    expect(r.dropped.map((d) => d.reason)).toEqual([
      expect.stringMatching(/denyWrite/),
      expect.stringMatching(/denyWrite/),
    ]);
  });
});

describe('codex argv carries the roots', () => {
  const base = { tools: [], prompt: (async function* () {})(), systemPrompt: '', cwd: '/w', maxTurns: 1 };
  const roots = (argv: string[]) =>
    argv.filter((a) => a.startsWith('sandbox_workspace_write.writable_roots='));

  it('codexSandboxArgs adds one -c writable_roots for a sandboxed level', () => {
    const args = codexSandboxArgs('commit', ['/a b', '/c"d']);
    expect(args.slice(0, 2)).toEqual(['--sandbox', 'workspace-write']);
    expect(args).toContain('sandbox_workspace_write.network_access=true');
    expect(args).toContain('sandbox_workspace_write.writable_roots=["/a b","/c\\"d"]');
  });

  it('no roots: the argv is byte-identical to before', () => {
    expect(codexSandboxArgs('commit')).toEqual(codexSandboxArgs('commit', []));
    expect(roots(codexSandboxArgs('read', undefined))).toEqual([]);
  });

  it('a push role stays danger-full-access and gets no roots', () => {
    expect(codexSandboxArgs('push', ['/a'])).toEqual(['--sandbox', 'danger-full-access']);
  });

  it('codexExecArgs passes args.writableRoots only on the role-default path', () => {
    const env = { MONOMIND_GIT_LEVEL: 'commit' };
    const withRoots = codexExecArgs({ ...base, env, writableRoots: ['/x'] }, undefined);
    expect(roots(withRoots)).toEqual(['sandbox_workspace_write.writable_roots=["/x"]']);
    const without = codexExecArgs({ ...base, env }, undefined);
    expect(roots(without)).toEqual([]);
    expect(roots(codexExecArgs({ ...base, env, access: 'read', writableRoots: ['/x'] }, undefined))).toEqual([]);
    expect(roots(codexExecArgs({ ...base, env: {}, writableRoots: ['/x'] }, undefined))).toEqual([]);
  });
});
