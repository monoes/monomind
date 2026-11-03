#!/usr/bin/env node
/**
 * Lists the publishable packages whose declared version differs from the one
 * at the previous release tag, in publish order (siblings, CLI, umbrella).
 *
 *   node scripts/release-packages.mjs [--base <ref>] [--json]
 *
 * The base is the newest `v*` tag that is an ancestor of HEAD and does not
 * point at HEAD; --base overrides it. With no base the script fails rather
 * than guess, since "everything changed" would republish old versions.
 * Used by .github/workflows/release.yml; it does not touch the registry.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) =>
  execFileSync('git', a, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const CLI = '@monoes/monomindcli';
const UMBRELLA = 'monomind';

function manifestDirs() {
  const dirs = ['.'];
  const scopes = join(repoRoot, 'packages');
  for (const scope of readdirSync(scopes, { withFileTypes: true })) {
    if (!scope.isDirectory()) continue;
    const scopeDir = join('packages', scope.name);
    if (existsSync(join(repoRoot, scopeDir, 'package.json'))) dirs.push(scopeDir);
    else
      for (const e of readdirSync(join(repoRoot, scopeDir), { withFileTypes: true }))
        if (e.isDirectory()) dirs.push(join(scopeDir, e.name));
  }
  return dirs;
}

export function previousTag() {
  const head = git('rev-parse', 'HEAD');
  const tags = git('tag', '--merged', 'HEAD', '--sort=-v:refname', '--list', 'v[0-9]*').split('\n').filter(Boolean);
  return tags.find((t) => git('rev-parse', `${t}^{commit}`) !== head) ?? null;
}

const rank = (p) => (p.name === UMBRELLA ? 2 : p.name === CLI ? 1 : 0);

export function changedPackages(base) {
  const out = [];
  for (const dir of manifestDirs()) {
    const file = join(repoRoot, dir, 'package.json');
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (pkg.private || !pkg.name || !pkg.version) continue;
    let before = null;
    try {
      before = JSON.parse(git('show', `${base}:${dir === '.' ? '' : `${dir}/`}package.json`)).version;
    } catch {
      /* new package: absent at base */
    }
    if (before !== pkg.version) out.push({ name: pkg.name, dir, version: pkg.version, previous: before });
  }
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function main() {
  const i = process.argv.indexOf('--base');
  const base = i > -1 ? process.argv[i + 1] : previousTag();
  if (!base) {
    console.error('✗ no previous v* release tag is reachable (shallow clone, or the first tagged release). Pass --base <ref>.');
    process.exit(1);
  }
  const pkgs = changedPackages(base);
  if (process.argv.includes('--json')) console.log(JSON.stringify(pkgs));
  else {
    console.log(`packages changed since ${base}:`);
    for (const p of pkgs) console.log(`  ${p.name}  ${p.previous ?? '(new)'} -> ${p.version}  [${p.dir}]`);
    if (!pkgs.length) console.log('  (none)');
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
