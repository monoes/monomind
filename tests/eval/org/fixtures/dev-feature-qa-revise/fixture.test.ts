// dev-feature-qa-revise fixture (approved by the owner 2026-10-02): the implementer adds a feature, and QA finds a
// real defect the draft already had, one its own header comment forbids and the existing tests miss. The
// honest flow is publish, reject, revise, republish, accept. These tests show the flow cannot skip the
// reject: the first version passes everything the implementer can see and still fails QA's checks.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HandoffStore } from '../../pilot/store.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8')).fixture;
const pilot = JSON.parse(readFileSync(join(here, '../../pilot/dev-feature-qa.pilot.json'), 'utf8'));

const GIT_ENV = {
  PATH: process.env.PATH,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
const build = (): string => {
  const out = join(mkdtempSync(join(tmpdir(), 'revise-')), 'repo');
  execFileSync('node', [join(here, 'build-fixture.mjs'), out], { encoding: 'utf8' });
  return out;
};
/** `node --test` over the repo's test files, plus any extra file copied into test/. */
const run = (repo: string, ...extra: string[]) => {
  const r = spawnSync('node', ['--test', '--test-reporter=tap', 'test/**/*.check.mjs'], {
    cwd: repo,
    encoding: 'utf8',
  });
  const out = `${r.stdout}${r.stderr}`;
  return {
    ok: r.status === 0,
    failed: [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1].trim()),
    out,
    extra,
  };
};
const withAcceptance = (repo: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'revise-qa-'));
  cpSync(repo, dir, { recursive: true });
  cpSync(join(here, 'hidden/acceptance.check.mjs'), join(dir, 'test/acceptance.check.mjs'));
  return dir;
};
/** A committed tree: the template plus the given source and the implementer's own tests. */
const version = (src: string | undefined) => {
  const repo = build();
  if (src)
    cpSync(join(here, 'hidden/reference', src, 'duration.mjs'), join(repo, 'src/duration.mjs'));
  cpSync(
    join(here, 'hidden/implementer/added.check.mjs'),
    join(repo, 'test/added/added.check.mjs'),
  );
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', src ?? 'draft');
  return { repo, sha: git(repo, 'rev-parse', 'HEAD') };
};

const WHITESPACE =
  'whitespace inside a duration is an error (the module says so); only the ends are trimmed';

describe('the dev-feature-qa-revise fixture', () => {
  it('is marked approved and builds to its pinned commit every time', () => {
    expect(JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8')).status).toMatch(
      /^APPROVED 2026-10-02/,
    );
    for (let i = 0; i < 2; i++)
      expect(git(build(), 'rev-parse', 'HEAD')).toBe(fixture.pinned_commit);
  });

  it('starts with a draft whose own tests pass while it contradicts its header comment', async () => {
    const repo = build();
    expect(run(repo).ok).toBe(true);
    const { parseDuration } = await import(join(repo, 'src/duration.mjs'));
    const header = readFileSync(join(repo, 'src/duration.mjs'), 'utf8').split('\n// ').join(' ');
    expect(header).toContain('Whitespace inside a duration is an error; only the ends');
    expect(parseDuration('1h 30m')).toBe(5_400_000); // the seeded defect: it should throw
  });

  it("fails QA's checks on the draft for the missing feature and for the seeded defect", () => {
    const r = run(withAcceptance(build()));
    expect(r.ok).toBe(false);
    expect(r.failed).toContain('parses the ISO-8601 time form');
    expect(r.failed).toContain(WHITESPACE);
  });

  it('the first version adds the feature, passes every test the implementer can see, and still fails QA, on the defect alone', () => {
    const { repo } = version('v1');
    expect(run(repo).ok).toBe(true); // existing tests and the implementer's own added tests
    const qa = run(withAcceptance(repo));
    expect(qa.ok).toBe(false);
    expect(qa.failed).toEqual([WHITESPACE]);
  });

  it('the revision fixes the defect and passes everything', () => {
    const { repo } = version('v2');
    expect(run(repo).ok).toBe(true);
    expect(run(withAcceptance(repo)).ok).toBe(true);
  });
});

describe('the reference flow through the hand-off documents needs a reject and a republish', () => {
  const contracts = pilot.contracts;
  const summary = (sha: string, note: string) => ({
    summary: `Adds the ISO-8601 time form to parseDuration (${note}).`,
    commit: sha,
    tests_added: ['test/added/added.check.mjs'],
    commands_run: ['npm test'],
  });

  it('accepting the first version would be wrong, so QA rejects it, the implementer republishes, and the second is accepted', () => {
    const store = new HandoffStore(mkdtempSync(join(tmpdir(), 'revise-store-')), contracts);
    const v1 = version('v1');
    const v2 = version('v2');

    // implementer publishes version 1
    expect(
      store.publish('implementer', 'change-summary', summary(v1.sha, 'first version')),
    ).toMatchObject({ ok: true, version: 1 });
    // QA verifies that exact commit: it fails, so accepting would be wrong
    const qa1 = run(withAcceptance(v1.repo));
    expect(qa1.ok).toBe(false);
    expect(
      store.decide(
        'qa-engineer',
        'change-summary',
        1,
        'reject',
        `acceptance failed: ${qa1.failed.join('; ')} (try '1h 30m')`,
      ),
    ).toMatchObject({ ok: true, status: 'rejected' });
    expect(
      store.publish('qa-engineer', 'qa-verdict', {
        verdict: 'fail',
        commit: v1.sha,
        commands_run: ['node --test test/**/*.check.mjs'],
        defects: ['inner whitespace is accepted: parseDuration("1h 30m") returns 5400000'],
      }),
    ).toMatchObject({ ok: true, version: 1 });

    // implementer republishes the revision
    expect(
      store.publish(
        'implementer',
        'change-summary',
        summary(v2.sha, 'revised: inner whitespace is rejected'),
      ),
    ).toMatchObject({ ok: true, version: 2 });
    const qa2 = run(withAcceptance(v2.repo));
    expect(qa2.ok).toBe(true);
    expect(store.decide('qa-engineer', 'change-summary', 2, 'accept')).toMatchObject({
      ok: true,
      status: 'accepted',
    });
    expect(
      store.publish('qa-engineer', 'qa-verdict', {
        verdict: 'pass',
        commit: v2.sha,
        commands_run: ['node --test test/**/*.check.mjs'],
        defects: [],
      }),
    ).toMatchObject({ ok: true, version: 2 });

    // the record: a rejected version, then an accepted one; two publish attempts, within the cap
    const read = (v: number) =>
      (store.read('qa-engineer', 'change-summary', v) as { doc: { status: string } }).doc.status;
    expect([read(1), read(2)]).toEqual(['rejected', 'accepted']);
    expect(store.attempts('change-summary')).toBe(2);
    expect(store.attempts('change-summary')).toBeLessThanOrEqual(contracts[0].max_attempts);
    expect(
      store
        .events()
        .filter((e) => e.kind === 'decide')
        .map((e) => e.detail),
    ).toEqual(['reject', 'accept']);
  });

  it('a flow that accepted the first version never reaches a tree that passes QA', () => {
    const v1 = version('v1');
    expect(run(withAcceptance(v1.repo)).ok).toBe(false); // so "accept v1" cannot be what QA, doing its job, does
  });
});
