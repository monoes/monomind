#!/usr/bin/env node
/**
 * Publish guard: a workspace package whose shipped source changed since its
 * version was last set must be bumped, or the change never reaches anyone.
 *
 * ## The failure this pins
 *
 * The 2.11.4 release shipped a monograph fix that users could not get. The fix
 * was merged, tagged, and present in `packages/@monomind/monograph`, but that
 * package's version stayed at 1.6.4 — the version already on npm from five
 * days earlier. Only the CLI and the umbrella were bumped and published.
 *
 * Nothing looked wrong: CI was green, the tag contained the commit, and
 * `npm view monomind version` reported the new release. But every sibling
 * package is pinned as `workspace:*`, which pnpm rewrites at pack time to the
 * version that package currently declares. A package whose version did not
 * change therefore resolves to the tarball already on npm, and the published
 * CLI silently depends on the OLD build. The installed tree had no trace of
 * the fix, and the bug it fixed reproduced exactly as before the release.
 *
 * ## What counts as "shipped source"
 *
 * Anything under the package that is not a test or a markdown file. Tests do
 * not reach a consumer, and a doc-only change does not need a release. Both
 * exclusions are deliberately narrow: if a change touches shipped code at all,
 * it needs a version.
 *
 * ## Escape hatch
 *
 * MONOMIND_ALLOW_STALE_PACKAGES=1 skips the check, for the case where a
 * package genuinely has no consumer-visible change (a comment, a rename in a
 * file that does not ship). Prefer bumping: a patch release costs nothing and
 * a missed one costs a whole release cycle, as it did here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Every non-private package under packages/, found rather than listed, so a
 *  new package is covered the day it is added. The umbrella at the repo root
 *  is left to check-publish-versions.mjs, which owns the release version. */
function publishablePackages() {
  const out = [];
  const scopes = join(repoRoot, 'packages');
  for (const scope of readdirSync(scopes, { withFileTypes: true })) {
    if (!scope.isDirectory()) continue;
    const scopeDir = join(scopes, scope.name);
    const manifest = join(scopeDir, 'package.json');
    // packages/<name>/ as well as packages/<scope>/<name>/
    const candidates = existsSync(manifest)
      ? [scopeDir]
      : readdirSync(scopeDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => join(scopeDir, e.name));
    for (const dir of candidates) {
      const file = join(dir, 'package.json');
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      if (pkg.private || !pkg.name || !pkg.version) continue;
      out.push({ ...pkg, dir: dir.slice(repoRoot.length + 1) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The commit that introduced the version this package currently declares. */
function commitThatSetVersion(dir, version) {
  const needle = `"version": "${version}"`;
  const out = git('log', '-1', '--format=%H', `-S${needle}`, '--', `${dir}/package.json`).trim();
  return out || null;
}

/** Manifest keys a consumer actually resolves. A commit that only reorders
 *  scripts, drops a dead overrides block or edits devDependencies changes the
 *  tarball but nothing anyone installs, and flagging those would train people
 *  to reach for the escape hatch. */
const CONSUMER_KEYS = [
  'name',
  'version',
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'optionalDependencies',
  'bin',
  'main',
  'module',
  'types',
  'exports',
  'files',
  'engines',
  'os',
  'cpu',
];

/** Did this commit change the package manifest in a way a consumer sees? */
function manifestMattersIn(sha, dir) {
  const at = (rev) => {
    try {
      return JSON.parse(git('show', `${rev}:${dir}/package.json`));
    } catch {
      return null; // added or removed in this commit — treat as material
    }
  };
  const before = at(`${sha}^`);
  const after = at(sha);
  if (!before || !after) return true;
  return CONSUMER_KEYS.some(
    (k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null),
  );
}

/** Shipped-source commits after `since`, newest first. */
function shippedChangesSince(dir, since) {
  const out = git(
    'log',
    '--format=%h %s',
    `${since}..HEAD`,
    '--',
    dir,
    `:(exclude)${dir}/**/__tests__/**`,
    `:(exclude)${dir}/**/*.test.ts`,
    `:(exclude)${dir}/**/*.test.mjs`,
    `:(exclude)${dir}/**/*.md`,
    `:(exclude)${dir}/__tests__/**`,
  ).trim();
  const commits = out ? out.split('\n') : [];
  return commits.filter((line) => {
    const sha = line.split(' ', 1)[0];
    const files = git('show', '--format=', '--name-only', sha, '--', dir)
      .trim()
      .split('\n')
      .filter(Boolean);
    const onlyManifest = files.every((f) => f === `${dir}/package.json`);
    return !onlyManifest || manifestMattersIn(sha, dir);
  });
}

if (process.env.MONOMIND_ALLOW_STALE_PACKAGES === '1') {
  console.log('✓ package bump check skipped (MONOMIND_ALLOW_STALE_PACKAGES=1)');
  process.exit(0);
}

const stale = [];
for (const pkg of publishablePackages()) {
  const since = commitThatSetVersion(pkg.dir, pkg.version);
  if (!since) continue; // version never committed (new package, or a shallow clone)
  const changes = shippedChangesSince(pkg.dir, since);
  if (changes.length) stale.push({ pkg, changes });
}

if (stale.length) {
  console.error('\n✗ publish blocked: shipped code changed without a version bump\n');
  for (const { pkg, changes } of stale) {
    console.error(`    ${pkg.name} is still ${pkg.version}, which is already on npm, but has`);
    console.error(`    ${changes.length} commit(s) to shipped files since that version was set:`);
    for (const line of changes.slice(0, 5)) console.error(`        ${line}`);
    if (changes.length > 5) console.error(`        … and ${changes.length - 5} more`);
    console.error('');
  }
  console.error(
    '  Every sibling is pinned as workspace:*, which pnpm resolves at pack time to the\n' +
      '  version the package declares. Leaving it unchanged publishes a CLI that depends on\n' +
      '  the tarball already on npm, so the change reaches nobody and nothing looks wrong.\n\n' +
      '  Fix: bump the version of each package listed above, then publish it before the CLI.\n' +
      '  If a change genuinely ships nothing, set MONOMIND_ALLOW_STALE_PACKAGES=1.\n',
  );
  process.exit(1);
}

console.log(
  '✓ package bump check ok — every publishable package is newer than its shipped changes',
);
