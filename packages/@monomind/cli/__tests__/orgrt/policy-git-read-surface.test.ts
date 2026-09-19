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
 *  - `reflog drop`/`reflog write` were missing from the deny-list, so they went
 *    DENY→ALLOW at read. `reflog drop` is worse than the `expire` this already
 *    caught: it deletes a reflog outright, the only recovery path for
 *    unreferenced commits.
 *  - The stash allowlist skipped leading option tokens the same way the reflog
 *    deny-list does, so `git stash -- list` / `git stash -k list` (both real
 *    `stash push` calls — a WRITE onto the stack shared across every
 *    worktree) went DENY→ALLOW at read. git's own `cmd_stash` dispatches on
 *    argv[0] only, with no option-skipping — this file now tests that way too.
 */
import { execSync } from 'node:child_process';
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
  'git reflog HEAD',
  'git reflog show main',
  'git reflog list',
  'git reflog exists refs/heads/main',
  'git stash list',
  'git stash show -p',
];

// Mutating commands that must stay denied at 'read' — several already passed
// before this fix; they are kept here as the guard against a sloppy widening.
// Split by WHERE they land at 'commit', since the ladder test below needs that.
// Rejects: a deny-list/allowlist that's missing a real mutating verb, or an
// options-skipping bug that lets an option-prefixed mutating form through.
const COMMIT_ALLOWED_ROWS: string[] = [
  'git cherry-pick abc',
  'git reflog expire --all',
  'git reflog delete HEAD@{0}',
  // review round 1: measured DENY→ALLOW at read pre-fix (missing verbs).
  'git reflog drop --all',
  'git reflog drop refs/heads/main',
  'git reflog write refs/heads/x aaa bbb msg',
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

  // Rejects: GIT_READ_CMDS ever losing its anchoring (e.g. swapped for a
  // `\b…\b` match), which would let `cherry-pick` spuriously match `cherry`.
  it('`cherry` is safe to add only because the subcommand regex is anchored — `cherry-pick` cannot match it', async () => {
    expect(await allows('read', 'git cherry main')).toBe(true);
    expect(await allows('read', 'git cherry-pick abc')).toBe(false);
  });

  // Review round 1, minor: both refineSub patterns are case-sensitive, which
  // MATCHES git's own case-sensitive subcommand dispatch rather than being an
  // accidental side effect — an unrecognized-case reflog argv[0] is treated as
  // a <ref> (implicit `show`, a read); an unrecognized-case stash argv[0]
  // falls through to the default `push` (a write). Do not "fix" this by
  // case-folding — that would misclassify both rows below.
  // Rejects: a refineSub that case-folds its positional before matching.
  it("refineSub's case sensitivity matches git's own dispatch (not an oversight)", async () => {
    expect(await allows('read', 'git reflog EXPIRE --all')).toBe(true); // unrecognized -> implicit `show`
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
  // Rejects: a refineSub that doesn't fail closed on an expansion/substitution.
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
  // Rejects: a hand-copied list that silently drifts from the doc.
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

  // Review round 1 (dev-lead): a runtime guard, not just a comment. Parses
  // `git reflog -h`'s usage lines AT RUNTIME and asserts the verb set it
  // reports is exactly the set GIT_SUB_WRITE_ARGS.reflog (duplicated below,
  // same as this file's `allows()` helper duplicates PolicyEngine's caller)
  // plus the read defaults (show/list/exists) expects. This test runs inside
  // vitest as a child process's own `execSync` call — the policy classifier
  // never sees it (only interactive role Bash goes through canUseTool), so it
  // needs no policy exception. If git ever adds/renames a reflog verb, this
  // fails LOUDLY instead of silently reopening the #299 hole.
  // Rejects: a pinned git version drifting ahead of this policy's verb list
  // with nobody noticing until it's exploited.
  it("runtime guard: git reflog's actual verb set (parsed from `git reflog -h`) matches what this policy's read/write split knows about", () => {
    // Mirrors GIT_SUB_WRITE_ARGS.reflog in policy-git.ts — if that changes,
    // change this too (and re-run this test to prove the new set is still
    // exhaustive against the installed git).
    const KNOWN_WRITE_VERBS = new Set(['expire', 'delete', 'drop', 'write']);
    const KNOWN_READ_VERBS = new Set(['show', 'list', 'exists']);

    let helpText: string;
    try {
      execSync('git reflog -h', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      throw new Error('expected `git reflog -h` to exit non-zero (usage output on stderr)');
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message: string };
      helpText = e.stderr || e.stdout || '';
    }

    // Each usage line has the shape "usage: git reflog [show] ..." or
    // "   or: git reflog list ..." — the token right after "git reflog " is
    // the verb, optionally wrapped in "[...]" when it's the default (show).
    const verbLines = helpText
      .split('\n')
      .map((l) => /^\s*(?:usage:|or:)\s*git reflog\s+(\S+)/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1].replace(/^\[|\]$/g, ''));

    expect(verbLines.length, `could not parse any verb out of:\n${helpText}`).toBeGreaterThan(0);
    for (const verb of verbLines) {
      const known = KNOWN_WRITE_VERBS.has(verb) || KNOWN_READ_VERBS.has(verb);
      expect(
        known,
        `git reflog -h reports verb "${verb}", which is not in this policy's known read/write split ` +
          `(read: ${[...KNOWN_READ_VERBS].join(',')}; write: ${[...KNOWN_WRITE_VERBS].join(',')}) — ` +
          `re-audit GIT_SUB_WRITE_ARGS.reflog in policy-git.ts against \`man git-reflog\` for this git version`,
      ).toBe(true);
    }
    // And every verb this policy treats as a write must still be a real verb
    // — catches a verb git *removed*, which would make the pattern stale in
    // the harmless direction, but is still worth knowing about.
    for (const verb of KNOWN_WRITE_VERBS) {
      expect(verbLines, `policy treats "${verb}" as a write verb but git reflog -h no longer lists it`).toContain(
        verb,
      );
    }
  });
});
