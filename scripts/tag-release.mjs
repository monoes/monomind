#!/usr/bin/env node
/**
 * Prints (never runs) the commands that tag a release.
 *
 *   node scripts/tag-release.mjs
 *
 * The tag is v<umbrella version>. Refuses (exit 1) when the working tree is
 * dirty, the tag already exists, or `scripts/check-versions.mjs` fails.
 * Pushing the tag triggers .github/workflows/release.yml.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => execFileSync('git', a, { cwd: repoRoot, encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const { version } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const tag = `v${version}`;

if (git('status', '--porcelain')) fail('working tree is dirty; commit or stash first');
if (git('tag', '--list', tag)) fail(`tag ${tag} already exists`);

const checks = spawnSync(
  process.execPath,
  [join(repoRoot, 'scripts', 'check-versions.mjs'), '--no-registry'],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
);
if (checks.status !== 0) fail('version checks failed; fix them before tagging');

console.log(`\nTag ${git('rev-parse', '--short', 'HEAD')} as ${tag}. Run these yourself:\n`);
console.log(`  git tag -a ${tag} -m "monomind ${version}"`);
console.log(`  git push origin ${tag}`);
