// packages/@monomind/cli/__tests__/orgrt/documents/writer-property.test.ts
// P4.2: properties of the writer core over seeded random sections definitions (a fixed PRNG, so a failure
// reproduces): no role is both a denied and an allowed writer of the same path, the overlay never grants more
// than the section's writes, applying the overlay twice changes nothing, and the answers do not depend on the
// order of the roles or on running the check twice.
import { describe, expect, it } from 'vitest';
import {
  applyWriterOverlay,
  mayWrite,
  overlayFor,
  type WriterDef,
  type WriterRole,
  writerPreflight,
} from '../../../src/orgrt/documents/writer-policy.js';
import {
  allowReachesWorkspace,
  denyCoversWorkspace,
  pathInScope,
  scopeCovers,
  workspaceInfo,
} from '../../../src/orgrt/documents/writer-paths.js';

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const PATHS = ['src/a.ts', 'src/app/b.ts', 'docs/x.md', 'lib/z.ts', 'README.md', 'a/b/c', '.', '../x'];
const WRITES = [['src/**'], ['src/**', 'docs/**'], ['docs'], ['**/*.md'], ['src/app/**', 'README.md']];
const FILE_WRITES = [undefined, [], ['**'], ['src/**'], ['src/app/**'], ['lib/**'], ['docs/**', 'lib/**'], ['/tmp/out/**']];
const DENY_TOOLS = [undefined, ['Bash'], ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'], ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']];
const SANDBOXES = [
  undefined,
  { mode: 'required', denyWrite: ['.'] },
  { mode: 'off' },
  { mode: 'auto', denyWrite: ['build'] },
  { mode: 'required', denyWrite: ['/work/ws'], allowWrite: ['/tmp/s', '.'] },
  { allowWrite: ['src', '/tmp/scratch'] },
];
const WORKSPACES = [undefined, 'repo', 'isolated', 'worktree', '/work/ws', 'out/ws'];

function gen(rnd: () => number): WriterDef {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const n = 3 + Math.floor(rnd() * 4);
  const roles: WriterRole[] = [{ id: 'r0', type: 'boss', reports_to: null }];
  for (let i = 1; i < n; i++) {
    const policy: Record<string, unknown> = {};
    const fw = pick(FILE_WRITES);
    if (fw) policy.fileWrite = fw;
    const dt = pick(DENY_TOOLS);
    if (dt) policy.denyTools = dt;
    const sb = pick(SANDBOXES);
    if (sb) policy.sandbox = sb;
    if (rnd() < 0.2) policy.git = pick(['read', 'commit', 'push']);
    const role: WriterRole = { id: `r${i}`, reports_to: 'r0', ...(Object.keys(policy).length ? { policy } : {}) };
    if (rnd() < 0.1) role.runtime = 'codex';
    if (rnd() < 0.1) role.tool_providers = [{ name: 'p' }];
    if (rnd() < 0.05) role.kind = 'endpoint';
    roles.push(role);
  }
  const sections: Record<string, unknown> = {};
  const ids = roles.slice(1).map((r) => r.id);
  const k = 1 + Math.floor(rnd() * Math.min(3, ids.length));
  for (let s = 0; s < k; s++) {
    const members = ids.filter((_, i) => i % k === s);
    if (members.length === 0) continue;
    sections[`s${s}`] = {
      members,
      ...(members.length > 1 ? { lead: members[0] } : {}),
      ...(rnd() < 0.55 ? { writes: pick(WRITES) } : rnd() < 0.5 ? { writes: [] } : {}),
    };
  }
  const ws = pick(WORKSPACES);
  return { name: 'org', ...(ws ? { run_config: { workspace: ws } } : {}), sections, roles };
}

const N = 600;
const defs = (seed: number): WriterDef[] => {
  const rnd = prng(seed);
  return Array.from({ length: N }, () => gen(rnd));
};
const writingCount = (d: WriterDef) =>
  Object.values(d.sections as Record<string, { writes?: string[] }>).filter((s) => (s.writes?.length ?? 0) > 0).length;
const OPTS = [{}, { orgRoot: '/work' }];

describe('writer core properties (seeded random definitions)', () => {
  const all = defs(20261004);

  it('the generator covers the interesting shapes (a vacuous property is not a property)', () => {
    const counts = [0, 1, 2].map((c) => all.filter((d) => writingCount(d) === c).length);
    expect(counts[0]).toBeGreaterThan(50);
    expect(counts[1]).toBeGreaterThan(150);
    expect(counts[2]).toBeGreaterThan(20);
    const errs = all.filter((d) => writerPreflight(d).errors.length > 0).length;
    expect(errs).toBeGreaterThan(50);
    expect(all.filter((d) => writerPreflight(d).errors.length === 0 && writingCount(d) === 1).length).toBeGreaterThan(10);
  });

  it('no overlay without exactly one writing section', () => {
    for (const d of all)
      if (writingCount(d) !== 1) for (const r of d.roles) expect(overlayFor(d, r.id)).toBeUndefined();
  });

  it('no role is both a denied and an allowed writer of a path, and nobody is allowed beyond the writes', () => {
    for (const d of all) {
      if (writingCount(d) !== 1) continue;
      const writes = (Object.values(d.sections as Record<string, { writes?: string[] }>).find((s) => s.writes?.length) as { writes: string[] }).writes;
      for (const opts of OPTS)
        for (const r of d.roles) {
          const ov = overlayFor(d, r.id, opts);
          if (!ov) continue;
          const ws = workspaceInfo(d, r.id);
          for (const p of PATHS) {
            const allowed = mayWrite(d, r.id, p, opts).allowed;
            if (allowed) expect(pathInScope(writes, p), `${r.id} ${p}`).toBe(true);
            const denies = !!ov.sandbox && ov.sandbox.denyWrite.some((x) => denyCoversWorkspace(x, ws, opts.orgRoot));
            expect(allowed && denies, `${r.id} ${p}`).toBe(false);
          }
          if (ov.standing.startsWith('writing-')) {
            expect(ov.sandbox).toBeUndefined();
            for (const e of ov.fileWrite) expect(writes.some((w) => scopeCovers(w, e)), e).toBe(true);
          } else {
            expect(ov.fileWrite).toEqual([]);
            expect(ov.sandbox?.mode).toBe('required');
            expect(ov.sandbox?.denyWrite.some((x) => denyCoversWorkspace(x, ws, opts.orgRoot))).toBe(true);
            for (const a of ov.sandbox?.allowWrite ?? []) expect(allowReachesWorkspace(a, ws, opts.orgRoot), a).toBe(false);
            expect([undefined, 'read']).toContain(ov.git);
            for (const p of PATHS) expect(mayWrite(d, r.id, p, opts).allowed).toBe(false);
          }
        }
    }
  });

  it('the overlay is idempotent: the policy it produces is its own fixed point', () => {
    for (const d of all) {
      for (const opts of OPTS) {
        const eff = (def: WriterDef) =>
          Object.fromEntries(def.roles.map((r) => [r.id, applyWriterOverlay(r.policy, overlayFor(def, r.id, opts))]));
        const once = eff(d);
        const d2: WriterDef = { ...d, roles: d.roles.map((r) => ({ ...r, policy: once[r.id] as WriterRole['policy'] })) };
        expect(eff(d2)).toEqual(once);
        expect(writerPreflight(d2, opts).writers).toEqual(writerPreflight(d, opts).writers);
        // The conflicts of the first pass are gone from the second: nothing left to narrow.
        if (writingCount(d) === 1) expect(writerPreflight(d2, opts).errors.filter((e) => !e.includes('can change it'))).toEqual([]);
      }
    }
  });

  it('applyWriterOverlay returns the same policy object when there is no overlay, and never mutates', () => {
    for (const d of all.slice(0, 200))
      for (const r of d.roles) {
        const before = JSON.stringify(r.policy ?? null);
        const out = applyWriterOverlay(r.policy, overlayFor(d, r.id));
        if (!overlayFor(d, r.id)) expect(out).toBe(r.policy);
        expect(JSON.stringify(r.policy ?? null)).toBe(before);
      }
  });

  it('is deterministic, does not mutate the definition, and does not depend on the order of the roles', () => {
    for (const d of all.slice(0, 300)) {
      const before = JSON.stringify(d);
      const a = writerPreflight(d);
      expect(writerPreflight(d)).toEqual(a);
      expect(JSON.stringify(d)).toBe(before);
      const reversed: WriterDef = { ...d, roles: [d.roles[0], ...d.roles.slice(1).reverse()] };
      for (const r of d.roles) expect(overlayFor(reversed, r.id)).toEqual(overlayFor(d, r.id));
      expect(a.findings.map((f) => `${f.code} ${f.path}`).sort()).toEqual(
        writerPreflight(reversed).findings.map((f) => `${f.code} ${f.path}`).sort(),
      );
      expect(Object.values(writerPreflight(reversed).writers).flat().sort()).toEqual(Object.values(a.writers).flat().sort());
    }
  });

  it('writer-multiple is reported exactly when more than one role can change a shared workspace', () => {
    for (const d of all) {
      const pre = writerPreflight(d);
      const many = Object.values(pre.writers).some((w) => w.length > 1);
      expect(pre.findings.some((f) => f.code === 'writer-multiple')).toBe(many);
      for (const ids of Object.values(pre.writers)) for (const id of ids) expect(d.roles.some((r) => r.id === id)).toBe(true);
    }
  });
});
