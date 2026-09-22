/**
 * ADR-O001 D6: org DEFINITIONS (`.monomind/orgs/<org>.json`) are
 * version-controlled, so a config change has history, review and rollback
 * instead of existing only on one machine.
 *
 * This asserts the behaviour of THIS repository's own root `.gitignore` —
 * the file that actually decides, since `.monomind/.gitignore` carries no
 * pattern matching anything under `orgs/`. `write-runtime-config-gitignore.test.ts`
 * covers the generated template for fresh projects; these two are different
 * files and neither rewrites the other (init only ever APPENDS to an
 * existing `.monomind/.gitignore`, and its root-.gitignore rewrite is gated
 * behind `replacementIsBlanketEquivalent`, which is false).
 *
 * The allow-list is deliberately one explicit line PER ORG rather than
 * `!.monomind/orgs/*.json`. `.monomind/orgs/` is not a directory of
 * definitions — it is the org runtime's working directory, and the runtime
 * and the mastermind skills write ~20 sibling `<org>-*.json` files into it
 * (`-state`, `-secrets`, `-members`, `-approvals`, `-join-requests`,
 * `-budgets`, …). A `*.json` glob re-includes every one of them, including
 * `<org>-secrets.json`, which is exactly the deny-by-default guarantee i-052
 * was written to establish after a live dashboard credential reached a
 * public repo. Cost of the explicit form: one line when an org is added.
 * Failure mode: "my org definition isn't tracked" (visible, recoverable)
 * instead of "a secrets file is tracked" (silent, not recoverable).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = fileURLToPath(new URL('.', import.meta.url));

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: testDir,
  encoding: 'utf8',
}).trim();

/**
 * `--no-index` matters here: several of these paths ARE tracked, and plain
 * `git check-ignore` refuses to report on a tracked path. Deliberately NOT
 * `-v`: with `-v`, git exits 0 whenever any pattern matched, including a
 * negation, so the exit status stops meaning "ignored" — the same trap
 * documented at length in write-runtime-config-gitignore.test.ts.
 */
function isIgnored(relPath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--no-index', relPath], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/** Every org definition this repo tracks. */
const ORG_DEFINITIONS = ['sample-team.json', 'monomind-dev.json', 'release.json'];

describe('.monomind/orgs org definitions are version-controlled (ADR-O001 D6)', () => {
  it.each(ORG_DEFINITIONS)('.monomind/orgs/%s is committable', (file) => {
    expect(isIgnored(`.monomind/orgs/${file}`)).toBe(false);
  });

  it('every .json actually present under .monomind/orgs/ is either a listed definition or ignored', () => {
    let entries: string[];
    try {
      entries = readdirSync(join(repoRoot, '.monomind', 'orgs'));
    } catch {
      return; // no orgs dir in this checkout (e.g. a bare worktree) — nothing to check
    }
    const unexpected = entries.filter(
      (name) =>
        name.endsWith('.json') &&
        !ORG_DEFINITIONS.includes(name) &&
        !isIgnored(`.monomind/orgs/${name}`),
    );
    expect(unexpected).toEqual([]);
  });
});

describe('.monomind/orgs runtime state stays ignored', () => {
  // The org runtime's own sibling files, plus the mastermind skills' files.
  // `<org>-secrets.json` is the one that makes a `*.json` allow-list
  // unacceptable; the rest are noise that a checkout should never carry.
  const RUNTIME_PATHS = [
    '.monomind/orgs/monomind-dev-state.json',
    '.monomind/orgs/monomind-dev-threads.jsonl',
    '.monomind/orgs/monomind-dev-secrets.json',
    '.monomind/orgs/monomind-dev-members.json',
    '.monomind/orgs/monomind-dev-approvals.json',
    '.monomind/orgs/monomind-dev-join-requests.json',
    '.monomind/orgs/monomind-dev-budgets.json',
    '.monomind/orgs/monomind-dev-issues.json',
    '.monomind/orgs/monomind-dev-activity.jsonl',
    '.monomind/orgs/monomind-dev-memory/projects/notes.md',
    '.monomind/orgs/monomind-dev/runtime.json',
    '.monomind/orgs/monomind-dev/questions.json',
    '.monomind/orgs/monomind-dev/run-1/bus.jsonl',
    '.monomind/orgs/monomind-dev/work/src/package.json',
    '.monomind/orgs/.secrets/monomind-dev/OPENAI_API_KEY',
    '.monomind/orgs/dashboard-token',
  ];

  it.each(RUNTIME_PATHS)('%s is ignored', (relPath) => {
    expect(isIgnored(relPath)).toBe(true);
  });

  // The whole point of deny-by-default: a file the runtime starts writing
  // tomorrow, that nobody remembers to add to any list, is already ignored.
  it('a runtime file nobody has named anywhere is ignored by construction', () => {
    expect(isIgnored('.monomind/orgs/some-future-runtime-file.json')).toBe(true);
    expect(isIgnored('.monomind/orgs/some-future-dir/anything')).toBe(true);
  });

  // Positive control: the harness can distinguish the two answers at all.
  it('control: a plainly-unignored repo file reads as not ignored', () => {
    expect(isIgnored('package.json')).toBe(false);
  });
});

describe('the org allow-list is never widened to a glob', () => {
  it('root .gitignore un-ignores org definitions by name, never with a *.json pattern', () => {
    const lines = readFileSync(join(repoRoot, '.gitignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim());
    const globbedAllows = lines.filter((line) => /^!\.monomind\/orgs\/.*\*/.test(line));
    expect(globbedAllows).toEqual([]);
  });
});
