#!/usr/bin/env node
/**
 * Activates the repo's .githooks/ directory as the git hooks path.
 *
 * Invoked by the root package.json `prepare` script on every `pnpm install` /
 * `npm install`, so hooks come back automatically after a fresh clone.
 *
 * Fails silently (exit 0) when run outside a git repo — e.g. when the package
 * is installed as a dependency in another project, where `git config` would
 * either error or point at the wrong repo.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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
} catch (err) {
  console.warn(`⚠ Could not set git hooks path: ${err.message}`);
  console.warn('  Run `git config core.hooksPath .githooks` manually to enable.');
  process.exit(0);
}
