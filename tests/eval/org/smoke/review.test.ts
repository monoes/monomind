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
import { apply, pack, producedFiles } from './review.mjs';

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
