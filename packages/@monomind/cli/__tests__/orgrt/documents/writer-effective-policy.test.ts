// packages/@monomind/cli/__tests__/orgrt/documents/writer-effective-policy.test.ts
// P4.4: the one effective policy (effective-role-policy.ts) that both the policy engine and the sandbox layer read.
// Scripted, no model: a literal definition, the real PolicyEngine and the real sandbox restrictions builder.
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { mkdtempSync } from '../../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../../../src/orgrt/bus.js';
import { effectiveRole, effectiveRolePolicy } from '../../../src/orgrt/effective-role-policy.js';
import type { PolicyEngine } from '../../../src/orgrt/policy.js';
import { resolveRoleGitEnforcement } from '../../../src/orgrt/role-sandbox.js';
import { OrgDefSchema, type OrgDef, type OrgRole } from '../../../src/orgrt/types.js';
import { WriterPolicyEngine } from '../../../src/orgrt/writer-engine.js';
import { sectionsRaw } from '../support/sections-defs.js';

type Raw = Record<string, any>;
const NO_FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const tmp = (p: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), p)));
const def = (patch: (raw: Raw) => void = () => {}): OrgDef => OrgDefSchema.parse(sectionsRaw(patch));
const oneWriter = (raw: Raw) => {
  raw.sections.research.writes = ['src/**'];
  raw.roles.find((r: Raw) => r.id === 'research-lead').policy = { denyTools: [...NO_FILE_TOOLS, 'Bash'] };
};
const roleOf = (d: OrgDef, id: string): OrgRole => d.roles.find((r) => r.id === id) as OrgRole;

/** A project directory (a git repository, as role cwds are) with a src/ directory. */
function project() {
  const root = tmp('wep-');
  spawnSync('git', ['init', '-q', root]);
  mkdirSync(join(root, 'src'));
  return root;
}

describe('effectiveRolePolicy: when it does nothing', () => {
  it('returns the role policy object itself for every role of a sections org without writes', () => {
    const d = def();
    for (const r of d.roles) expect(effectiveRolePolicy(d, r, { orgRoot: '/x', workdir: '/x' })).toBe(r.policy);
  });

  it('returns the role policy itself when writes is an empty list, and for an org off the surface', () => {
    const empty = def((r) => (r.sections.research.writes = []));
    for (const r of empty.roles) expect(effectiveRolePolicy(empty, r)).toBe(r.policy);
    const off = OrgDefSchema.parse({
      name: 'plain',
      goal: 'g',
      roles: [{ id: 'boss', type: 'boss', reports_to: null }, { id: 'a', reports_to: 'boss', policy: { git: 'commit' } }],
    });
    for (const r of off.roles) expect(effectiveRolePolicy(off, r)).toBe(r.policy);
    expect(effectiveRole(off, off.roles[1])).toBe(off.roles[1]);
  });

  it('with no definition at all (a low-level session) it is the role policy', () => {
    const d = def(oneWriter);
    expect(effectiveRolePolicy(undefined, roleOf(d, 'coder'))).toBe(roleOf(d, 'coder').policy);
  });
});

describe('effectiveRolePolicy: a single writer (golden)', () => {
  const root = tmp('wep-gold-');
  const d = def(oneWriter);
  const ctx = { orgRoot: root, workdir: root };
  const base = (id: string) => roleOf(d, id).policy as Record<string, unknown>;

  it('the writer keeps its policy with fileWrite cut to the section writes', () => {
    expect(effectiveRolePolicy(d, roleOf(d, 'researcher'), ctx)).toEqual({ ...base('researcher'), fileWrite: ['src/**'] });
  });

  it('a non-writer member, another section lead and the root are read-only, with the canonical workspace denied', () => {
    for (const id of ['coder', 'dev-lead', 'boss'])
      expect(effectiveRolePolicy(d, roleOf(d, id), ctx), id).toEqual({
        ...base(id),
        fileWrite: [],
        sandbox: { mode: 'required', denyWrite: [root] },
      });
  });

  it('the lead of the writing section keeps its own (already read-only) policy, with fileWrite cut', () => {
    expect(effectiveRolePolicy(d, roleOf(d, 'research-lead'), ctx)).toEqual({ ...base('research-lead'), fileWrite: ['src/**'] });
  });

  it('is idempotent: applying it to a role that already carries the effective policy changes nothing', () => {
    for (const r of d.roles) {
      const once = effectiveRolePolicy(d, r, ctx);
      expect(effectiveRolePolicy(d, { ...r, policy: once } as OrgRole, ctx), r.id).toEqual(once);
    }
  });

  it('is a function of its inputs: the same definition and workdir give an equal result (what a resume rebuilds)', () => {
    for (const r of d.roles) expect(effectiveRolePolicy(def(oneWriter), roleOf(def(oneWriter), r.id), ctx)).toEqual(effectiveRolePolicy(d, r, ctx));
  });

  it('canonicalises the workspace entry to the real path of the workdir (a symlinked project root)', () => {
    const real = tmp('wep-real-');
    const link = join(tmp('wep-link-'), 'proj');
    symlinkSync(real, link);
    const p = effectiveRolePolicy(d, roleOf(d, 'coder'), { orgRoot: link, workdir: link });
    expect(p?.sandbox?.denyWrite).toEqual([real]);
  });

  it('keeps a role\'s other deny entries, and writes an authored entry that names the workspace as its real path', () => {
    const dd = def((r) => {
      oneWriter(r);
      r.roles.find((x: Raw) => x.id === 'coder').policy = { sandbox: { denyWrite: ['/var/lib/other', '.'] } };
    });
    const p = effectiveRolePolicy(dd, roleOf(dd, 'coder'), { orgRoot: root, workdir: root });
    expect(p?.sandbox?.denyWrite).toEqual(['/var/lib/other', root]);
  });
});

describe('the overlay reaches the policy engine', () => {
  const root = project();
  const d = def(oneWriter);
  const engine = (id: string) => {
    const policy = effectiveRolePolicy(d, roleOf(d, id), { orgRoot: root, workdir: root });
    const bus = new OrgBus('o', 'r', tmp('wep-bus-'));
    return { bus, policy, e: new WriterPolicyEngine(id, { ...policy } as never, bus, root, [], root, d) };
  };
  const write = (e: PolicyEngine, tool: string, path: string) =>
    e.decide(tool, tool === 'NotebookEdit' ? { notebook_path: path, new_source: 'x' } : { file_path: path, content: 'x', old_string: 'a', new_string: 'b' });

  it('the writer\'s write inside writes is allowed, outside it refused with the scope text and an audit event', async () => {
    const { e, bus } = engine('researcher');
    const events: any[] = [];
    bus.subscribe((ev) => events.push(ev));
    expect((await write(e, 'Write', join(root, 'src', 'a.ts'))).behavior).toBe('allow');
    expect((await write(e, 'Write', 'src/b.ts')).behavior).toBe('allow');
    const out = (await write(e, 'Write', join(root, 'docs', 'a.md'))) as { behavior: string; message: string };
    expect(out.behavior).toBe('deny');
    expect(out.message).toMatch(/^\[org-policy\] REFUSED: researcher \(section research\) may write only inside its section's writes \(src\/\*\*\)/);
    expect(out.message).toContain('docs/a.md is outside them');
    expect(events.filter((ev) => ev.reason === 'writer-refused').map((ev) => ev.from)).toEqual(['researcher']);
  });

  it('a non-writer is refused on every write tool, in the writer core\'s words, and keeps its reads', async () => {
    for (const id of ['coder', 'dev-lead', 'boss']) {
      const { e, bus } = engine(id);
      const events: any[] = [];
      bus.subscribe((ev) => events.push(ev));
      for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
        const out = (await write(e, tool, join(root, 'src', 'a.ts'))) as { behavior: string; message: string };
        expect(out.behavior, `${id} ${tool}`).toBe('deny');
        expect(out.message, `${id} ${tool}`).toMatch(/REFUSED: .* cannot change src\/a\.ts: this org has a single writer for the workspace \(writes src\/\*\*\) and researcher is the only role that may write the workspace/);
      }
      expect(events.filter((ev) => ev.reason === 'writer-refused')).toHaveLength(4);
      expect((await e.decide('Read', { file_path: join(root, 'src', 'a.ts') })).behavior).toBe('allow');
    }
  });

  it('a path outside the workspace is refused too, without leaking a different reason', async () => {
    const { e } = engine('coder');
    const out = (await write(e, 'Write', '/etc/hosts')) as { message: string };
    expect(out.message).toContain('REFUSED');
  });
});

describe('the overlay reaches the sandbox layer (the real restrictions builder)', () => {
  const root = project();
  const d = def(oneWriter);
  const enforcement = (id: string, holdStubs: (roots: string[]) => string[] = () => []) => {
    const role = effectiveRole(d, roleOf(d, id), { orgRoot: root, workdir: root });
    return resolveRoleGitEnforcement({
      org: 'o',
      role,
      cwd: root,
      orgRoot: root,
      orgDir: join(root, '.monomind', 'orgs', 'o'),
      bus: new OrgBus('o', 'r', tmp('wep-bus-')),
      claudeRuntime: true,
      availability: { available: true },
      holdStubs,
    });
  };

  it('a non-writer\'s sandbox denies the whole workspace as one plain deny; the writer\'s own settings are untouched', () => {
    const coder = enforcement('coder').claudeRestrictions?.sandbox as any;
    expect(coder.enabled).toBe(true);
    expect(coder.filesystem.denyWrite).toContain(root);
    // the writer keeps its authored sandbox mode ("off" in this definition): its own shell is not confined (6.12)
    expect(enforcement('researcher').claudeRestrictions?.sandbox).toBeUndefined();
  });

  it('a role whose own sandbox mode is "off" is sandboxed anyway when it is read-only', () => {
    // coder is authored with sandbox.mode "off"; the overlay made it "required"
    expect(enforcement('coder').claudeRestrictions?.sandbox).toBeDefined();
  });
});
