// packages/@monomind/cli/__tests__/orgrt/documents/writer-policy.test.ts
// P4.2: the writer core as table tests: standing, authority classification, the preflight and its conflicts,
// the boundary decision and who may write which path. Pure functions over plain definitions.
import { describe, expect, it } from 'vitest';
import {
  boundaryQualification,
  mayWrite,
  overlayFor,
  standingOf,
  type WriterDef,
  type WriterRole,
  writerAuthority,
  writerPreflight,
} from '../../../src/orgrt/documents/writer-policy.js';

const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const SAFE_SHELL = { mode: 'required' as const, denyWrite: ['.'] };
/** Read-only the way an author writes it: file tools denied, shell behind the boundary. */
const READ_ONLY = { denyTools: FILE_TOOLS, fileWrite: [], sandbox: SAFE_SHELL };

const role = (id: string, reportsTo: string | null, extra: Partial<WriterRole> = {}): WriterRole => ({
  id,
  type: reportsTo === null ? 'boss' : 'specialist',
  reports_to: reportsTo,
  ...extra,
});

/** boss; section build (one member, self-led, writes); section review (lead + two members, one of them 'stray'). */
function base(patch: (d: any) => void = () => {}): WriterDef {
  const d: any = {
    name: 'org',
    sections: {
      build: { members: ['dev'], writes: ['src/**', 'docs/**'], consumes: ['spec'] },
      review: { lead: 'qa-lead', members: ['qa-lead', 'qa', 'stray'], publishes: ['spec'] },
    },
    roles: [
      role('boss', null),
      role('dev', 'boss'),
      role('qa-lead', 'boss'),
      role('qa', 'qa-lead'),
      role('stray', 'boss'),
    ],
  };
  patch(d);
  return d;
}
const withPolicy = (id: string, policy: any) => (d: any) => {
  d.roles.find((r: WriterRole) => r.id === id).policy = policy && structuredClone(policy);
};
const kinds = (def: WriterDef, id: string) => writerAuthority(def, id).reasons.map((r) => r.kind);

describe('standing: where a role stands relative to the writing section', () => {
  const cases: [string, string, string | undefined][] = [
    ['dev', 'writing-section-lead', 'build'],
    ['qa-lead', 'other-section-lead', 'review'],
    ['qa', 'other-section-member', 'review'],
    ['boss', 'root', undefined],
    ['stray', 'other-section-member', 'review'],
  ];
  for (const [id, standing, section] of cases)
    it(`${id} is ${standing}`, () => {
      expect(standingOf(base(), id)).toEqual({ standing, ...(section ? { section } : {}) });
    });

  it('a role in no section has no standing: it is refused at validate, so reaching here is a bug, and it fails closed', () => {
    const d = base((x) => x.roles.push(role('loner', 'boss')));
    expect(() => standingOf(d, 'loner')).toThrow(/loner.*in no section/);
  });

  it('a member of the writing section that is not its lead is writing-section-member', () => {
    const d = base((x) => {
      x.sections.build = { lead: 'dev-lead', members: ['dev-lead', 'dev'], writes: ['src/**'] };
      x.roles.push(role('dev-lead', 'boss'));
    });
    expect(standingOf(d, 'dev').standing).toBe('writing-section-member');
    expect(standingOf(d, 'dev-lead').standing).toBe('writing-section-lead');
  });

  it('a dedicated lead outside members counts as a lead of its section', () => {
    const d = base((x) => {
      x.sections.build = { lead: 'tech', members: ['dev'], writes: ['src/**'] };
      x.roles.push(role('tech', 'boss'));
    });
    expect(standingOf(d, 'tech').standing).toBe('writing-section-lead');
  });

  it('an endpoint role has no standing in the workspace', () => {
    const d = base((x) => x.roles.push(role('hook', 'boss', { kind: 'endpoint' })));
    expect(standingOf(d, 'hook').standing).toBe('endpoint');
    expect(overlayFor(d, 'hook')).toBeUndefined();
    expect(writerAuthority(d, 'hook').mutates).toBe(false);
  });

  it('with no writing section nobody is "writing-section"', () => {
    const d = base((x) => (x.sections.build.writes = []));
    expect(standingOf(d, 'dev').standing).toBe('other-section-lead');
  });
});

describe('no overlay, no finding when nothing declares writes', () => {
  const offs: [string, (d: any) => void][] = [
    ['writes omitted', (d) => delete d.sections.build.writes],
    ['writes empty', (d) => (d.sections.build.writes = [])],
    ['writes not a list', (d) => (d.sections.build.writes = 'src/**')],
    ['sections off', (d) => delete d.sections],
  ];
  for (const [name, patch] of offs)
    it(name, () => {
      const d = base(patch);
      for (const r of d.roles) expect(overlayFor(d, r.id)).toBeUndefined();
      expect(writerPreflight(d)).toEqual({ errors: [], warnings: [], findings: [], writers: {}, authorities: [] });
    });

  it('two writers with empty writes are not counted: the rule is off', () => {
    const d = base((x) => {
      x.sections.build = { lead: 'dev-lead', members: ['dev-lead', 'dev'], writes: [] };
      x.roles.push(role('dev-lead', 'boss'));
    });
    expect(writerPreflight(d).errors).toEqual([]);
  });
});

describe('writerAuthority: what a role can do to the workspace', () => {
  const writer = (policy: any, patch: (d: any) => void = () => {}) =>
    base((d) => {
      withPolicy('dev', policy)(d);
      patch(d);
    });

  const cases: [string, any, string[]][] = [
    ['default policy: file tools and an open shell', undefined, ['file-tools', 'shell']],
    ['file tools denied, shell open', { denyTools: FILE_TOOLS }, ['shell']],
    ['file tools denied, shell behind the boundary', { denyTools: FILE_TOOLS, sandbox: SAFE_SHELL }, []],
    ['file tools allowed but fileWrite empty, shell denied', { fileWrite: [], denyTools: ['Bash'] }, []],
    ['file tools allowed with a scope, shell denied', { fileWrite: ['src/**'], denyTools: ['Bash'] }, ['file-tools']],
    ['allowTools of reads only', { allowTools: ['Read', 'Grep', 'Glob'] }, []],
    ['allowTools with the org tools', { allowTools: ['Read', 'mcp__org__org_send'] }, []],
    ['allowTools with an unknown tool', { allowTools: ['Read', 'mcp__x__deploy'] }, ['unclassified-tool']],
    ['allowTools with Edit only', { allowTools: ['Edit'], sandbox: SAFE_SHELL }, ['file-tools']],
    ['boundary with the sandbox in auto mode', { ...READ_ONLY, sandbox: { mode: 'auto', denyWrite: ['.'] } }, ['shell']],
    ['boundary with a deny that misses the workspace', { ...READ_ONLY, sandbox: { mode: 'required', denyWrite: ['other'] } }, ['shell']],
    ['boundary undone by an allowWrite for the workspace', { ...READ_ONLY, sandbox: { ...SAFE_SHELL, allowWrite: ['.'] } }, ['shell']],
    ['an allowWrite elsewhere does not undo it', { ...READ_ONLY, sandbox: { ...SAFE_SHELL, allowWrite: ['/tmp/scratch'] } }, []],
    ['git push runs without the sandbox', { ...READ_ONLY, git: 'push' }, ['shell']],
    ['git commit stays inside the sandbox', { ...READ_ONLY, git: 'commit' }, []],
    ['fully read-only', READ_ONLY, []],
  ];
  for (const [name, policy, expected] of cases)
    it(`${name}: ${expected.length ? expected.join(', ') : 'does not mutate'}`, () => {
      const d = writer(policy);
      expect(kinds(d, 'dev')).toEqual(expected);
      expect(writerAuthority(d, 'dev').mutates).toBe(expected.length > 0);
    });

  it('a tool provider counts as writing unless it exposes nothing', () => {
    expect(kinds(writer(READ_ONLY, (d) => (d.roles[1].tool_providers = [{ name: 'gh' }])), 'dev')).toEqual(['provider']);
    expect(kinds(writer(READ_ONLY, (d) => (d.roles[1].tool_providers = [{ name: 'gh', allow: [] }])), 'dev')).toEqual([]);
  });

  it('a role on another runner counts as writing (its boundary cannot be qualified here)', () => {
    expect(kinds(writer(READ_ONLY, (d) => (d.roles[1].runtime = 'codex')), 'dev')).toEqual(['runner']);
    expect(kinds(writer(READ_ONLY, (d) => (d.runtime = 'opencode')), 'dev')).toEqual(['runner']);
    expect(writerAuthority(writer(READ_ONLY), 'dev', { defaultRuntime: 'qwen' }).reasons.map((r) => r.kind)).toEqual(['runner']);
    expect(kinds(writer(READ_ONLY, (d) => ((d.runtime = 'opencode'), (d.roles[1].runtime = 'claude'))), 'dev')).toEqual([]);
  });

  it('the writer scope is the section writes, intersected with its own entries', () => {
    expect(writerAuthority(base(), 'dev').scope).toEqual(['src/**', 'docs/**']);
    expect(writerAuthority(writer({ fileWrite: ['src/app/**'] }), 'dev').scope).toEqual(['src/app/**']);
  });

  it('every non-writer is read-only after the overlay, whatever it authored', () => {
    for (const id of ['boss', 'qa-lead', 'qa', 'stray']) {
      const d = base(withPolicy(id, { fileWrite: ['**'], sandbox: { mode: 'off' } }));
      const a = writerAuthority(d, id);
      expect([id, a.mutates, a.scope]).toEqual([id, false, []]);
    }
  });

  it('without a writing section the authored policy decides', () => {
    const d = base((x) => (x.sections.build.writes = []));
    expect(writerAuthority(d, 'qa').mutates).toBe(true);
    expect(writerAuthority(base((x) => ((x.sections.build.writes = []), withPolicy('qa', READ_ONLY)(x))), 'qa').mutates).toBe(false);
  });

  it('a relative deny against an absolute workspace qualifies only when the org root is known', () => {
    const ws = (d: any) => ((d.run_config = { workspace: '/ws' }), withPolicy('dev', READ_ONLY)(d));
    expect(kinds(base(ws), 'dev')).toEqual(['shell']);
    expect(kinds(base((d) => (ws(d), (d.roles[1].policy.sandbox = { mode: 'required', denyWrite: ['/ws'] }))), 'dev')).toEqual([]);
    expect(writerAuthority(base(ws), 'dev', { orgRoot: '/ws' }).mutates).toBe(false);
  });
});

describe('writerPreflight: the single-writer count', () => {
  const twoInBuild = (a: any, b: any) =>
    base((d) => {
      d.sections.build = { lead: 'dev-lead', members: ['dev-lead', 'dev'], writes: ['src/**'] };
      d.roles.push(role('dev-lead', 'boss'));
      withPolicy('dev', a)(d);
      withPolicy('dev-lead', b)(d);
    });

  it('a sole writer with default read-only others passes: the overlay makes the others read-only', () => {
    const f = writerPreflight(base());
    expect(f.errors).toEqual([]);
    expect(f.writers).toEqual({ repo: ['dev'] });
  });

  it('a sole writer with explicitly read-only reviewers in its own section passes', () => {
    const f = writerPreflight(twoInBuild(undefined, READ_ONLY));
    expect(f.errors).toEqual([]);
    expect(f.writers).toEqual({ repo: ['dev'] });
  });

  it('two writers in one section are refused, naming both and the remedy', () => {
    const f = writerPreflight(twoInBuild(undefined, undefined));
    expect(f.findings.map((x) => x.code)).toEqual(['writer-multiple']);
    expect(f.findings[0].roles).toEqual(['dev', 'dev-lead']);
    const m = f.errors[0];
    expect(m).toContain('workspace repo: 2 roles can change it, at most one may');
    expect(m).toContain('dev (file tools Write, Edit, MultiEdit, NotebookEdit with fileWrite src/**');
    expect(m).toContain('make the others read-only: deny Write, Edit, MultiEdit and NotebookEdit');
    expect(m).toContain('or use separate org workspaces');
  });

  it('a lead that only has an open shell still counts', () => {
    const f = writerPreflight(twoInBuild(undefined, { denyTools: FILE_TOOLS }));
    expect(f.writers.repo).toEqual(['dev', 'dev-lead']);
    expect(f.errors[0]).toContain('Bash that is not behind a qualified read-only boundary');
  });

  it('max_parallel 1, an empty writes of the other section and a merge_owner do not reduce the count', () => {
    const d = twoInBuild(undefined, undefined);
    (d.sections as any).build.parallelism = { max_parallel: 1 };
    (d.sections as any).build.merge_owner = 'dev-lead';
    (d.sections as any).review.writes = [];
    expect(writerPreflight(d).findings.map((x) => x.code)).toEqual(['writer-multiple']);
  });

  it('a tool provider on another role is a second writer', () => {
    const d = base((x) => (x.roles[2].tool_providers = [{ name: 'deploy' }]));
    const f = writerPreflight(d);
    expect(f.writers.repo).toEqual(['dev', 'qa-lead']);
    expect(f.errors[0]).toContain('tool provider deploy');
  });

  it('a non-Claude role outside the section is a second writer', () => {
    const d = base((x) => (x.roles[3].runtime = 'codex'));
    expect(writerPreflight(d).writers.repo).toEqual(['dev', 'qa']);
  });

  it('two sections declaring writes is refused once, naming both', () => {
    const d = base((x) => (x.sections.review.writes = ['tests/**']));
    const f = writerPreflight(d);
    expect(f.findings.map((x) => x.code)).toEqual(['writes-second-section']);
    expect(f.errors[0]).toContain('sections.build, sections.review');
    expect(f.errors[0]).toContain('separate org workspaces');
    for (const r of d.roles) expect(overlayFor(d, r.id)).toBeUndefined();
  });

  it('worktree-per-role with writes is refused', () => {
    const f = writerPreflight(base((d) => (d.run_config = { workspace: 'worktree-per-role' })));
    expect(f.findings.map((x) => x.code)).toContain('writer-worktree-per-role');
    expect(f.errors.join('\n')).toContain('run_config.workspace: "worktree-per-role"');
  });

  it('worktree-per-role without writes says nothing', () => {
    const d = base((x) => ((x.run_config = { workspace: 'worktree-per-role' }), (x.sections.build.writes = [])));
    expect(writerPreflight(d).findings).toEqual([]);
  });

  it('warns when the section declares writes but nobody can write', () => {
    const f = writerPreflight(base(withPolicy('dev', READ_ONLY)));
    expect(f.errors).toEqual([]);
    expect(f.findings.map((x) => [x.code, x.severity])).toEqual([['writer-none', 'warning']]);
    expect(f.warnings[0]).toContain('sections.build.writes');
  });

  it('an endpoint role is not counted', () => {
    const d = base((x) => x.roles.push(role('hook', 'boss', { kind: 'endpoint' })));
    expect(writerPreflight(d).writers).toEqual({ repo: ['dev'] });
  });

  it('is deterministic and does not mutate its input', () => {
    const d = twoInBuild(undefined, undefined);
    const before = JSON.stringify(d);
    expect(writerPreflight(d)).toEqual(writerPreflight(JSON.parse(before)));
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('conflicts between a role\'s own policy and the rule', () => {
  const codes = (d: WriterDef) => writerPreflight(d).findings.map((f) => `${f.code}@${f.path}`);

  it('an own fileWrite entry the writes do not cover is an error naming it, and the overlay drops it', () => {
    const d = base(withPolicy('dev', { fileWrite: ['src/app/**', 'lib/**'], denyTools: ['Bash'] }));
    expect(codes(d)).toEqual(['writer-scope-uncovered@roles.dev.policy.fileWrite']);
    expect(writerPreflight(d).errors[0]).toContain('lib/** not covered by the section\'s writes (src/**, docs/**)');
    expect(overlayFor(d, 'dev')?.fileWrite).toEqual(['src/app/**']);
  });

  it('an own fileWrite that is exactly the default is not an own entry', () => {
    expect(codes(base(withPolicy('dev', { fileWrite: ['**'] })))).toEqual([]);
  });

  it('a read-only role with an allowWrite that reaches the workspace is an error, and the overlay drops it', () => {
    for (const entry of ['.', 'src', './src/gen', '..']) {
      const d = base(withPolicy('qa', { sandbox: { allowWrite: [entry, '/tmp/scratch'] } }));
      expect(codes(d), entry).toEqual(['writer-readonly-grant@roles.qa.policy.sandbox.allowWrite']);
      expect(overlayFor(d, 'qa')?.sandbox?.allowWrite).toEqual(['/tmp/scratch']);
    }
  });

  it('a read-only role with a relative or workspace-wide fileWrite is an error; an absolute one elsewhere is not', () => {
    expect(codes(base(withPolicy('qa', { fileWrite: ['reports/**'] })))).toEqual(['writer-readonly-grant@roles.qa.policy.fileWrite']);
    expect(codes(base(withPolicy('qa', { fileWrite: ['/tmp/out/**'] })))).toEqual([]);
    expect(overlayFor(base(withPolicy('qa', { fileWrite: ['/tmp/out/**'] })), 'qa')?.fileWrite).toEqual([]);
  });

  it('git above read on a read-only role is an error, and the overlay lowers it', () => {
    for (const level of ['commit', 'push']) {
      const d = base(withPolicy('qa', { git: level }));
      expect(codes(d)).toEqual(['writer-readonly-git@roles.qa.policy.git']);
      expect(overlayFor(d, 'qa')?.git).toBe('read');
    }
    expect(overlayFor(base(withPolicy('qa', { git: 'read' })), 'qa')?.git).toBeUndefined();
  });

  it('sandbox mode "off" on a read-only role is a warning (it is replaced by "required")', () => {
    const f = writerPreflight(base(withPolicy('qa', { sandbox: { mode: 'off' } })));
    expect(f.errors).toEqual([]);
    expect(f.findings.map((x) => [x.code, x.severity])).toEqual([['writer-sandbox-mode-overridden', 'warning']]);
  });

  it('every message names the path it is about', () => {
    const d = base((x) => {
      withPolicy('qa', { git: 'push', fileWrite: ['a/**'], sandbox: { allowWrite: ['.'], mode: 'off' } })(x);
      withPolicy('dev', { fileWrite: ['zzz/**'], denyTools: ['Bash'] })(x);
    });
    const f = writerPreflight(d);
    expect(f.findings.length).toBe(6); // five conflicts and writer-none (the dev scope was dropped)
    for (const x of f.findings) expect(x.message, x.code).toContain(x.path);
  });
});

describe('boundaryQualification: the reduced probe at role start', () => {
  const ok = { denyWrite: ['/p'], mountPoints: [] as string[] };
  const cases: [string, string, { denyWrite: string[]; mountPoints: string[] }, string | true][] = [
    ['the workspace itself is a plain deny', '/p', ok, true],
    ['a deny above the workspace covers it', '/p/sub', ok, true],
    ['an expanded ancestor whose child deny names the workspace', '/p/sub', { denyWrite: ['/p/sub', '/p/x'], mountPoints: ['/p'] }, true],
    ['no deny covers the workspace', '/p', { denyWrite: ['/q'], mountPoints: [] }, 'no deny-write covers the workspace'],
    ['an empty deny list', '/p', { denyWrite: [], mountPoints: [] }, 'no deny-write covers the workspace'],
    ['the workspace itself was expanded into its children', '/p', { denyWrite: ['/p/a', '/p/b'], mountPoints: ['/p'] }, 'expanded into the children of /p'],
    ['a directory inside the workspace was expanded', '/p', { denyWrite: ['/p/a', '/p/d/e'], mountPoints: ['/p/d'] }, 'expanded into the children of /p/d'],
    ['a sibling prefix is not inside the workspace', '/p', { denyWrite: ['/p'], mountPoints: ['/p-old'] }, true],
    ['a deny on a sibling prefix does not cover it', '/p', { denyWrite: ['/p-old'], mountPoints: [] }, 'no deny-write covers the workspace'],
  ];
  for (const [name, ws, built, expected] of cases)
    it(name, () => {
      const r = boundaryQualification('qa', ws, built);
      if (expected === true) return expect(r).toEqual({ ok: true });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.finding.code).toBe('writer-boundary-unqualified');
      expect(r.finding.roles).toEqual(['qa']);
      expect(r.finding.message).toContain(expected);
      expect(r.finding.message).toContain('held rather than widened');
    });
});

describe('mayWrite: who may write which path, and what the refused role sees', () => {
  const v = (id: string, path: string, d = base()) => mayWrite(d, id, path);

  it('says nothing when no overlay applies', () => {
    expect(mayWrite(base((d) => (d.sections.build.writes = [])), 'qa', 'src/a.ts')).toEqual({ applies: false, allowed: true });
  });

  it('the writer may write inside writes and not outside', () => {
    expect(v('dev', 'src/a/b.ts')).toEqual({ applies: true, allowed: true });
    expect(v('dev', 'docs/x.md').allowed).toBe(true);
    const out = v('dev', 'package.json');
    expect(out.allowed).toBe(false);
    expect(out.refusal).toContain('REFUSED: dev (section build) may write only inside its section\'s writes (src/**, docs/**)');
    expect(out.refusal).toContain('package.json is outside them');
  });

  it('a path that climbs out of the workspace is never allowed', () => {
    expect(v('dev', '../src/a.ts').allowed).toBe(false);
    expect(v('dev', 'src/../../etc/x').allowed).toBe(false);
    expect(v('dev', '/src/a.ts').allowed).toBe(false);
  });

  for (const id of ['boss', 'qa-lead', 'qa', 'stray'])
    it(`${id} may write nothing, and is told who can`, () => {
      const r = v(id, 'src/a.ts');
      expect(r.allowed).toBe(false);
      expect(r.refusal).toContain(`REFUSED: ${id} cannot change src/a.ts`);
      expect(r.refusal).toContain('dev is the only role that may write the workspace');
      expect(r.refusal).toContain('org_doc_publish');
    });

  it('names no writer when several or none can write', () => {
    const d = base((x) => (x.roles[2].tool_providers = [{ name: 'deploy' }]));
    expect(v('qa', 'src/a.ts', d).refusal).toContain('one role of the org may write the workspace and it is not you');
  });
});
