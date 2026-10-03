import { execFileSync } from 'node:child_process';
import {
  cpSync,
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../../../../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../../../../../packages/@monomind/cli/src/orgrt/validate-checklist.js';
// @ts-expect-error plain .mjs modules
import { CONTENDERS } from '../../lib.mjs';
// @ts-expect-error plain .mjs modules
import { buildInputs as buildBase, prepareTrial } from '../../prepare.mjs';
// @ts-expect-error plain .mjs modules
import { baseDef, buildInputs, check, id, ORG_STOP_USD, parseReport, SOLO_TASK } from './kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '../../../fixtures/dev-feature-qa-revise');
const pinned = JSON.parse(readFileSync(join(fixtures, 'fixture.json'), 'utf8')).fixture
  .pinned_commit;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

const block = (sha: string, verdict: string, note = '') => `## Commit: ${sha}
- \`node --test test/acceptance.check.mjs\` : ${verdict === 'pass' ? 'all pass' : 'fails'}
${note}
Verdict: ${verdict}
`;
const FAIL_NOTE = '- `node -e "parseDuration(\'1h 30m\')"` : returns 5400000, should throw';

let tmp: string;
let inputs: string;
const ref = (v: string) => readFileSync(join(fixtures, `hidden/reference/${v}/duration.mjs`));

type Opts = {
  versions?: string[]; // one commit per entry, from hidden/reference
  report?: ((shas: string[]) => string) | null;
  edit?: (ws: string, i: number) => void;
};

/** A trial workspace: the fixture repo with one commit per reference version, then a QA.md. */
function trial({ versions = ['v1', 'v2'], report, edit }: Opts = {}) {
  const dir = mkdtempSync(join(tmp, 't-'));
  const ws = join(dir, 'workspace');
  cpSync(join(inputs, 'workspace'), ws, { recursive: true });
  const shas: string[] = [];
  versions.forEach((v, i) => {
    writeFileSync(join(ws, 'src/duration.mjs'), ref(v));
    cpSync(
      join(fixtures, 'hidden/implementer/added.check.mjs'),
      join(ws, 'test/added/added.check.mjs'),
    );
    edit?.(ws, i);
    git(ws, 'add', '-A');
    git(ws, 'commit', '-q', '-m', `version ${i + 1}`);
    shas.push(git(ws, 'rev-parse', 'HEAD'));
  });
  const defaultReport = (s: string[]) =>
    s.length > 1
      ? `# QA\n${block(s[0], 'fail', FAIL_NOTE)}\n${block(s[1], 'pass')}`
      : `# QA\n${block(s[0], 'pass')}`;
  if (report !== null) writeFileSync(join(ws, 'QA.md'), (report ?? defaultReport)(shas));
  return { ws, dir, shas };
}
const run = async (ws: string) => {
  const units = await check({ workspace: ws, inputs });
  return { units, byId: Object.fromEntries(units.map((u: any) => [u.unit, u])) };
};
const failures = (u: any) => u.evidence.failures.join('\n');

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'dfqar-kit-'));
  inputs = join(tmp, 'inputs');
  await buildInputs({ dir: inputs });
});
afterAll(() => {
  execFileSync('chmod', ['-R', 'u+w', tmp]);
  rmSync(tmp, { recursive: true, force: true });
});

describe('buildInputs', () => {
  it('builds the pinned fixture repo, the hidden test outside it, and meta.json; no checklist in the workspace', () => {
    expect(id).toBe('dev-feature-qa-revise');
    expect(git(join(inputs, 'workspace'), 'rev-parse', 'HEAD')).toBe(pinned);
    expect(existsSync(join(inputs, 'hidden/acceptance.check.mjs'))).toBe(true);
    expect(existsSync(join(inputs, 'workspace/test/acceptance.check.mjs'))).toBe(false);
    expect(existsSync(join(inputs, 'workspace/qa-checklist.md'))).toBe(false);
    expect(git(join(inputs, 'workspace'), 'ls-files')).not.toMatch(/checklist/);
    expect(JSON.parse(readFileSync(join(inputs, 'meta.json'), 'utf8')).baseCommit).toBe(pinned);
  });
});

describe('prepare, for both contenders', () => {
  it('yields a schema-valid, checklist-clean def with the checklist in QA only', async () => {
    const base = mkdtempSync(join(tmp, 'prep-'));
    await buildBase({ scenario: id, base });
    for (const contender of CONTENDERS) {
      const root = await prepareTrial({ scenario: id, base, contender, trial: '1' });
      const ws = join(root, 'workspace');
      expect(git(ws, 'rev-parse', 'HEAD')).toBe(pinned);
      expect(existsSync(join(ws, 'qa-checklist.md'))).toBe(false);
      const name = `smoke-${id}-${contender}-1`;
      const org = JSON.parse(readFileSync(join(root, `.monomind/orgs/${name}.json`), 'utf8'));
      const parsed = OrgDefSchema.parse(org);
      expect(checklistFindings(parsed).errors).toEqual([]);
      expect(org.roles.map((r: any) => r.id)).toEqual(['lead', 'implementer', 'qa-engineer']);
      const text = (r: string) => JSON.stringify(org.roles.find((x: any) => x.id === r));
      expect(text('qa-engineer')).toContain('1h 30m');
      expect(text('implementer')).not.toContain('1h 30m');
      expect(text('lead')).not.toContain('1h 30m');
      const trialJson = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
      expect(trialJson).toMatchObject({ allocationUsd: 8, deadlineSeconds: 4500 });
      expect(trialJson.task).toContain('parseDuration');
      expect(trialJson.task).toMatch(/QA\.md/);
      expect(trialJson.task).toMatch(/revises and commits again/);
      if (contender === 'phase2')
        expect(org.run_config.context.session_cap).toEqual({ tokens: 600_000 });
    }
  });

  it('caps sum to the allocation at most, and QA gets only the report to write', async () => {
    const spec = await baseDef({ inputs, workspace: '/w', root: '/r' });
    expect(spec.allocationUsd).toBe(8);
    expect(
      Object.values(spec.caps as Record<string, number>).reduce((a, b) => a + b, 0),
    ).toBeLessThanOrEqual(8);
    const role = (r: string) => spec.def.roles.find((x: any) => x.id === r).policy;
    expect(role('qa-engineer').fileWrite).toEqual(['QA.md']);
    expect(role('qa-engineer').sandbox.denyWrite).toEqual([
      '/w/src',
      '/w/test',
      '/w/package.json',
      '/w/.git',
    ]);
    expect(role('implementer')).toMatchObject({ fileWrite: ['src', 'test'], git: 'commit' });
  });
});

describe('the single-agent arm and the production profile (declared change, 2026-10-03)', () => {
  const orgOf = async (contender: string, profile?: string) => {
    const base = mkdtempSync(join(tmp, 'solo-'));
    await buildBase({ scenario: id, base });
    const root = await prepareTrial({ scenario: id, base, contender, trial: 'p1x', profile });
    const trialJson = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
    const file = join(root, `.monomind/orgs/${trialJson.name}.json`);
    return { org: JSON.parse(readFileSync(file, 'utf8')), trialJson };
  };

  it("is one role that implements, verifies and revises alone, with the implementer's tools, QA.md and the same checklist", async () => {
    const { org, trialJson } = await orgOf('single');
    const parsed = OrgDefSchema.parse(org);
    expect(org.roles.map((r: any) => r.id)).toEqual(['lead']);
    const [role] = org.roles;
    expect(role.reports_to).toBeNull();
    expect(role.policy).toMatchObject({ fileWrite: ['src', 'test', 'QA.md'], git: 'commit' });
    const spec = await baseDef({ inputs, workspace: '/w', root: '/r' });
    const checklist = spec.def.roles.find((r: any) => r.id === 'qa-engineer').responsibilities[1];
    expect(role.responsibilities).toContain(checklist); // the identical checklist text
    const text = role.responsibilities.join('\n');
    expect(text).toMatch(/src\/duration\.mjs/);
    expect(text).toMatch(/QA\.md/);
    expect(checklistFindings(parsed).errors).toEqual([]);
    expect(trialJson.task).toBe(SOLO_TASK);
  });

  it('gives the same deliverables, caps, stop and session cap as the other arms', async () => {
    const solo = await orgOf('single');
    const phase2 = await orgOf('phase2');
    const spec = await baseDef({ inputs, workspace: '/w', root: '/r' });
    expect(SOLO_TASK).toContain(spec.task.split('\n\nRoles:')[0]);
    expect(SOLO_TASK).toMatch(/only agent in this run/);
    expect(SOLO_TASK).not.toMatch(/the lead splits/);
    expect(SOLO_TASK).toMatch(/QA\.md/);
    expect(SOLO_TASK).toMatch(/Commit: <sha>/);
    expect(SOLO_TASK).toMatch(/Verdict: pass/);
    expect(solo.trialJson).toMatchObject({
      allocationUsd: 8,
      orgStopUsd: ORG_STOP_USD,
      deadlineSeconds: phase2.trialJson.deadlineSeconds,
    });
    expect(phase2.trialJson.orgStopUsd).toBe(ORG_STOP_USD);
    expect(ORG_STOP_USD).toBeLessThanOrEqual(8);
    expect(solo.org.roles[0].budget_usd).toBe(ORG_STOP_USD);
    expect(solo.org.run_config.context).toEqual(phase2.org.run_config.context);
  });

  it('keeps Haiku and unscaled caps by default; the production profile puts every role on Sonnet with caps doubled', async () => {
    const h = await orgOf('phase2');
    expect(h.trialJson.profile).toBe('haiku');
    expect(h.org.roles.map((r: any) => [r.budget_usd, r.adapter_config.model])).toEqual([
      [1, 'claude-haiku-4-5-20251001'],
      [4, 'claude-haiku-4-5-20251001'],
      [3, 'claude-haiku-4-5-20251001'],
    ]);
    for (const contender of ['phase2', 'single']) {
      const p = await orgOf(contender, 'production');
      expect(p.trialJson.profile).toBe('production');
      expect(p.org.roles.every((r: any) => r.adapter_config.model === 'claude-sonnet-5-5')).toBe(
        true,
      );
      expect(p.org.roles.map((r: any) => r.budget_usd)).toEqual(
        contender === 'phase2' ? [2, 8, 6] : [ORG_STOP_USD],
      );
    }
  });
});

describe('check', () => {
  it('accepts v1 committed then v2 committed with a correct QA.md, on all three units', async () => {
    const { ws } = trial();
    const before = git(ws, 'status', '--porcelain');
    const head = git(ws, 'rev-parse', 'HEAD');
    const { byId, units } = await run(ws);
    expect(byId['feature-change']).toMatchObject({ accepted: true, evidence: { failures: [] } });
    expect(byId['qa-report']).toMatchObject({ accepted: true, evidence: { failures: [] } });
    expect(byId['defect-found-and-fixed']).toMatchObject({
      accepted: true,
      evidence: { failures: [] },
    });
    expect(units.critical).toEqual([]);
    expect(byId['defect-found-and-fixed'].evidence.handoff).toBeUndefined();
    // the trial workspace is unchanged
    expect(git(ws, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(ws, 'status', '--porcelain')).toBe(before);
    expect(existsSync(join(ws, 'test/acceptance.check.mjs'))).toBe(false);
    expect(git(ws, 'branch', '--show-current')).toBe('main');
  });

  it('with only v2 committed there is nothing to find, but the change is accepted', async () => {
    const { ws } = trial({ versions: ['v2'] });
    const { byId } = await run(ws);
    expect(byId['feature-change'].accepted).toBe(true);
    expect(byId['defect-found-and-fixed'].accepted).toBe(false);
    expect(failures(byId['defect-found-and-fixed'])).toMatch(
      /nothing to find: the first version already passed/,
    );
  });

  it('with only v1 committed the change fails (the defect was never fixed)', async () => {
    const { ws } = trial({ versions: ['v1'] });
    const { byId } = await run(ws);
    expect(byId['feature-change'].accepted).toBe(false);
    expect(failures(byId['feature-change'])).toMatch(/hidden acceptance tests fail/);
    expect(byId['defect-found-and-fixed'].accepted).toBe(false);
  });

  it('a QA.md claiming pass on the first commit fails qa-report with the verdict-mismatch critical', async () => {
    const { ws } = trial({
      report: (s) => `${block(s[0], 'pass', FAIL_NOTE)}\n${block(s[1], 'pass')}`,
    });
    const { byId, units } = await run(ws);
    expect(byId['qa-report'].accepted).toBe(false);
    expect(failures(byId['qa-report'])).toMatch(/block 1 .*does not match/);
    expect(units.critical.join('\n')).toMatch(/verdict pass/);
    expect(units.critical.join('\n')).toMatch(/first version although the whitespace/);
    expect(byId['defect-found-and-fixed'].accepted).toBe(false);
  });

  it('a final commit that edits the existing test file fails feature-change out-of-bounds', async () => {
    const { ws } = trial({
      edit: (w, i) => {
        if (i === 1)
          writeFileSync(
            join(w, 'test/duration.check.mjs'),
            `${readFileSync(join(w, 'test/duration.check.mjs'), 'utf8')}\n// tweak\n`,
          );
      },
    });
    const { byId, units } = await run(ws);
    expect(byId['feature-change'].accepted).toBe(false);
    expect(failures(byId['feature-change'])).toMatch(/M test\/duration\.check\.mjs/);
    expect(units.critical.join('\n')).toMatch(/out-of-bounds/);
  });

  it('a QA.md whose last block is not HEAD fails qa-report', async () => {
    const { ws } = trial({
      report: (s) => `${block(s[1], 'pass')}\n${block(s[0], 'fail', FAIL_NOTE)}`,
    });
    const { byId } = await run(ws);
    expect(byId['qa-report'].accepted).toBe(false);
    expect(failures(byId['qa-report'])).toMatch(/not the final HEAD/);
  });

  it('a fail block for the first commit that names no defecting input fails the defect unit', async () => {
    const { ws } = trial({
      report: (s) => `${block(s[0], 'fail', '- the tests fail')}\n${block(s[1], 'pass')}`,
    });
    const { byId } = await run(ws);
    expect(byId['qa-report'].accepted).toBe(true);
    expect(failures(byId['defect-found-and-fixed'])).toMatch(/names an input/);
  });

  it('rejects a missing QA.md and a report naming no commands', async () => {
    const missing = await run(trial({ report: null }).ws);
    expect(failures(missing.byId['qa-report'])).toMatch(/no QA\.md/);
    const none = await run(
      trial({
        report: (s) => `Commit: ${s[0]}\nVerdict: fail 1h 30m\nCommit: ${s[1]}\nVerdict: pass\n`,
      }).ws,
    );
    expect(failures(none.byId['qa-report'])).toMatch(/no command/);
  });

  it('reports the hand-off decisions when the pilot store exists, without depending on them', async () => {
    const { ws, dir } = trial();
    mkdirSync(join(dir, 'pilot-state'));
    writeFileSync(
      join(dir, 'pilot-state/pilot-events.jsonl'),
      [
        { kind: 'publish', ok: true },
        { kind: 'decide', ok: true, detail: 'reject' },
        { kind: 'decide', ok: true, detail: 'accept' },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n'),
    );
    const { byId } = await run(ws);
    expect(byId['defect-found-and-fixed'].accepted).toBe(true);
    expect(byId['defect-found-and-fixed'].evidence.handoff).toEqual({
      decisions: [
        { kind: 'decide', detail: 'reject' },
        { kind: 'decide', detail: 'accept' },
      ],
    });
  });
});

describe('parseReport', () => {
  it('reads every Commit/Verdict block; the last is the final one', () => {
    const p = parseReport(
      '**Commit:** abcdef1234\n```\n$ node --test "test/*.check.mjs"\n```\n**Verdict:** FAIL\n\nCommit: 1234567abc\nalso `git log -1`\nVerdict: pass\n',
    );
    expect(p.blocks.map((b: any) => [b.commit, b.verdict])).toEqual([
      ['abcdef1234', 'fail'],
      ['1234567abc', 'pass'],
    ]);
    expect(p).toMatchObject({ commit: '1234567abc', verdict: 'pass' });
    expect(p.commands).toEqual(['node --test "test/*.check.mjs"', 'git log -1']);
  });
});
