// packages/@monomind/cli/__tests__/orgrt/policy-directory-scopes.test.ts
/**
 * #492: a fileWrite/fileRead entry with no glob characters names a directory
 * (or file) and grants that path AND everything beneath it. Before the fix
 * such an entry was matched as a glob, i.e. only the exact path, so every
 * file inside `…/growth/site` was denied while the deny message told the role
 * it "may use …/growth/site".
 */
import { mkdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { scopeEntryFindings } from '../../src/orgrt/policy-scopes.js';
import { RolePolicySchema } from '../../src/orgrt/types-policy.js';

const REAL_TMPDIR = realpathSync(tmpdir());
const scratch = (prefix: string) => realpathSync(mkdtempSync(join(REAL_TMPDIR, prefix)));
const mkBus = () => new OrgBus('o', 'r', scratch('pds-bus-'));
const msg = (d: { behavior: string; message?: string }) => (d.behavior === 'deny' ? d.message : '');

const saved = new Map<string, string | undefined>();
function setEnv(k: string, v: string): void {
  if (!saved.has(k)) saved.set(k, process.env[k]);
  process.env[k] = v;
}
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
});
/** A throwaway $HOME (never the operator's real one). */
function fakeHome(): string {
  const home = scratch('pds-home-');
  setEnv('HOME', home);
  return home;
}

/** A growth-shaped layout outside the org workdir: `site`, its shared-prefix
 *  sibling `site-old`, and a nested file. */
function growth() {
  const cwd = scratch('pds-cwd-');
  const base = scratch('pds-growth-');
  const site = join(base, 'site');
  mkdirSync(join(site, 'blog', 'posts'), { recursive: true });
  mkdirSync(join(base, 'site-old'), { recursive: true });
  writeFileSync(join(site, 'index.html'), '<html/>\n');
  writeFileSync(join(site, 'blog', 'posts', 'a.md'), '# a\n');
  writeFileSync(join(base, 'site-old', 'index.html'), '<html/>\n');
  return { cwd, base, site };
}

describe('#492 — absolute directory scope (the issue shape: a bare absolute directory)', () => {
  it('allows a file directly inside it, a deeper nested file, and the directory itself', async () => {
    const { cwd, site } = growth();
    const p = new PolicyEngine('site-seo', { fileWrite: [site] }, mkBus(), cwd);
    expect((await p.decide('Write', { file_path: join(site, 'index.html'), content: 'x' })).behavior).toBe(
      'allow',
    );
    expect(
      (await p.decide('Edit', { file_path: join(site, 'blog', 'posts', 'a.md'), old_string: 'a', new_string: 'b' }))
        .behavior,
    ).toBe('allow');
    expect((await p.decide('Write', { file_path: join(site, 'new', 'deep', 'f.css'), content: 'x' })).behavior).toBe(
      'allow',
    );
    // The directory itself (a Grep rooted at it, under the matching read scope).
    const r = new PolicyEngine('site-seo', { fileRead: [site] }, mkBus(), cwd);
    expect((await r.decide('Grep', { path: site, pattern: 'x' })).behavior).toBe('allow');
  });

  it('denies a sibling that shares the prefix (site-old vs site)', async () => {
    const { cwd, base, site } = growth();
    const p = new PolicyEngine('site-seo', { fileWrite: [site] }, mkBus(), cwd);
    const d = await p.decide('Write', { file_path: join(base, 'site-old', 'index.html'), content: 'x' });
    expect(d.behavior).toBe('deny');
    const d2 = await p.decide('Write', { file_path: `${site}-old`, content: 'x' });
    expect(d2.behavior).toBe('deny');
  });

  it('a trailing slash on the entry means the same directory', async () => {
    const { cwd, site } = growth();
    const p = new PolicyEngine('site-seo', { fileWrite: [`${site}/`] }, mkBus(), cwd);
    expect((await p.decide('Write', { file_path: join(site, 'index.html'), content: 'x' })).behavior).toBe(
      'allow',
    );
  });

  it('read scope behaves the same', async () => {
    const { cwd, base, site } = growth();
    const p = new PolicyEngine('analyst', { fileRead: [site] }, mkBus(), cwd);
    expect((await p.decide('Read', { file_path: join(site, 'blog', 'posts', 'a.md') })).behavior).toBe('allow');
    expect((await p.decide('Glob', { path: site, pattern: '**/*.md' })).behavior).toBe('allow');
    expect((await p.decide('Read', { file_path: join(base, 'site-old', 'index.html') })).behavior).toBe('deny');
  });

  it('a symlink inside the directory scope that points outside it is denied', async () => {
    const { cwd, site } = growth();
    const outside = scratch('pds-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'nope\n');
    symlinkSync(outside, join(site, 'esc'));
    const p = new PolicyEngine('site-seo', { fileWrite: [site], fileRead: [site] }, mkBus(), cwd);
    expect((await p.decide('Read', { file_path: join(site, 'esc', 'secret.txt') })).behavior).toBe('deny');
    expect((await p.decide('Write', { file_path: join(site, 'esc', 'new.txt'), content: 'x' })).behavior).toBe(
      'deny',
    );
  });

  it('a fileToolDenied path inside a directory scope is still denied', async () => {
    const { cwd, site } = growth();
    const runtime = join(site, 'xdg-runtime');
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, 'bus.sock'), '');
    setEnv('XDG_RUNTIME_DIR', runtime);
    const p = new PolicyEngine('coder', { fileRead: [site], fileWrite: [site] }, mkBus(), cwd);
    expect((await p.decide('Read', { file_path: join(runtime, 'bus.sock') })).behavior).toBe('deny');
    expect((await p.decide('Write', { file_path: join(runtime, 'x'), content: 'x' })).behavior).toBe('deny');
    // …while an ordinary file in the same directory scope is allowed.
    expect((await p.decide('Write', { file_path: join(site, 'notes.txt'), content: 'x' })).behavior).toBe('allow');
  });

  it('the .git write check still applies inside a directory scope', async () => {
    const { cwd, site } = growth();
    mkdirSync(join(site, '.git'), { recursive: true });
    const p = new PolicyEngine('site-seo', { fileWrite: [site] }, mkBus(), cwd);
    const d = await p.decide('Write', { file_path: join(site, '.git', 'config'), content: 'x' });
    expect(d.behavior).toBe('deny');
  });
});

describe('#492 — relative directory scope', () => {
  it('resolves against the org workdir and grants everything beneath it', async () => {
    const cwd = scratch('pds-cwd-');
    mkdirSync(join(cwd, 'reports', '2026', 'q3'), { recursive: true });
    mkdirSync(join(cwd, 'reports-old'), { recursive: true });
    const p = new PolicyEngine('analyst', { fileWrite: ['reports'], fileRead: ['./reports'] }, mkBus(), cwd);
    expect((await p.decide('Write', { file_path: 'reports/summary.md', content: 'x' })).behavior).toBe('allow');
    expect((await p.decide('Write', { file_path: join(cwd, 'reports', '2026', 'q3', 'a.md'), content: 'x' })).behavior).toBe(
      'allow',
    );
    expect((await p.decide('Read', { file_path: 'reports/2026/q3/a.md' })).behavior).toBe('allow');
    expect((await p.decide('Grep', { path: 'reports', pattern: 'x' })).behavior).toBe('allow');
    expect((await p.decide('Write', { file_path: 'reports-old/a.md', content: 'x' })).behavior).toBe('deny');
    expect((await p.decide('Write', { file_path: 'other.md', content: 'x' })).behavior).toBe('deny');
  });

  it('a relative directory entry that escapes every root is still refused', async () => {
    const cwd = scratch('pds-cwd-');
    const p = new PolicyEngine('analyst', { fileWrite: ['..'] }, mkBus(), cwd);
    const d = await p.decide('Write', { file_path: join(cwd, '..', 'x.md'), content: 'x' });
    expect(d.behavior).toBe('deny');
  });
});

describe('#492 — glob entries keep their glob semantics', () => {
  it('a relative glob still matches only what the glob says', async () => {
    const cwd = scratch('pds-cwd-');
    mkdirSync(join(cwd, 'src', 'deep'), { recursive: true });
    const p = new PolicyEngine('coder', { fileWrite: ['src/*.ts'] }, mkBus(), cwd);
    expect((await p.decide('Write', { file_path: 'src/a.ts', content: 'x' })).behavior).toBe('allow');
    expect((await p.decide('Write', { file_path: 'src/deep/a.ts', content: 'x' })).behavior).toBe('deny');
    expect((await p.decide('Write', { file_path: 'src/a.js', content: 'x' })).behavior).toBe('deny');
  });

  it('an absolute glob still matches only what the glob says', async () => {
    const { cwd, site } = growth();
    const p = new PolicyEngine('site-seo', { fileWrite: [`${site}/*.html`] }, mkBus(), cwd);
    expect((await p.decide('Write', { file_path: join(site, 'index.html'), content: 'x' })).behavior).toBe('allow');
    expect((await p.decide('Write', { file_path: join(site, 'blog', 'posts', 'a.md'), content: 'x' })).behavior).toBe(
      'deny',
    );
  });
});

describe('#492 — the deny message says how each scope entry matches', () => {
  it('labels a bare path as a directory grant and a wildcard entry as a glob', async () => {
    const { cwd, base, site } = growth();
    const p = new PolicyEngine('site-seo', { fileWrite: [site, 'src/**/*.ts'] }, mkBus(), cwd);
    // Inside the workdir but outside every scope entry: the scope deny.
    const d = await p.decide('Write', { file_path: 'notes.md', content: 'x' });
    expect(d.behavior).toBe('deny');
    expect(msg(d)).toContain(`${site} (directory: this path and everything beneath it)`);
    expect(msg(d)).toContain('src/**/*.ts (glob)');
    // Outside every root: the root deny also names the absolute directory grant.
    const e = await p.decide('Write', { file_path: join(base, 'site-old', 'index.html'), content: 'x' });
    expect(e.behavior).toBe('deny');
    expect(msg(e)).toContain(`write scope also grants ${site} (directory: this path and everything beneath it)`);
  });
});

describe('#492 B1 — a directory grant is fixed at startup; the role cannot widen it', () => {
  /** Replace `dir` with a symlink to `to`, as a role could from Bash. */
  const swap = (dir: string, to: string) => {
    renameSync(dir, `${dir}.moved`);
    symlinkSync(to, dir);
  };

  it('an entry swapped for a symlink to / after startup grants nothing outside it', async () => {
    const { cwd, site } = growth();
    const p = new PolicyEngine('site-seo', { fileWrite: [site], fileRead: [site] }, mkBus(), cwd);
    swap(site, '/');
    const w = await p.decide('Write', { file_path: join(site, 'etc', 'cron.d', 'x'), content: 'x' });
    expect(w.behavior).toBe('deny');
    expect(msg(w)).toContain('changed after the role started');
    expect((await p.decide('Read', { file_path: join(site, 'etc', 'passwd') })).behavior).toBe('deny');
  });

  it('an entry swapped for a symlink to $HOME after startup grants nothing in $HOME', async () => {
    const home = fakeHome();
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    const { cwd, site } = growth();
    const p = new PolicyEngine('site-seo', { fileWrite: [site], fileRead: [site] }, mkBus(), cwd);
    swap(site, home);
    expect((await p.decide('Write', { file_path: join(site, '.local', 'bin', 'git'), content: 'x' })).behavior).toBe(
      'deny',
    );
    expect((await p.decide('Read', { file_path: join(site, '.aws', 'credentials') })).behavior).toBe('deny');
  });

  it('an entry that did not exist at startup and is then created as a symlink grants nothing', async () => {
    const home = fakeHome();
    const { cwd, base } = growth();
    const out = join(base, 'out-not-yet');
    const p = new PolicyEngine('analyst', { fileWrite: [out] }, mkBus(), cwd);
    symlinkSync(home, out);
    const d = await p.decide('Write', { file_path: join(out, '.bashrc.d', 'evil'), content: 'x' });
    expect(d.behavior).toBe('deny');
    expect(msg(d)).toContain('changed after the role started');
  });

  it('an entry that did not exist at startup and is then created as a real directory works', async () => {
    const { cwd, base } = growth();
    const out = join(base, 'out-later');
    const p = new PolicyEngine('analyst', { fileWrite: [out] }, mkBus(), cwd);
    mkdirSync(out);
    expect((await p.decide('Write', { file_path: join(out, 'a.md'), content: 'x' })).behavior).toBe('allow');
  });

  it('a relative entry swapped for a symlink to the workdir (reports -> .) grants nothing more', async () => {
    const cwd = scratch('pds-cwd-');
    mkdirSync(join(cwd, 'reports'));
    const p = new PolicyEngine('analyst', { fileWrite: ['reports'] }, mkBus(), cwd);
    swap(join(cwd, 'reports'), '.');
    const d = await p.decide('Write', { file_path: 'reports/package.json', content: 'x' });
    expect(d.behavior).toBe('deny');
    expect((await p.decide('Write', { file_path: 'package.json', content: 'x' })).behavior).toBe('deny');
  });

  it('an entry that is already a symlink at startup is refused, with a message naming why', async () => {
    const { cwd, base, site } = growth();
    const link = join(base, 'site-link');
    symlinkSync(site, link);
    const p = new PolicyEngine('site-seo', { fileWrite: [link] }, mkBus(), cwd);
    const d = await p.decide('Write', { file_path: join(link, 'index.html'), content: 'x' });
    expect(d.behavior).toBe('deny');
    expect(msg(d)).toContain(`scope entry ${link} resolves through a symlink`);
  });

  it('/, $HOME and an ancestor of $HOME are refused as directory grants; a glob says so explicitly', async () => {
    const home = fakeHome();
    const cwd = scratch('pds-cwd-');
    for (const entry of ['/', home, join(home, '..')]) {
      const p = new PolicyEngine('coder', { fileWrite: [entry] }, mkBus(), cwd);
      const d = await p.decide('Write', { file_path: join(home, 'notes.txt'), content: 'x' });
      expect(d.behavior, entry).toBe('deny');
      expect(msg(d), entry).toContain('too broad for a directory grant');
      expect(msg(d), entry).toContain('/**');
    }
    // The explicit glob still grants (and the deny list still applies inside it).
    const g = new PolicyEngine('coder', { fileWrite: [`${home}/**`] }, mkBus(), cwd);
    expect((await g.decide('Write', { file_path: join(home, 'notes.txt'), content: 'x' })).behavior).toBe('allow');
    expect((await g.decide('Write', { file_path: join(home, '.bashrc'), content: 'x' })).behavior).toBe('deny');
  });
});

describe('#492 — an engine built with no policy', () => {
  it('constructs and decides without throwing, and on reload', async () => {
    const cwd = scratch('pds-cwd-');
    const p = new PolicyEngine('r', undefined as never, mkBus(), cwd);
    expect((await p.decide('Write', { file_path: join(cwd, 'a.md'), content: 'x' })).behavior).toBe('allow');
    expect((await p.decide('Read', { file_path: join(cwd, 'a.md') })).behavior).toBe('allow');
    p.updatePolicy(undefined as never);
    expect((await p.decide('Read', { file_path: join(cwd, 'a.md') })).behavior).toBe('allow');
  });
});

describe('#492 — schema and org validate', () => {
  it('rejects an empty-string scope entry', () => {
    expect(RolePolicySchema.safeParse({ fileWrite: [''] }).success).toBe(false);
    expect(RolePolicySchema.safeParse({ fileRead: [''] }).success).toBe(false);
    expect(RolePolicySchema.safeParse({ fileWrite: ['reports'] }).success).toBe(true);
  });

  it('warns for a missing absolute entry and a relative entry leaving the workdir; errors for too-broad and symlinked entries', () => {
    const home = scratch('pds-home-');
    const { base, site } = growth();
    const missing = join(site, 'nope');
    const link = join(base, 'site-link');
    symlinkSync(site, link);
    const { errors, warnings } = scopeEntryFindings(
      [
        {
          id: 'seo',
          policy: { fileWrite: [site, missing, `${missing}/**`, 'relative/dir', '../up'], fileRead: [missing, link] },
        },
        { id: 'root', policy: { fileWrite: ['/', home, `${home}/**`] } },
      ],
      home,
    );
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain(`role "seo": policy.fileWrite entry ${missing} does not exist`);
    expect(warnings[1]).toContain('entry ../up resolves outside the role');
    expect(warnings[2]).toContain('policy.fileRead');
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain(`scope entry ${link} resolves through a symlink`);
    expect(errors[1]).toContain('role "root": policy.fileWrite: scope entry / is the filesystem root');
    expect(errors[2]).toContain(`scope entry ${home} is the filesystem root, $HOME or an ancestor`);
  });
});
