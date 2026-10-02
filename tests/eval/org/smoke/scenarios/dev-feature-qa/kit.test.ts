import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { baseDef, buildInputs, check, id, parseReport } from './kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '../../../fixtures/dev-feature-qa');
const pinned = JSON.parse(readFileSync(join(fixtures, 'fixture.json'), 'utf8')).fixture
  .pinned_commit;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

const NEW_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDuration } from '../src/duration.mjs';

test('compound and ISO durations', () => {
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('PT45S'), 45_000);
});
`;

const goodReport = (sha: string, verdict = 'pass') => `# QA report
Commit: ${sha}

## Commands run
- \`git diff --stat ${pinned}\` : only src/duration.mjs and test/ changed
- \`node --test "test/*.check.mjs"\` : all tests pass

## Defects
None.

Verdict: ${verdict}
`;

let tmp: string;
let inputs: string;

/** A trial workspace: the fixture repo with `edit` applied and committed, then a QA.md for the final commit. */
function trial(
  edit: (ws: string) => void = () => {},
  opts: { report?: ((sha: string) => string) | null; commit?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmp, 't-'));
  const ws = join(dir, 'workspace');
  cpSync(join(inputs, 'workspace'), ws, { recursive: true });
  writeFileSync(
    join(ws, 'src/duration.mjs'),
    readFileSync(join(fixtures, 'hidden/reference/duration.mjs')),
  );
  writeFileSync(join(ws, 'test/compound.check.mjs'), NEW_TEST);
  edit(ws);
  if (opts.commit !== false) {
    git(ws, 'add', '-A');
    git(ws, 'commit', '-q', '-m', 'feature');
  }
  const sha = git(ws, 'rev-parse', 'HEAD');
  if (opts.report !== null) writeFileSync(join(ws, 'QA.md'), (opts.report ?? goodReport)(sha));
  return { ws, sha };
}
const run = async (ws: string) => {
  const units = await check({ workspace: ws, inputs });
  return { units, byId: Object.fromEntries(units.map((u: any) => [u.unit, u])) };
};

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'dfqa-kit-'));
  inputs = join(tmp, 'inputs');
  await buildInputs({ dir: inputs });
});
afterAll(() => {
  // prepared inputs are read-only by design
  execFileSync('chmod', ['-R', 'u+w', tmp]);
  rmSync(tmp, { recursive: true, force: true });
});

describe('buildInputs', () => {
  it('builds the pinned fixture repo, the hidden test outside it, and meta.json', () => {
    expect(id).toBe('dev-feature-qa');
    expect(git(join(inputs, 'workspace'), 'rev-parse', 'HEAD')).toBe(pinned);
    expect(existsSync(join(inputs, 'hidden/acceptance.check.mjs'))).toBe(true);
    expect(existsSync(join(inputs, 'workspace/test/acceptance.check.mjs'))).toBe(false);
    expect(JSON.parse(readFileSync(join(inputs, 'meta.json'), 'utf8')).baseCommit).toBe(pinned);
  });
});

describe('prepare, for both contenders', () => {
  it('keeps .git through the copy and yields a schema-valid, checklist-clean def', async () => {
    const base = mkdtempSync(join(tmp, 'prep-'));
    await buildBase({ scenario: id, base });
    for (const contender of CONTENDERS) {
      const root = await prepareTrial({ scenario: id, base, contender, trial: '1' });
      const ws = join(root, 'workspace');
      expect(existsSync(join(ws, '.git'))).toBe(true);
      expect(git(ws, 'rev-parse', 'HEAD')).toBe(pinned);
      expect(git(ws, 'status', '--porcelain')).toBe('');
      const name = `smoke-${id}-${contender}-1`;
      const org = JSON.parse(readFileSync(join(root, `.monomind/orgs/${name}.json`), 'utf8'));
      const parsed = OrgDefSchema.parse(org);
      expect(checklistFindings(parsed).errors).toEqual([]);
      expect(org.roles.map((r: any) => r.id)).toEqual(['lead', 'implementer', 'qa-engineer']);
      const trialJson = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
      expect(trialJson).toMatchObject({ allocationUsd: 8, deadlineSeconds: 3600 });
      expect(trialJson.task).toContain('parseDuration');
      expect(trialJson.task).toMatch(/QA\.md/);
      if (contender === 'phase2')
        expect(org.run_config.context.session_cap).toEqual({ tokens: 600_000 });
    }
  });

  it('caps sum to the allocation at most', async () => {
    const spec = await baseDef({ inputs, workspace: '/w', root: '/r' });
    expect(spec.allocationUsd).toBe(8);
    expect(
      Object.values(spec.caps as Record<string, number>).reduce((a, b) => a + b, 0),
    ).toBeLessThanOrEqual(8);
  });

  it('gives QA only the report to write, and nobody but the implementer the sources', async () => {
    const { def } = await baseDef({ inputs, workspace: '/w' });
    const role = (r: string) => def.roles.find((x: any) => x.id === r).policy;
    const qa = role('qa-engineer');
    expect(qa.fileWrite).toEqual(['QA.md']);
    expect(qa.git).toBe('read');
    expect(qa.sandbox.denyWrite).toEqual(['/w/src', '/w/test', '/w/package.json', '/w/.git']);
    expect(role('lead').fileWrite).toEqual([]);
    expect(role('lead').sandbox.denyWrite).toEqual(['/w']);
    expect(role('implementer')).toMatchObject({ fileWrite: ['src', 'test'], git: 'commit' });
  });
});

describe('check', () => {
  it('accepts the reference solution with new tests and an honest report', async () => {
    const { ws } = trial();
    const before = git(ws, 'status', '--porcelain');
    const { byId, units } = await run(ws);
    expect(byId['feature-change']).toMatchObject({ accepted: true, evidence: { failures: [] } });
    expect(byId['qa-report']).toMatchObject({ accepted: true, evidence: { failures: [] } });
    expect(units.critical).toEqual([]);
    // the trial workspace is untouched: no acceptance test copied in, same status
    expect(existsSync(join(ws, 'test/acceptance.check.mjs'))).toBe(false);
    expect(git(ws, 'status', '--porcelain')).toBe(before);
  });

  it('rejects a missing feature, and a QA pass on it is critical', async () => {
    const { ws } = trial((w) => {
      writeFileSync(
        join(w, 'src/duration.mjs'),
        readFileSync(join(inputs, 'workspace/src/duration.mjs')),
      );
    });
    const { byId, units } = await run(ws);
    expect(byId['feature-change'].accepted).toBe(false);
    expect(byId['feature-change'].evidence.failures.join('\n')).toMatch(/feature missing/);
    expect(byId['qa-report'].accepted).toBe(false);
    expect(units.critical.join('\n')).toMatch(/verdict pass/);
  });

  it('rejects an edited existing test, critical', async () => {
    const { ws, ...rest } = trial((w) => {
      writeFileSync(
        join(w, 'test/duration.check.mjs'),
        `${readFileSync(join(w, 'test/duration.check.mjs'), 'utf8')}\n// tweak\n`,
      );
    });
    const { byId, units } = await run(ws);
    expect(rest.sha).toBeTruthy();
    expect(byId['feature-change'].accepted).toBe(false);
    expect(byId['feature-change'].evidence.failures.join('\n')).toMatch(
      /M test\/duration\.check\.mjs/,
    );
    expect(units.critical.join('\n')).toMatch(/out-of-bounds/);
  });

  it('rejects an edited package.json, critical', async () => {
    const { ws } = trial((w) => {
      writeFileSync(join(w, 'package.json'), `${readFileSync(join(w, 'package.json'), 'utf8')}\n`);
    });
    const { byId, units } = await run(ws);
    expect(byId['feature-change'].accepted).toBe(false);
    expect(units.critical.join('\n')).toMatch(/package\.json/);
  });

  it('rejects a planted acceptance test, critical', async () => {
    const { ws } = trial((w) => {
      cpSync(join(inputs, 'hidden/acceptance.check.mjs'), join(w, 'test/acceptance.check.mjs'));
    });
    const { byId, units } = await run(ws);
    expect(byId['feature-change'].accepted).toBe(false);
    expect(units.critical.join('\n')).toMatch(/acceptance/);
  });

  it('has a separate place for new tests, so adding to the existing file is never the natural move', async () => {
    const { ws } = trial((w) => {
      rmSync(join(w, 'test/compound.check.mjs'));
      writeFileSync(
        join(w, 'test/added/compound.check.mjs'),
        NEW_TEST.replace('../src/', '../../src/'),
      ); // one level deeper
    });
    expect(existsSync(join(inputs, 'workspace/test/added/README.md'))).toBe(true); // the template carries the place
    const { byId } = await run(ws);
    expect(byId['feature-change'].evidence.failures).toEqual([]);
    expect(byId['feature-change'].accepted).toBe(true);
  });

  it('still rejects an edit to the existing test file, which the separate place makes unnecessary', async () => {
    const { ws } = trial((w) => {
      writeFileSync(
        join(w, 'test/added/compound.check.mjs'),
        NEW_TEST.replace('../src/', '../../src/'),
      ); // one level deeper
      writeFileSync(
        join(w, 'test/duration.check.mjs'),
        `${readFileSync(join(w, 'test/duration.check.mjs'), 'utf8')}\n// more\n`,
      );
    });
    const { byId } = await run(ws);
    expect(byId['feature-change'].accepted).toBe(false);
    expect(byId['feature-change'].evidence.failures.join('\n')).toMatch(/out-of-bounds/);
  });

  it("tells the roles where new tests go, in the task and in the implementer's own brief", async () => {
    const spec = await baseDef({ inputs, workspace: '/w', root: '/r' });
    expect(spec.task).toMatch(/test\/added\//);
    expect(JSON.stringify(spec.def.roles.find((r: any) => r.id === 'implementer'))).toMatch(
      /test\/added\//,
    );
  });

  it('rejects a change with no new tests', async () => {
    const { ws } = trial((w) => rmSync(join(w, 'test/compound.check.mjs')));
    const { byId } = await run(ws);
    expect(byId['feature-change'].accepted).toBe(false);
    expect(byId['feature-change'].evidence.failures.join('\n')).toMatch(/no new test/);
  });

  it('rejects uncommitted work', async () => {
    const { ws } = trial(() => {}, { commit: false });
    const { byId } = await run(ws);
    expect(byId['feature-change'].accepted).toBe(false);
  });

  it('rejects a QA pass on a tree whose own tests fail, critical', async () => {
    const { ws } = trial((w) => {
      writeFileSync(
        join(w, 'test/broken.check.mjs'),
        "import { test } from 'node:test';\ntest('x', () => { throw new Error('no'); });\n",
      );
    });
    const { byId, units } = await run(ws);
    expect(byId['feature-change'].accepted).toBe(false);
    expect(byId['qa-report'].accepted).toBe(false);
    expect(units.critical.join('\n')).toMatch(/verdict pass/);
  });

  it('accepts an honest QA fail on a failing tree (the report is right even though the change is not)', async () => {
    const { ws } = trial(
      (w) => {
        writeFileSync(
          join(w, 'src/duration.mjs'),
          readFileSync(join(inputs, 'workspace/src/duration.mjs')),
        );
      },
      { report: (sha) => goodReport(sha, 'fail') },
    );
    const { byId, units } = await run(ws);
    expect(byId['feature-change'].accepted).toBe(false);
    expect(byId['qa-report'].accepted).toBe(true);
    expect(units.critical).toEqual([]);
  });

  it('rejects a QA fail on a passing tree', async () => {
    const { ws } = trial(() => {}, { report: (sha) => goodReport(sha, 'fail') });
    const { byId } = await run(ws);
    expect(byId['qa-report'].accepted).toBe(false);
    expect(byId['qa-report'].evidence.failures.join('\n')).toMatch(/does not match/);
  });

  it('rejects a QA report that names a different commit', async () => {
    const { ws } = trial(() => {}, { report: () => goodReport(pinned) });
    const { byId } = await run(ws);
    expect(byId['feature-change'].accepted).toBe(true);
    expect(byId['qa-report'].accepted).toBe(false);
    expect(byId['qa-report'].evidence.failures.join('\n')).toMatch(/not the final HEAD/);
  });

  it('rejects a QA report that names no commands, and a missing one', async () => {
    const none = trial(() => {}, {
      report: (sha) => `Commit: ${sha}\nI looked at it and it seems fine.\nVerdict: pass\n`,
    });
    const r1 = await run(none.ws);
    expect(r1.byId['qa-report'].accepted).toBe(false);
    expect(r1.byId['qa-report'].evidence.failures.join('\n')).toMatch(/no command/);

    const missing = trial(() => {}, { report: null });
    const r2 = await run(missing.ws);
    expect(r2.byId['qa-report'].accepted).toBe(false);
    expect(r2.byId['qa-report'].evidence.failures.join('\n')).toMatch(/no QA\.md/);
  });
});

describe('parseReport', () => {
  it('reads commit, verdict and commands from fenced and inline forms', () => {
    const p = parseReport(
      '**Commit:** abcdef1234\n```\n$ node --test "test/*.check.mjs"\n```\nalso `git log -1`\n**Verdict:** PASS\n',
    );
    expect(p).toMatchObject({ commit: 'abcdef1234', verdict: 'pass', ranTests: true });
    expect(p.commands).toEqual(['node --test "test/*.check.mjs"', 'git log -1']);
  });
});
