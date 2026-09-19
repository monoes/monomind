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
 */
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
  'git stash list',
  'git stash show -p',
];

// Mutating commands that must stay denied at 'read' — several already passed
// before this fix; they are kept here as the guard against a sloppy widening.
// Split by WHERE they land at 'commit', since the ladder test below needs that.
const COMMIT_ALLOWED_ROWS: string[] = [
  'git cherry-pick abc',
  'git reflog expire --all',
  'git reflog delete HEAD@{0}',
  'git stash',
  'git stash push -m x',
  'git stash pop',
  'git stash drop',
  'git stash clear',
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
  it('"git stash list" is allowed at read, not merely denied with a different message', async () => {
    expect(await denyMessage('read', 'git stash list')).toBeNull();
  });

  // `stash pop` must still deny with the *mutating* message (not "unrecognized")
  // — it stays in GIT_COMMIT_CMDS for i-300 to move; refineSub must not touch it.
  it('"git stash pop" still denies with the mutating-commands message', async () => {
    const msg = await denyMessage('read', 'git stash pop');
    expect(msg).toMatch(/mutating commands require policy\.git: 'commit' or 'push'/);
  });

  it('`cherry` is safe to add only because the subcommand regex is anchored — `cherry-pick` cannot match it', async () => {
    // If GIT_READ_CMDS's anchoring were ever lost (e.g. someone swaps the
    // literal alternation for a `\b…\b` match), `cherry-pick` would spuriously
    // match the `cherry` alternative wherever it appears as a substring.
    expect(await allows('read', 'git cherry main')).toBe(true);
    expect(await allows('read', 'git cherry-pick abc')).toBe(false);
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

  // doc/concepts/org-runtime.md must name exactly these as read-allowed
  // subcommands (stash list/show, reflog minus expire/delete, plus the flat
  // adds) — every one of them must be a `true` row above.
  it('doc/concepts/org-runtime.md agrees with the classifier: every subcommand it calls read-allowed is a true row above', async () => {
    const docNamedReadAllowed = [
      'git ls-remote origin',
      'git stash list',
      'git stash show -p',
      'git reflog',
      'git reflog -5',
    ];
    for (const cmd of docNamedReadAllowed) {
      expect(await allows('read', cmd), cmd).toBe(true);
    }
    // And the doc must NOT claim these are read-allowed (they need push).
    expect(await allows('read', 'git fetch')).toBe(false);
    expect(await allows('read', 'git clone https://example.com/repo.git')).toBe(false);
  });
});
