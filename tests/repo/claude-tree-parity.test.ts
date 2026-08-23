/**
 * Monorepo-wide guard: the root `.claude/` tree and the npm-shipped
 * `packages/@monomind/cli/.claude/` tree must not drift.
 *
 * WHY THIS EXISTS
 * ---------------
 * `packages/@monomind/cli/.claude/` is listed in that package's `files` array,
 * so it ships to every npm user. The repo root `.claude/` is what maintainers
 * actually run against. When a fix lands in one and not the other, users get
 * different behaviour from the people who wrote the fix — and nothing catches
 * it. Both trees ARE tracked by git (458 files under the package copy), so a
 * divergence does appear in `git diff` — but it is easy to miss, because a fix
 * applied to one tree looks complete on its own and nothing cross-checks the
 * other. That is what this guard is for.
 *
 * This has now drifted three times. The drift found when this guard was
 * written (2026-07-26):
 *
 *   .claude/helpers/handlers/route-handler.cjs  — root had the Second Brain
 *     relevance floor / injection limit made configurable via
 *     .monomind/second-brain.json; the shipped copy still had the hardcoded
 *     0.35 and no cap. npm users could not tune it and got unbounded
 *     injection.
 *   .claude/helpers/intelligence.cjs — root had the MAX_ENTRIES=200 cap on
 *     both the dedup path and the hub-entry push; the shipped copy had
 *     neither, so a long-lived session grew _entries without bound.
 *   .claude/agents/core/{coder,planner,reviewer,tester}.md — root had the
 *     "Code Navigation (monograph-first)" section; the shipped copies were
 *     from 2026-06-29 and told users to grep.
 *   .claude/agents/core/coordinator.md — root had the absorbed
 *     queen-coordinator content and the `hive-orchestration` capability; the
 *     shipped copy had neither.
 *
 * In every one of those the ROOT copy was the newer, correct one and the
 * shipped copy was stale — which is the expected direction, since maintainers
 * edit what they run.
 *
 * WHAT THIS DOES *NOT* ASSERT
 * ---------------------------
 * The two trees are deliberately NOT identical, and a naive "these dirs must
 * match" test would be wrong. `packages/@monomind/cli/scripts/
 * sync-claude-assets.sh` was hard-disabled in 2026-07 precisely because the
 * old root->package rsync had `--delete` semantics and would have wiped most
 * of the shipped assets: the package tree is a deliberate SUPERSET (121 agent
 * definitions vs the root's 31, 25 skill dirs vs 4, plus commands/ trees that
 * exist only there). The root also legitimately holds machine-local files the
 * package must never ship (settings.local.json, mcp.json, scheduled_tasks.lock,
 * worktrees/, workflows/) and root-only skills (monodoc, monoagent-image).
 *
 * So the guard asserts the two things that are actually invariant:
 *
 *   1. CONTENT PARITY. Any path present in BOTH trees must be byte-identical.
 *      This is the rule that catches "fix applied to one copy only" — the
 *      failure mode that has recurred — without caring about the superset.
 *
 *   2. HELPERS EXISTENCE PARITY. `.claude/helpers/**` is the live runtime
 *      hook tree (gates-handler, route-handler, session-restore-handler,
 *      router, intelligence...). These are executed CJS scripts, not docs, so
 *      a file existing in only one tree is a behavioural difference on its
 *      own, not a superset. Both trees must hold the same set of paths here.
 *
 * WHY helper-files-parity.test.ts DID NOT CATCH THIS
 * --------------------------------------------------
 * packages/@monomind/cli/src/__tests__/helper-files-parity.test.ts is a much
 * narrower guard with a confusingly similar name. It reads exactly ONE file
 * from each tree — helpers/handlers/session-restore-handler.cjs — and only
 * parses the `var helpersToCheck = [...]` array out of it, comparing that
 * array against FORCE_SYNC_HELPERS. It asserts nothing about file contents,
 * nothing about any other file, and nothing about which files exist. Both
 * copies of session-restore-handler.cjs happened to be identical throughout
 * this drift, so it stayed green while six other files diverged.
 *
 * It is intentionally left alone rather than extended: it guards a different
 * invariant (a hardcoded list mirroring a TS constant, which no tree-diff can
 * express) and it lives inside the CLI package where FORCE_SYNC_HELPERS is
 * importable. This test is the monorepo-wide tree diff, and belongs here in
 * tests/repo/ alongside the other cross-package guards.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_TREE = join(REPO_ROOT, '.claude');
const PKG_TREE = join(REPO_ROOT, 'packages', '@monomind', 'cli', '.claude');

/**
 * Paths (relative to each tree) that are machine-local or generated and must
 * never be compared. Matched as exact names at any depth.
 */
const IGNORED_NAMES = new Set([
  '.DS_Store',
  'settings.local.json',
  'scheduled_tasks.lock',
  'skill-registry.json', // regenerated per-machine by build-skill-registry.cjs
]);

/** Directories that hold per-machine state, never shipped, never compared. */
const IGNORED_DIRS = new Set(['worktrees', 'checkpoints', 'node_modules', '.git']);

function isIgnored(name: string): boolean {
  // macOS/exFAT AppleDouble resource forks — pure filesystem noise. This repo
  // lives on an exFAT volume, so they reappear constantly.
  if (name.startsWith('._')) return true;
  return IGNORED_NAMES.has(name) || IGNORED_DIRS.has(name);
}

/** Relative paths of every non-ignored regular file under `dir`. */
function collectFiles(dir: string, base = dir, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (isIgnored(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // broken symlink
    }
    if (st.isDirectory()) collectFiles(full, base, out);
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

describe('.claude tree parity (root vs npm-shipped CLI copy)', () => {
  it('both trees exist — the guard cannot silently no-op', () => {
    // Without this, a moved/renamed tree would make every assertion below pass
    // vacuously over an empty file list.
    expect(existsSync(ROOT_TREE), `${ROOT_TREE} is missing`).toBe(true);
    expect(existsSync(PKG_TREE), `${PKG_TREE} is missing`).toBe(true);
  });

  it('both trees contain a non-trivial number of files — no empty-fixture pass', () => {
    expect(collectFiles(ROOT_TREE).length).toBeGreaterThan(50);
    expect(collectFiles(PKG_TREE).length).toBeGreaterThan(50);
  });

  it('every file present in BOTH trees is byte-identical', () => {
    const rootFiles = new Set(collectFiles(ROOT_TREE));
    const pkgFiles = collectFiles(PKG_TREE);

    const shared = pkgFiles.filter((rel) => rootFiles.has(rel));

    // Sanity: the overlap must be substantial, otherwise this assertion is
    // comparing almost nothing and would pass no matter how bad the drift.
    expect(
      shared.length,
      'Almost nothing overlaps between the two .claude trees — the path ' +
        'layout must have changed, and this guard is no longer comparing ' +
        'anything meaningful. Fix the guard, do not delete it.',
    ).toBeGreaterThan(50);

    const diverged: string[] = [];
    for (const rel of shared) {
      const a = readFileSync(join(ROOT_TREE, rel));
      const b = readFileSync(join(PKG_TREE, rel));
      if (!a.equals(b)) diverged.push(rel);
    }

    expect(
      diverged.sort(),
      'The root .claude/ tree and the npm-shipped packages/@monomind/cli/' +
        '.claude/ tree have diverged. npm users are running different code ' +
        'from maintainers.\n\n' +
        'Both trees ARE tracked by git (458 files under the package copy at ' +
        'the time of writing), so a divergence does show up in `git diff` — ' +
        'it is just easy to miss, because a fix applied to one tree looks ' +
        'complete on its own. That is what this guard is for.\n\n' +
        'Diverging paths (relative to each .claude root):\n' +
        diverged.map((p) => `  - ${p}`).join('\n') +
        '\n\nInspect each one and copy the CORRECT side over the other — ' +
        'historically root has been the newer/correct copy, but check ' +
        'before copying. Do NOT run sync-claude-assets.sh; it is disabled ' +
        'because its rm -rf semantics would wipe the shipped superset.',
    ).toEqual([]);
  });

  it('the helpers/ runtime hook tree holds the same set of files in both copies', () => {
    // Unlike agents/skills/commands (where the package tree is a deliberate
    // superset), helpers/ is executed code. A helper present in only one tree
    // is a behavioural difference by itself.
    const rootHelpers = collectFiles(join(ROOT_TREE, 'helpers')).sort();
    const pkgHelpers = collectFiles(join(PKG_TREE, 'helpers')).sort();

    expect(rootHelpers.length, 'root .claude/helpers is empty or missing').toBeGreaterThan(10);

    // pre-commit / post-commit are generate-only scaffold (HELPER_FILES entries
    // with no `forceSync`): they are produced by `monomind init` into the user's
    // project, not shipped as static assets. The root tree has them only because
    // init ran there; the package tree correctly lacks them. Excluding them keeps
    // this guard focused on forceSync/static helpers (the executed code that must
    // ship identically), not on init-generated scaffold.
    const GENERATED_SCAFFOLD = new Set(['pre-commit', 'post-commit']);
    const isShipped = (f: string) => !GENERATED_SCAFFOLD.has(f);

    const onlyRoot = rootHelpers.filter((f) => isShipped(f) && !pkgHelpers.includes(f));
    const onlyPkg = pkgHelpers.filter((f) => isShipped(f) && !rootHelpers.includes(f));

    expect(
      { onlyInRoot: onlyRoot, onlyInShippedPackage: onlyPkg },
      'The .claude/helpers/ runtime hook trees hold different files. These ' +
        'are live CJS scripts run by Claude Code hooks, so a missing file is ' +
        'a missing behaviour for whichever side lacks it.',
    ).toEqual({ onlyInRoot: [], onlyInShippedPackage: [] });
  });

  it('#127: the skills/ trees hold the same SET of skill directories, modulo the known intentional exceptions', () => {
    // Byte-parity for any skill dir present in both trees is already covered
    // by the "every file present in BOTH trees is byte-identical" block
    // above — this only needs to catch a skill quietly added to one tree
    // and not the other (the actual #127 finding: two real, independently
    // maintained directory trees had already drifted apart in *membership*,
    // and a session's skill listing showed both the bare and package-
    // prefixed name for anything present in both, roughly doubling the
    // apparent skill count).
    const listSkillDirs = (skillsRoot: string): string[] => {
      let entries: string[];
      try {
        entries = readdirSync(skillsRoot);
      } catch {
        return [];
      }
      return entries
        .filter((name) => !isIgnored(name))
        .filter((name) => {
          const full = join(skillsRoot, name);
          try {
            return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md'));
          } catch {
            return false;
          }
        })
        .sort();
    };

    const rootSkills = listSkillDirs(join(ROOT_TREE, 'skills'));
    const pkgSkills = listSkillDirs(join(PKG_TREE, 'skills'));

    expect(rootSkills.length, 'root .claude/skills is empty or missing').toBeGreaterThan(20);
    expect(pkgSkills.length, 'packaged .claude/skills is empty or missing').toBeGreaterThan(20);

    // Deliberate, known exceptions — update this list (with a reason) if a
    // skill is intentionally added to only one tree; do not widen it to
    // silence an accidental new drift.
    const ROOT_ONLY_ALLOWED = new Set(['monoagent-image', 'monodoc']);
    const PKG_ONLY_ALLOWED = new Set([
      'github-issue-triage',
      'github-repo-recap',
      'github-toolkit',
      'memory-toolkit',
      'stop-slop',
    ]);

    const onlyRoot = rootSkills.filter((s) => !pkgSkills.includes(s));
    const onlyPkg = pkgSkills.filter((s) => !rootSkills.includes(s));

    const unexpectedOnlyRoot = onlyRoot.filter((s) => !ROOT_ONLY_ALLOWED.has(s));
    const unexpectedOnlyPkg = onlyPkg.filter((s) => !PKG_ONLY_ALLOWED.has(s));

    expect(
      {
        unexpectedOnlyInRoot: unexpectedOnlyRoot,
        unexpectedOnlyInShippedPackage: unexpectedOnlyPkg,
      },
      'The two .claude/skills/ trees hold a different SET of skill directories ' +
        'beyond the known/allowed exceptions. Either mirror the new skill into ' +
        'the other tree, or add it to ROOT_ONLY_ALLOWED/PKG_ONLY_ALLOWED here ' +
        'with a reason if the asymmetry is intentional.',
    ).toEqual({ unexpectedOnlyInRoot: [], unexpectedOnlyInShippedPackage: [] });

    // Also assert the allow-lists themselves aren't stale (a skill that used
    // to be root/package-only but is now mirrored, or was removed).
    expect(
      [...ROOT_ONLY_ALLOWED].filter((s) => !onlyRoot.includes(s)),
      'ROOT_ONLY_ALLOWED lists a skill that is no longer root-only (mirrored or removed) — shrink the allow-list.',
    ).toEqual([]);
    expect(
      [...PKG_ONLY_ALLOWED].filter((s) => !onlyPkg.includes(s)),
      'PKG_ONLY_ALLOWED lists a skill that is no longer package-only (mirrored or removed) — shrink the allow-list.',
    ).toEqual([]);
  });
});
