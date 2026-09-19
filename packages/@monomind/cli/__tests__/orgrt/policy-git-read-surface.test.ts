/**
 * #299: `policy.git: read`'s subcommand allowlist (`GIT_READ_CMDS`,
 * `policy-git.ts`) was missing ordinary read-only git commands — this org's own
 * reviewer role was denied `git merge-base` while reviewing a branch — and
 * `stash list`/`stash show` were denied with the *mutating* message because all
 * of `stash` lived in `GIT_COMMIT_CMDS`.
 *
 * This file owns the read-surface table so `policy-git.test.ts` (already at the
 * 500-line limit, and the bypass-regression suite) doesn't have to grow. It
 * duplicates that file's 6-line `allows()` helper on purpose.
 *
 * Review round 1 found two real defects in the first cut (ground truth taken
 * from `man git-reflog` / `man git-stash` on this machine, git 2.55.0, not
 * from the plan's enumeration, which was short):
 *  - the reflog deny-list was missing `drop`/`write`, so they went DENY→ALLOW
 *    at read. `reflog drop` is worse than the `expire` it already caught: it
 *    deletes a reflog outright, the only recovery path for unreferenced
 *    commits.
 *  - the stash allowlist skipped leading option tokens the same way the
 *    reflog deny-list does, so `git stash -- list` / `git stash -k list`
 *    (both real `stash push` calls — a WRITE onto the stack shared across
 *    every worktree) went DENY→ALLOW at read. git's own `cmd_stash`
 *    dispatches on argv[0] only, with no option-skipping — this file tests
 *    that way too.
 *
 * Review round 2 reversed the reflog fix entirely: a deny-list of write
 * verbs (even a complete one) fails OPEN the moment a git version a role
 * actually runs adds or renames a verb — and a runtime guard that parses
 * `git reflog -h` only validates the git our own CI runs, which is never the
 * git whose drift is the risk. reflog is now an ALLOWLIST with a bounded,
 * self-documenting over-denial cost — see `reflogIsRead`'s comment in
 * policy-git.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../../src/orgrt/policy.js';

type Level = 'none' | 'read' | 'commit' | 'push';

const noopBus = { emit: () => { /* assertions read decide()'s return, not the bus */ } };

async function allows(level: Level, command: string): Promise<boolean> {
  const p = new PolicyEngine('coder', { git: level, maxTokens: 1_000_000 } as never, noopBus as never, process.cwd());
  return (await p.decide('Bash', { command })).behavior === 'allow';
}

async function denyMessage(level: Level, command: string): Promise<string | null> {
  const p = new PolicyEngine('coder', { git: level, maxTokens: 1_000_000 } as never, noopBus as never, process.cwd());
  const d = await p.decide('Bash', { command });
  return d.behavior === 'deny' ? d.message : null;
}

// Every genuine read this org's role hit (#299's own reproduction) or the
// issue names, plus the args-aware `stash`/`reflog` reads.
// Rejects: an allowlist that still doesn't cover the real read-only surface.
const READ_ROWS: string[] = [
  'git ls-remote origin',
  'git merge-base main HEAD',
  'git show-ref',
  'git name-rev HEAD',
  'git cherry main',
  'git range-diff a...b',
  'git check-ignore x',
  'git check-attr diff -- x',
  'git count-objects -v',
  'git var GIT_AUTHOR_IDENT',
  'git reflog',
  'git reflog -5',
  'git reflog --all', // options-only form — targets the default `show`, not a write
  'git reflog show main',
  'git reflog list',
  'git reflog exists refs/heads/main',
  'git stash list',
  'git stash show -p',
];

// Mutating commands that must stay denied at 'read' — several already passed
// before this fix; they are kept here as the guard against a sloppy widening.
// Split by WHERE they land at 'commit', since the ladder test below needs that.
// Rejects: an allowlist that's missing an option-only form, or an
// options-skipping bug that lets an option-prefixed mutating form through.
const COMMIT_ALLOWED_ROWS: string[] = [
  'git cherry-pick abc',
  'git reflog expire --all',
  'git reflog delete HEAD@{0}',
  'git reflog drop --all',
  'git reflog drop refs/heads/main',
  'git reflog write refs/heads/x aaa bbb msg',
  // reflogIsRead's accepted cost (review round 2): a real ref name as the
  // first positional is NOT recognized as read-safe — real git would treat
  // this as an implicit `show <ref>` (a read), but this allowlist can't tell
  // "future git verb we haven't seen" from "a literal ref/branch name"
  // without hardcoding every verb of every future git, so it denies both.
  // Bounded, self-documenting (the deny message names the working form,
  // `git reflog show <ref>`) — the intentional trade this design makes.
  'git reflog HEAD',
  'git reflog my-branch',
  'git stash',
  'git stash push -m x',
  'git stash pop',
  'git stash drop',
  'git stash clear',
  'git stash apply',
  'git stash branch x',
  'git stash save msg',
  // review round 1: measured DENY→ALLOW at read pre-fix (option-skipping bug —
  // git's cmd_stash reads argv[0] only, so these are `stash push` with a
  // pathspec/option, never `stash list`/`stash show`).
  'git stash -- list',
  'git stash -- show',
  'git stash -k list',
  'git stash -u list',
  'git symbolic-ref HEAD refs/heads/x',
  'git update-ref refs/heads/x HEAD',
  'git notes add',
  'git bisect start',
  'git commit -m x',
];
// Push-level: denied at both 'read' AND 'commit', only allowed at 'push'.
const PUSH_ONLY_ROWS: string[] = ['git push', 'git fetch', 'git clone https://example.com/repo.git'];

const DENIED_AT_READ_ROWS = [...COMMIT_ALLOWED_ROWS, ...PUSH_ONLY_ROWS];

describe('policy.git: read — read-only subcommand surface (#299)', () => {
  it.each(READ_ROWS)('allows %s at read', async (cmd) => {
    expect(await allows('read', cmd), cmd).toBe(true);
  });

  it.each(DENIED_AT_READ_ROWS)('still denies %s at read', async (cmd) => {
    expect(await allows('read', cmd), cmd).toBe(false);
  });

  // The headline symptom (#299's actual repro): pre-fix this was denied with
  // the *mutating* message — "git stash denied (policy.git: read — mutating
  // commands require policy.git: 'commit' or 'push')" — not "unrecognized",
  // because all of `stash` sat in GIT_COMMIT_CMDS. Post-fix it must be allowed
  // outright (no deny message at all).
  // Rejects: a fix that only changes the wording of the deny, not the verdict.
  it('"git stash list" is allowed at read, not merely denied with a different message', async () => {
    expect(await denyMessage('read', 'git stash list')).toBeNull();
  });

  // `stash pop` must still deny with the *mutating* message (not "unrecognized")
  // — it stays in GIT_COMMIT_CMDS for i-300 to move; refineSub must not touch it.
  // Rejects: refineSub accidentally routing unrefined 'stash' out of GIT_COMMIT_CMDS.
  it('"git stash pop" still denies with the mutating-commands message', async () => {
    const msg = await denyMessage('read', 'git stash pop');
    expect(msg).toMatch(/mutating commands require policy\.git: 'commit' or 'push'/);
  });

  // reflog's denial names the working form, so a role isn't just told "no".
  // Rejects: a reflog denial that regresses to the generic "unrecognized
  // git subcommand" message with no remedy.
  it('"git reflog HEAD" denies with a message naming the working form', async () => {
    const msg = await denyMessage('read', 'git reflog HEAD');
    expect(msg).toMatch(/git reflog show <ref>/);
  });

  // Rejects: GIT_READ_CMDS ever losing its anchoring (e.g. swapped for a
  // `\b…\b` match), which would let `cherry-pick` spuriously match `cherry`.
  it('`cherry` is safe to add only because the subcommand regex is anchored — `cherry-pick` cannot match it', async () => {
    expect(await allows('read', 'git cherry main')).toBe(true);
    expect(await allows('read', 'git cherry-pick abc')).toBe(false);
  });

  // Review round 1, minor, reasoning updated for round 2's allowlist redesign:
  // refineSub's stash pattern is case-sensitive, matching git's own
  // case-sensitive dispatch — `git stash sHoW` is not `show` to git either,
  // it falls through to the default `push` (a write), so this must stay
  // denied. (reflog's allowlist denies ANY unrecognized positional
  // regardless of case — `git reflog EXPIRE` is denied the same bounded way
  // `git reflog HEAD` is, not because of case-folding risk specifically;
  // case-sensitivity is no longer reflog's load-bearing property now that
  // it's a closed allowlist rather than an open deny-list.)
  // Rejects: a stash refineSub that case-folds its positional before matching.
  it("refineSub's stash pattern is case-sensitive, matching git's own dispatch (not an oversight)", async () => {
    expect(await allows('read', 'git stash sHoW')).toBe(false); // unrecognized -> default `push`
  });

  it('level ladder: reads stay allowed at commit; commit-level mutators flip to allowed; push-level stays denied until push', async () => {
    for (const cmd of READ_ROWS) {
      expect(await allows('commit', cmd), `commit: ${cmd}`).toBe(true);
    }
    for (const cmd of COMMIT_ALLOWED_ROWS) {
      expect(await allows('commit', cmd), `commit: ${cmd}`).toBe(true);
    }
    for (const cmd of PUSH_ONLY_ROWS) {
      expect(await allows('commit', cmd), `commit: ${cmd}`).toBe(false);
      expect(await allows('push', cmd), `push: ${cmd}`).toBe(true);
    }
  });

  it("level ladder: every row is denied at 'none'", async () => {
    for (const cmd of [...READ_ROWS, ...DENIED_AT_READ_ROWS]) {
      expect(await allows('none', cmd), `none: ${cmd}`).toBe(false);
    }
  });

  // Asserting the new refinement can't be talked around the same way
  // gitConfigIsWrite's literal guard already can't (#257/#299).
  // Rejects: a refineSub/reflogIsRead that doesn't fail closed on an
  // expansion/substitution.
  it('fails closed at read when an expansion could hide the stash/reflog verb', async () => {
    const failClosed = [
      'git stash $SUB',
      'git reflog $X',
      'git stash "$(echo list)"',
      'git -C /repo reflog expire',
      'GIT_DIR=.git git stash pop',
      // Denied by the pre-existing interpreter rule (:139-145), not the new
      // code — kept here so a future refactor can't quietly lose it.
      'sh -c "git stash list"',
    ];
    for (const cmd of failClosed) {
      expect(await allows('read', cmd), cmd).toBe(false);
    }
  });

  // Review round 1: the previous version of this test hand-copied a list of
  // commands instead of reading the doc, so it could not detect the doc
  // drifting from the classifier (which is the only thing it exists to
  // catch) — it would still pass against a broken doc. This version actually
  // opens doc/concepts/org-runtime.md, finds the layer-3 read-surface
  // inventory line, strips the "(not `X`/`Y`)" exclusion notes (so a negative
  // example like `cherry-pick` isn't misread as a positive claim), and pulls
  // every remaining backticked token as a read-allowed claim.
  // Rejects: any classifier that permits an unrecognised reflog verb on a
  // git version we have not seen (round 2's actual concern), as well as a
  // hand-copied list that silently drifts from the doc (round 1's).
  it('doc/concepts/org-runtime.md agrees with the classifier: every subcommand it calls read-allowed is a true row above', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const docPath = join(here, '../../../../../doc/concepts/org-runtime.md');
    const doc = readFileSync(docPath, 'utf8');
    const line = doc.split('\n').find((l) => l.includes("Layer 3's `read`-level subcommand surface"));
    expect(line, 'doc/concepts/org-runtime.md must contain the layer-3 read-surface inventory line (#299)').toBeDefined();

    // Drop every "(...)" span first — that's where the negative examples
    // ("not `cherry-pick`", "not `reflog expire`/...") live — then take
    // everything after the first remaining colon, which is where the
    // backticked token list actually starts (the colon inside "`read`-level"
    // itself would otherwise be picked up as a bogus first claim).
    const withoutParens = line!.replace(/\([^)]*\)/g, '');
    const afterLabel = withoutParens.slice(withoutParens.indexOf(':') + 1);
    const claimed = [...afterLabel.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    // Sanity: the line must have actually matched and parsed into something
    // substantial, or this test would trivially pass on an empty doc line.
    expect(claimed.length).toBeGreaterThan(30);

    // `git config` alone is ambiguous (gitConfigIsWrite treats 0 args as a
    // write — "nothing parseable" defaults to write), so exercise it the way
    // the doc's "(reads only)" note means: an actual read-shaped invocation.
    const REPRESENTATIVE: Record<string, string> = {
      config: 'git config --get user.name',
    };
    for (const token of claimed) {
      const cmd = REPRESENTATIVE[token] ?? `git ${token}`;
      expect(await allows('read', cmd), `doc claims "${token}" is read-allowed via: ${cmd}`).toBe(true);
    }

    // And the doc must NOT claim these are read-allowed (they need push).
    expect(claimed).not.toContain('fetch');
    expect(claimed).not.toContain('clone');
  });
});
