#!/usr/bin/env node
/**
 * Activates the repo's .githooks/ directory as the git hooks path.
 *
 * Invoked by the root package.json `prepare` script on every `pnpm install` /
 * `npm install`, so hooks come back automatically after a fresh clone.
 *
 * Also registers the `monomind-changelog` merge driver that .gitattributes
 * assigns to CHANGELOG.md (same config as `pnpm run setup:merge-drivers`),
 * idempotently, so a fresh clone resolves release/Unreleased conflicts itself.
 *
 * Fails silently (exit 0) when run outside a git repo — e.g. when the package
 * is installed as a dependency in another project, where `git config` would
 * either error or point at the wrong repo.
 */
import { execFileSync, execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function isGitRepo() {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      stdio: 'ignore',
      cwd: repoRoot,
    });
    return true;
  } catch {
    return false;
  }
}

export const CHANGELOG_DRIVER = {
  name: 'monomind CHANGELOG.md: keep released sections, move new entries to Unreleased',
  driver: 'node scripts/merge-changelog.mjs %O %A %B',
};

/** Sets merge.monomind-changelog.{name,driver}; returns the keys it changed. */
export function registerChangelogMergeDriver(cwd) {
  const changed = [];
  for (const [key, want] of Object.entries(CHANGELOG_DRIVER)) {
    const full = `merge.monomind-changelog.${key}`;
    let have = '';
    try {
      have = execFileSync('git', ['config', '--get', full], { cwd, encoding: 'utf8' }).trim();
    } catch {
      // unset
    }
    if (have !== want) {
      execFileSync('git', ['config', full, want], { cwd });
      changed.push(key);
    }
  }
  return changed;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (!isGitRepo()) {
    // Dependency install in a foreign package — nothing to do.
    process.exit(0);
  }

  try {
    // Relative path so it survives directory renames; git resolves it against
    // the worktree root.
    execSync('git config core.hooksPath .githooks', {
      stdio: 'inherit',
      cwd: repoRoot,
    });
    console.log('✓ git hooks path set to .githooks/ (pre-commit secret scan active)');
    if (registerChangelogMergeDriver(repoRoot).length) {
      console.log('✓ CHANGELOG.md merge driver registered (monomind-changelog)');
    }
  } catch (err) {
    console.warn(`⚠ Could not set git hooks path: ${err.message}`);
    console.warn('  Run `git config core.hooksPath .githooks` manually to enable.');
    process.exit(0);
  }
}
