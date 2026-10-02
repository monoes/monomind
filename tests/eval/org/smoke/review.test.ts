import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs module
import { apply, pack, producedFiles, scrub } from './review.mjs';

const w = (p: string, text: string) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
};

/** A finished trial of the research-report scenario with a report awaiting review. */
function trial(units: object[], extra: Record<string, string> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'review-'));
  const inputs = join(base, 'inputs');
  w(join(inputs, 'workspace/QUESTION.md'), 'q');
  w(join(inputs, 'workspace/snapshot/a.ts'), 'code');
  const root = join(base, 'trial');
  w(join(root, 'workspace/QUESTION.md'), 'q');
  w(join(root, 'workspace/snapshot/a.ts'), 'code');
  w(join(root, 'workspace/report.md'), '# report');
  w(join(root, 'workspace/.hidden'), 'x');
  for (const [f, t] of Object.entries(extra)) w(join(root, 'workspace', f), t);
  writeFileSync(
    join(root, 'trial.json'),
    JSON.stringify({
      scenario: 'research-report',
      contender: 'phase2',
      model: 'haiku',
      guard: [inputs],
    }),
  );
  writeFileSync(join(root, 'units.json'), JSON.stringify({ units }));
  return root;
}
const both = (a: boolean | null, b: boolean | null, review = true) => [
  { unit: 'report', accepted: a, evidence: { needsReview: review } },
  { unit: 'source-ledger', accepted: b, evidence: { needsReview: review } },
];

describe('producedFiles', () => {
  it('lists what the trial added or changed, not the read-only material, dot files or untouched files', () => {
    const root = trial([], { 'ledger.json': '[]' });
    expect(
      producedFiles(join(root, 'workspace'), join(root, '../inputs/workspace')).sort(),
    ).toEqual(['ledger.json', 'report.md']);
  });
});

describe('pack', () => {
  it('makes one blind bundle per trial that has a unit to review, with the rubric and an unanswered review.json', () => {
    const root = trial(both(true, true));
    const out = join(mkdtempSync(join(tmpdir(), 'bundles-')), 'out');
    const [id] = pack({ roots: [root], out });
    expect(id).toMatch(/^B-[0-9a-f]{6}$/);
    expect(readdirSync(join(out, id, 'artifacts'))).toEqual(['report.md']);
    const md = readFileSync(join(out, id, 'REVIEW.md'), 'utf8');
    expect(md).toMatch(/sourced.*accurate|accurate/s);
    expect(md).toMatch(/Critical failures/);
    const tmpl = JSON.parse(readFileSync(join(out, id, 'review.json'), 'utf8'));
    expect(Object.keys(tmpl.units)).toEqual(['report', 'source-ledger']);
    expect(Object.values(tmpl.units.report.criteria)).toEqual([null, null, null, null]);
  });

  it('never names the contender, the runner or the model in a bundle, and keeps the key apart', () => {
    const root = trial(both(true, true));
    const out = join(mkdtempSync(join(tmpdir(), 'bundles-')), 'out');
    const [id] = pack({ roots: [root], out });
    const all = [
      join(out, id, 'REVIEW.md'),
      join(out, id, 'review.json'),
      join(out, id, 'artifacts/report.md'),
    ]
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    for (const secret of ['phase2', 'current-best', 'haiku', 'codex', 'claude'])
      expect(all).not.toContain(secret);
    expect(JSON.parse(readFileSync(join(out, 'key.json'), 'utf8'))[id]).toMatchObject({
      scenario: 'research-report',
    });
  });

  it('skips a trial with nothing to review', () => {
    const root = trial(both(true, false, false));
    const out = join(mkdtempSync(join(tmpdir(), 'bundles-')), 'out');
    expect(pack({ roots: [root], out })).toEqual([]);
    expect(existsSync(join(out, 'key.json'))).toBe(true);
  });
});

describe('apply', () => {
  const fill = (out: string, id: string, f: (units: any) => void) => {
    const file = join(out, id, 'review.json');
    const r = JSON.parse(readFileSync(file, 'utf8'));
    f(r.units);
    writeFileSync(file, JSON.stringify(r));
  };
  const setup = (units: object[]) => {
    const root = trial(units);
    const out = join(mkdtempSync(join(tmpdir(), 'bundles-')), 'out');
    const [id] = pack({ roots: [root], out });
    return { root, out, id };
  };
  const all = (u: any, v: boolean) => {
    for (const k of Object.keys(u.criteria)) u.criteria[k] = v;
  };
  const units = (root: string) => JSON.parse(readFileSync(join(root, 'units.json'), 'utf8')).units;

  it('accepts a unit awaiting review when its score reaches min_quality with no critical failure', () => {
    const { root, out, id } = setup(both(null, null));
    fill(out, id, (u) => {
      all(u.report, true);
      u.report.criteria.concise = false; // 3 of 4 = 0.75 = min_quality
      all(u['source-ledger'], true);
    });
    apply({ out });
    expect(units(root).map((x: any) => x.accepted)).toEqual([true, true]);
    expect(units(root)[0].review).toMatchObject({ score: 0.75, machineAccepted: null });
  });

  it('rejects below min_quality, and on any critical failure whatever the score', () => {
    const { root, out, id } = setup(both(null, null));
    fill(out, id, (u) => {
      all(u.report, true);
      u.report.criteria.concise = false;
      u.report.criteria.complete = false; // 2 of 4
      all(u['source-ledger'], true);
      u['source-ledger'].critical = [
        'a citation whose path or line does not exist in the snapshot',
      ];
    });
    apply({ out });
    expect(units(root).map((x: any) => x.accepted)).toEqual([false, false]);
    expect(units(root)[1].critical).toHaveLength(1);
  });

  it('lets a review downgrade a machine-accepted unit but never upgrade a machine-rejected one', () => {
    const { root, out, id } = setup(both(true, true));
    fill(out, id, (u) => {
      all(u.report, false);
      all(u['source-ledger'], true);
    });
    apply({ out });
    expect(units(root).map((x: any) => x.accepted)).toEqual([false, true]);
    expect(units(root)[0].evidence.needsReview).toBe(false);
  });

  it('refuses an unanswered criterion', () => {
    const { out } = setup(both(null, null));
    expect(() => apply({ out })).toThrow(/unanswered criterion/);
  });
});

describe('scrub: nothing in a bundle says which arm, run, role or path produced it', () => {
  const ctx = {
    root: '/var/tmp/mm-pilot-p1/trials/smoke-growth-like-phase2-p2t',
    names: ['smoke-growth-like-phase2-p2t'],
    roleIds: ['growth-lead', 'researcher', 'content-writer', 'analyst'],
    home: '/home/monoes',
  };

  it('replaces the trial path, any other path in the scratch or home areas, the org name and run ids', () => {
    const t = scrub(
      'cd /var/tmp/mm-pilot-p1/trials/smoke-growth-like-phase2-p2t/workspace && ls /var/tmp/mm-pilot-p1/inputs/x /home/monoes/.monomind\n' +
        'org smoke-growth-like-phase2-p2t run run-20261002133341-b259 ended',
      ctx,
    );
    for (const secret of [
      '/var/tmp',
      'mm-pilot',
      'smoke-growth',
      'phase2',
      'p2t',
      '/home/monoes',
      'run-2026',
    ])
      expect(t).not.toContain(secret);
    expect(t).toContain('<trial>/workspace');
  });

  it('replaces hyphenated role ids anywhere, and plain role ids only where they label an author', () => {
    const t = scrub(
      'author: researcher\nOwner: **analyst**\n**Assignee:** growth-lead\n' +
        'The content-writer drafted it. A researcher in the field would check this; the analyst view is that it is fine.',
      ctx,
    );
    expect(t).toMatch(/^author: <role>$/m);
    expect(t).toMatch(/^Owner: \*\*<role>\*\*$/m);
    expect(t).not.toContain('growth-lead');
    expect(t).not.toContain('content-writer');
    // ordinary prose that happens to use the word survives: it is content, not identity
    expect(t).toContain(
      'A researcher in the field would check this; the analyst view is that it is fine.',
    );
  });

  it('leaves everything else exactly as it was', () => {
    const body = '# monomind 2.22\n\nInstall with `npx monomind init`. 83 agents, 82 skills.\n';
    expect(scrub(body, ctx)).toBe(body);
  });

  it('is applied to what pack writes: file contents and file names, with the original names kept only in the key', () => {
    const r = trial(both(true, true), {});
    const orgName = 'smoke-research-report-phase2-t1';
    writeFileSync(
      join(r, 'workspace/notes-by-content-writer.md'),
      `produced in ${r}/workspace by run run-20261002133341-b259\nauthor: researcher\n`,
    );
    const trialJson = JSON.parse(readFileSync(join(r, 'trial.json'), 'utf8'));
    mkdirSync(join(r, '.monomind/orgs'), { recursive: true });
    writeFileSync(
      join(r, '.monomind/orgs', `${trialJson.name}.json`),
      JSON.stringify({
        name: trialJson.name,
        roles: [{ id: 'content-writer' }, { id: 'researcher' }],
      }),
    );
    const out = join(mkdtempSync(join(tmpdir(), 'bundles-')), 'out');
    const [id] = pack({ roots: [r], out });
    const files = readdirSync(join(out, id, 'artifacts'));
    expect(files.some((f: string) => f.includes('content-writer'))).toBe(false);
    const scrubbed = files.find((f: string) => f.startsWith('notes-by-'))!;
    const text = readFileSync(join(out, id, 'artifacts', scrubbed), 'utf8');
    expect(text).not.toContain(r);
    expect(text).not.toContain('run-2026');
    expect(text).toContain('author: <role>');
    const key = JSON.parse(readFileSync(join(out, 'key.json'), 'utf8'))[id];
    expect(key.renamed).toMatchObject({ [scrubbed]: 'notes-by-content-writer.md' });
    expect(orgName).toBeTruthy();
  });

  it('copies a binary file untouched', () => {
    const r = trial(both(true, true), {});
    writeFileSync(join(r, 'workspace/img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
    const out = join(mkdtempSync(join(tmpdir(), 'bundles-')), 'out');
    const [id] = pack({ roots: [r], out });
    expect([...readFileSync(join(out, id, 'artifacts/img.png'))]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x00, 0xff,
    ]);
  });
});

describe('scrub uses the whole roster, so every arm reads alike', () => {
  it("scrubs the role names of the original org as well as the trial's own, so a one-role arm does not stand out", () => {
    const r = trial(both(true, true), {});
    writeFileSync(
      join(r, 'workspace/plan.md'),
      'Sign-off from the brand-reviewer, then the outreach-manager sends it. growth-lead owns the plan.\n',
    );
    const tj = JSON.parse(readFileSync(join(r, 'trial.json'), 'utf8'));
    // the trial's own org has one role; the inputs hold the original, larger roster
    mkdirSync(join(r, '.monomind/orgs'), { recursive: true });
    writeFileSync(
      join(r, '.monomind/orgs', `${tj.name}.json`),
      JSON.stringify({ name: tj.name, roles: [{ id: 'growth-lead' }] }),
    );
    writeFileSync(
      join(tj.guard[0], 'org.json'),
      JSON.stringify({
        roles: [{ id: 'growth-lead' }, { id: 'brand-reviewer' }, { id: 'outreach-manager' }],
      }),
    );
    const out = join(mkdtempSync(join(tmpdir(), 'bundles-')), 'out');
    const [id] = pack({ roots: [r], out });
    const text = readFileSync(join(out, id, 'artifacts/plan.md'), 'utf8');
    expect(text).toBe(
      'Sign-off from the <role>, then the <role> sends it. <role> owns the plan.\n',
    );
  });
});

describe('scrub hides the hand-off tool names, which would name the arm', () => {
  it('replaces pilot__ tool names, wherever they appear', () => {
    const ctx = { root: '/r', names: [], roleIds: [], home: '/home/x' };
    const t = scrub(
      'Published with pilot__doc_publish; read via `pilot__doc_read` and pilot__doc_decide.',
      ctx,
    );
    expect(t).toBe('Published with <tool>; read via `<tool>` and <tool>.');
    expect(scrub('doc_publish is a word in prose and the pilot is a project', ctx)).toBe(
      'doc_publish is a word in prose and the pilot is a project',
    );
  });
});
