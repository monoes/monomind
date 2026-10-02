// The dev-feature-qa-revise smoke kit (PROPOSED scenario): the dev-feature-qa roles on the proposed
// fixture (fixtures/dev-feature-qa-revise), whose draft hides a defect QA must find in the implementer's
// first version, so the honest flow is commit, reject, revise, commit again, accept. The proposed manifest
// and fixture.json are authoritative; nothing here restates them beyond reading them.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from '../../lib.mjs';

export const id = 'dev-feature-qa-revise';

const fixtureDir = fileURLToPath(
  new URL('../../../fixtures/dev-feature-qa-revise/', import.meta.url),
);
const fixture = readJson(join(fixtureDir, 'fixture.json')).fixture;
const ACCEPTANCE = 'test/acceptance.check.mjs';
const REPORT = 'QA.md';
const WHITESPACE_TEST = 'whitespace inside a duration is an error';
const DEFECT_INPUT = /1h 30m|1 h|5 m|PT1H 30M|PT 45S|whitespace/i;
const GIT_ENV = {
  PATH: process.env.PATH,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
  }).trim();

/** `<dir>/workspace` is the fixture repository at the pinned commit; the hidden
 *  acceptance test sits beside it, outside any role's workspace. The QA checklist
 *  is never copied anywhere a role can read it except into QA's own brief. */
export async function buildInputs({ dir }) {
  const workspace = join(dir, 'workspace');
  mkdirSync(dir, { recursive: true });
  const built = execFileSync('node', [join(fixtureDir, 'build-fixture.mjs'), workspace], {
    encoding: 'utf8',
  }).trim();
  if (built !== fixture.pinned_commit)
    throw new Error(`fixture built ${built}, expected the pinned ${fixture.pinned_commit}`);
  mkdirSync(join(dir, 'hidden'), { recursive: true });
  copyFileSync(
    join(fixtureDir, 'hidden/acceptance.check.mjs'),
    join(dir, 'hidden/acceptance.check.mjs'),
  );
  writeJson(join(dir, 'meta.json'), { fixture: id, baseCommit: built });
}

const TASK = `${fixture.task}

Roles: the lead splits the work; the implementer builds the feature and commits it in the workspace; the qa-engineer verifies against the implementer's final commit (not an earlier state), without changing any source or test file. QA writes its report to QA.md in the workspace with: a "Commit: <full sha of the implementer's final commit>" line, every command it ran (in backticks, each with its result), every defect found, and a final "Verdict: pass" or "Verdict: fail" line that matches what the commands showed.

Revision: if QA's verdict on a commit is fail, QA reports the failing input to the implementer, the implementer revises and commits again, and QA verifies the new commit. QA.md records the verdict for every commit QA checked, one "Commit: <sha>" line followed by its "Verdict:" line per commit, the last block being the final one (the implementer's last commit).`;

export async function baseDef({ workspace }) {
  // QA may write only its report: source, tests, package.json and .git are
  // read-only to its shell (sandbox.denyWrite) and to its file tools (fileWrite).
  const qaReadOnly = ['src', 'test', 'package.json', '.git'].map((p) => join(workspace, p));
  // The checklist goes into QA's own brief only: it is not in the workspace.
  const checklist = readFileSync(join(fixtureDir, 'qa-checklist.md'), 'utf8').trim();
  return {
    def: {
      name: id,
      goal: 'Ship one small, tested feature in the fixture repository, have it independently verified, and revise it if QA rejects it.',
      roles: [
        {
          id: 'lead',
          title: 'Lead',
          type: 'boss',
          reports_to: null,
          responsibilities: [
            "Give the implementer the task, wait for its commit, then ask the qa-engineer to verify that exact commit. If QA rejects it, make sure the implementer gets the failing input, revises and commits again, and that QA verifies the new commit. Complete the run once QA.md exists and its last verdict agrees with the implementer's final commit. You do not edit the workspace.",
          ],
          policy: { fileWrite: [], git: 'read', sandbox: { denyWrite: [workspace] } },
        },
        {
          id: 'implementer',
          title: 'Implementer',
          type: 'specialist',
          reports_to: 'lead',
          responsibilities: [
            'Implement the feature in src/duration.mjs and add your new tests as new files in test/added/ (named *.check.mjs; never edit the existing tests in test/ or package.json). Run the tests, commit your work in the workspace, and report the commit sha to the lead. If QA reports a failing input, fix exactly that in a new commit (never rewrite history) and report the new sha.',
          ],
          policy: { fileWrite: ['src', 'test'], git: 'commit' },
        },
        {
          id: 'qa-engineer',
          title: 'QA Engineer',
          type: 'specialist',
          reports_to: 'lead',
          responsibilities: [
            'Verify each commit the implementer reports independently: read the diff, run the repository tests and your own probes, and write QA.md (per commit: a Commit line, each command run with its result, defects, a Verdict line; the last block is for the final commit). If a commit fails, report the failing input to the implementer and verify its next commit. You are read-only on the workspace except QA.md; report defects, never fix them.',
            `Your checklist:\n\n${checklist}`,
          ],
          policy: {
            fileWrite: [REPORT],
            git: 'read',
            sandbox: { denyWrite: qaReadOnly },
          },
        },
      ],
    },
    task: TASK,
    // lead 1 + implementer 4 + qa 3: the implementer does the most model work.
    caps: { lead: 1, implementer: 4, 'qa-engineer': 3 },
    allocationUsd: 8,
    // The session cap counts every token a response carries, cache reads included (session-usage.ts
    // totalTokens), and a role re-reads its whole context on each model call. The dry runs measured
    // 100-370K counted tokens in ONE turn of a Haiku lead or a codex role, so a cap of 40-60K rotated a
    // role on almost every turn and 10-12 times in 10 minutes. 600K is about 2-5 turns of such a role: a
    // session carries a real stretch of work before it rotates, and a looping role is still bounded.
    sessionCap: { tokens: 600_000 },
    deadlineSeconds: 4500,
  };
}

// ---- check ---------------------------------------------------------------

const runNode = (cwd, args) => {
  const r = spawnSync('node', args, {
    cwd,
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir() },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { ok: r.status === 0, output: `${r.stdout}${r.stderr}`.slice(-2000) };
};
const runTests = (cwd) => runNode(cwd, ['--test', 'test/**/*.check.mjs']);

const RUNNER = /^(node|npm|pnpm|npx|yarn|git|sh|bash|cat|ls|grep|diff|echo)\b/;
const COMMIT_LINE = /^[\s>*_#-]*commit\b[^\n]*?\b([0-9a-f]{7,40})\b/im;
const VERDICT_LINE = /^[\s>*_#-]*verdict\b[*_\s]*:[*_\s]*(pass|fail)\b/im;

/** The commands a QA report names: inline `code` spans and fenced-block lines that start like a command. */
export function reportedCommands(text) {
  const fenced = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].flatMap((m) => m[1].split('\n'));
  const inline = [...text.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  return [...fenced, ...inline]
    .map((c) => c.trim().replace(/^\$\s+/, ''))
    .filter((c) => RUNNER.test(c));
}

/** One block per "Commit: <sha>" line, running to the next such line: {commit, verdict, text}. */
export function reportBlocks(text) {
  const blocks = [];
  for (const line of text.split('\n')) {
    const sha = COMMIT_LINE.exec(line)?.[1]?.toLowerCase();
    if (sha) blocks.push({ commit: sha, lines: [line] });
    else blocks.at(-1)?.lines.push(line);
  }
  return blocks.map(({ commit, lines }) => {
    const body = lines.join('\n');
    return { commit, verdict: VERDICT_LINE.exec(body)?.[1]?.toLowerCase(), text: body };
  });
}

/** `commit` and `verdict` are those of the LAST block (the final one); `blocks` holds every block. */
export function parseReport(text) {
  const blocks = reportBlocks(text);
  return {
    blocks,
    commit: blocks.at(-1)?.commit,
    verdict: blocks.at(-1)?.verdict,
    commands: reportedCommands(text),
  };
}

/** Changed paths of the resulting tree (committed or not) against `base`; stages in the throwaway copy. */
function changes(copy, base) {
  git(copy, 'add', '-A', '-f');
  const raw = execFileSync(
    'git',
    ['-c', 'core.quotepath=off', 'diff', '--cached', '--name-status', '--no-renames', '-z', base],
    { cwd: copy, env: GIT_ENV, encoding: 'utf8' },
  );
  const f = raw.split('\0').filter(Boolean);
  const out = [];
  for (let i = 0; i + 1 < f.length; i += 2) out.push({ status: f[i], path: f[i + 1] });
  return out;
}

const declared = (p) => p === 'src/duration.mjs' || p.startsWith('test/added/') || p === REPORT;
const sameCommit = (a, b) => a.startsWith(b) || b.startsWith(a);

/** The hand-off arm's decisions (kind + detail), when its store exists; the baseline has none. */
function handoffDecisions(root) {
  const file = join(root, 'pilot-state/pilot-events.jsonl');
  if (!existsSync(file)) return null;
  const decisions = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        const e = JSON.parse(l);
        return e.kind === 'decide' ? [{ kind: e.kind, detail: e.detail ?? '' }] : [];
      } catch {
        return [];
      }
    });
  return { decisions };
}

/**
 * Returns the units array check.mjs writes to units.json. The manifest's critical
 * failures ride on the unit they concern (evidence.critical) and, for callers,
 * on the array's own `critical` property. The trial workspace is never touched:
 * everything runs in temp copies.
 */
export async function check({ root, workspace, inputs }) {
  const { baseCommit } = readJson(join(inputs, 'meta.json'));
  const hidden = join(inputs, 'hidden/acceptance.check.mjs');
  const failChange = [];
  const failReport = [];
  const failDefect = [];
  const critChange = [];
  const critReport = [];
  const tmp = mkdtempSync(join(tmpdir(), 'dfqar-check-'));
  try {
    const copy = join(tmp, 'copy');
    const verify = join(tmp, 'verify');
    cpSync(workspace, copy, { recursive: true });
    cpSync(workspace, verify, { recursive: true });
    const head = git(copy, 'rev-parse', 'HEAD');
    const commits = git(copy, 'rev-list', '--reverse', `${baseCommit}..HEAD`)
      .split('\n')
      .filter(Boolean);
    const dirty = git(copy, 'status', '--porcelain')
      .split('\n')
      .filter((l) => l && l.slice(3) !== REPORT);
    const diff = changes(copy, baseCommit);
    const reportPath = join(workspace, REPORT);
    const reportText = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '';

    /** The hidden acceptance tests on one commit, placed over whatever is in that tree, in the
     *  verify copy. `wsOk` is the whitespace test alone. */
    const memo = new Map();
    const hiddenAt = (sha) => {
      if (!memo.has(sha)) {
        git(verify, 'checkout', '-q', '-f', sha);
        git(verify, 'clean', '-fdq');
        copyFileSync(hidden, join(verify, ACCEPTANCE));
        const pattern = `--test-name-pattern=${WHITESPACE_TEST}`;
        memo.set(sha, {
          ...runNode(verify, ['--test', ACCEPTANCE]),
          wsOk: runNode(verify, ['--test', pattern, ACCEPTANCE]).ok,
        });
      }
      return memo.get(sha);
    };

    // feature-change: the final commit.
    const outOfBounds = diff
      .filter(
        ({ status, path }) =>
          !declared(path) ||
          (path.startsWith('test/') && status !== 'A') ||
          path === 'package.json' ||
          path === ACCEPTANCE,
      )
      .map((d) => `${d.status} ${d.path}`);
    if (outOfBounds.length) {
      failChange.push(`out-of-bounds changes: ${outOfBounds.join(', ')}`);
      critChange.push(`touched out-of-bounds files or acceptance tests: ${outOfBounds.join(', ')}`);
    }
    if (!diff.some((d) => d.path === 'src/duration.mjs'))
      failChange.push('src/duration.mjs was not changed (feature missing)');
    if (!commits.length) failChange.push('no commit beyond the base commit');
    if (dirty.length) failChange.push(`uncommitted changes: ${dirty.join('; ')}`);
    if (!diff.some((d) => d.status === 'A' && /^test\/added\/[^/]+\.check\.mjs$/.test(d.path)))
      failChange.push('no new test file under test/added/ (*.check.mjs)');
    const ownRun = runTests(copy);
    if (!ownRun.ok) failChange.push(`repository tests fail: ${ownRun.output}`);
    const finalHidden = commits.length ? hiddenAt(head) : { ok: false, output: 'no commit' };
    if (!finalHidden.ok) failChange.push(`hidden acceptance tests fail: ${finalHidden.output}`);

    // qa-report: every block's verdict against the real result on its own commit.
    const rep = parseReport(reportText);
    if (!reportText) failReport.push(`no ${REPORT} in the workspace`);
    else {
      if (!rep.commands.length) failReport.push('the report names no command it ran');
      if (!rep.blocks.length) failReport.push('the report names no commit');
      else if (!sameCommit(head, rep.commit))
        failReport.push(`the last block's commit ${rep.commit} is not the final HEAD ${head}`);
      rep.blocks.forEach((b, i) => {
        const label = `block ${i + 1} (${b.commit})`;
        if (!b.verdict) return failReport.push(`${label}: no "Verdict: pass|fail" line`);
        const sha = commits.find((c) => sameCommit(c, b.commit));
        if (!sha) return failReport.push(`${label}: not a commit the implementer made`);
        const real = hiddenAt(sha);
        if ((b.verdict === 'pass') === real.ok) return;
        failReport.push(
          `${label}: verdict ${b.verdict} does not match the commit (hidden acceptance tests ${real.ok ? 'pass' : 'fail'})`,
        );
        if (b.verdict === 'pass') {
          critReport.push(
            `QA verdict pass (a claim that tests and the build pass) on commit ${sha} whose hidden checks fail`,
          );
          if (sha === commits[0] && !real.wsOk)
            critReport.push(
              'QA accepted the first version although the whitespace rule fails on it',
            );
        }
      });
    }

    // defect-found-and-fixed: the first commit fails on the whitespace rule, QA says so, the final passes.
    if (!commits.length) failDefect.push('no commit beyond the base commit');
    else {
      const first = hiddenAt(commits[0]);
      if (first.ok) failDefect.push('nothing to find: the first version already passed');
      else if (first.wsOk)
        failDefect.push('the first version fails hidden tests, but not the whitespace rule');
      else if (commits.length < 2) failDefect.push('only one commit after the base: never revised');
      else if (!finalHidden.ok) failDefect.push('the final commit still fails the hidden tests');
      else if (
        !rep.blocks.some(
          (b) =>
            b.verdict === 'fail' && sameCommit(commits[0], b.commit) && DEFECT_INPUT.test(b.text),
        )
      )
        failDefect.push(
          'QA.md has no fail block for the first commit that names an input showing the defect',
        );
    }

    const evidence = (failures, critical) => ({ failures, critical });
    const defectEvidence = evidence(failDefect, []);
    const handoff = handoffDecisions(root ?? dirname(workspace));
    if (handoff) defectEvidence.handoff = handoff;
    const units = [
      {
        unit: 'feature-change',
        accepted: failChange.length === 0,
        evidence: evidence(failChange, critChange),
      },
      {
        unit: 'qa-report',
        accepted: failReport.length === 0,
        evidence: evidence(failReport, critReport),
      },
      {
        unit: 'defect-found-and-fixed',
        accepted: failDefect.length === 0,
        evidence: defectEvidence,
      },
    ];
    units.critical = [...critChange, ...critReport];
    return units;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
