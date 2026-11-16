#!/usr/bin/env node
/**
 * Publish guard: every workspace dependency of a package being released must
 * already be on npm, or be released in the same run.
 *
 *   node scripts/check-release-deps.mjs [--base <ref>]
 *
 * The release set is what scripts/release-packages.mjs reports: packages whose
 * version differs from the previous release tag. For each of them, every
 * `workspace:` dependency resolves (at pack time) to the version that sibling
 * declares. That version must exist on npm or be in the release set.
 *
 * Why (#780): @monoes/hooks and @monoes/routing were bumped to 2.24.2 on main
 * but never published (npm had 2.24.0). They were not in the 2.29.3 release
 * set, so nothing published them, and the CLI's prepublishOnly pin check
 * waited ~8 minutes for versions that were never coming. This fails fast with
 * the dependency named instead.
 *
 * Skipped when no release tag is reachable. MONOMIND_ALLOW_UNPUBLISHED_PINS=1
 * skips it, matching check-published-pins.mjs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPackages, previousTag } from './release-packages.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEP_KEYS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

/** Every non-private workspace manifest: name, version, workspace: deps. */
export function loadWorkspace(root = repoRoot) {
  const out = new Map();
  const add = (dir) => {
    const file = join(dir, 'package.json');
    if (!existsSync(file)) return;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (pkg.private || !pkg.name || !pkg.version) return;
    const deps = DEP_KEYS.flatMap((k) => Object.entries(pkg[k] ?? {}))
      .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('workspace:'))
      .map(([name]) => name);
    out.set(pkg.name, { name: pkg.name, version: pkg.version, deps });
  };
  add(root);
  const scopes = join(root, 'packages');
  for (const scope of readdirSync(scopes, { withFileTypes: true })) {
    if (!scope.isDirectory()) continue;
    const scopeDir = join(scopes, scope.name);
    if (existsSync(join(scopeDir, 'package.json'))) add(scopeDir);
    else
      for (const e of readdirSync(scopeDir, { withFileTypes: true }))
        if (e.isDirectory()) add(join(scopeDir, e.name));
  }
  return out;
}

/**
 * Pure check. `workspace` is a Map name -> {name, version, deps},
 * `releaseSet` a list of {name, version}, `isOnNpm(name, version)` the
 * (injectable) registry lookup. Returns one problem per unreleasable dep.
 */
export function findUnpublishedDeps({ workspace, releaseSet, isOnNpm }) {
  const released = new Set(releaseSet.map((p) => `${p.name}@${p.version}`));
  const problems = [];
  for (const rel of releaseSet) {
    const pkg = workspace.get(rel.name);
    for (const depName of pkg?.deps ?? []) {
      const dep = workspace.get(depName);
      if (!dep) continue; // unresolvable names are check-published-pins' job
      if (released.has(`${dep.name}@${dep.version}`) || isOnNpm(dep.name, dep.version)) continue;
      problems.push({ pkg: rel.name, dep: dep.name, version: dep.version });
    }
  }
  return problems;
}

/** Whether name@version is on npm; throws if the registry is unreachable. */
function npmHas(name, version) {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim() === version;
  } catch (err) {
    const text = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (text.includes('E404') || text.includes('404')) return false;
    throw new Error(`could not reach the npm registry for ${name}@${version}`);
  }
}

function main() {
  if (process.env.MONOMIND_ALLOW_UNPUBLISHED_PINS === '1') {
    console.log('✓ release-deps check skipped (MONOMIND_ALLOW_UNPUBLISHED_PINS=1)');
    return;
  }
  const i = process.argv.indexOf('--base');
  const base = i > -1 ? process.argv[i + 1] : previousTag();
  if (!base) {
    console.log('✓ release-deps check skipped — no previous v* release tag is reachable');
    return;
  }
  const releaseSet = changedPackages(base);
  const problems = findUnpublishedDeps({
    workspace: loadWorkspace(),
    releaseSet,
    isOnNpm: npmHas,
  });
  if (problems.length) {
    console.error(
      '\n✗ publish blocked: workspace dependencies are neither on npm nor in this release\n',
    );
    for (const p of problems)
      console.error(
        `    ${p.pkg} depends on ${p.dep}@${p.version} — not on npm, not being released`,
      );
    console.error(
      '\n  Fix: publish those versions first, or bump the dependency so it is part of this release.\n',
    );
    process.exit(1);
  }
  console.log(`✓ release-deps check ok — ${releaseSet.length} package(s) in the release set`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`✗ release-deps check: ${err.message}`);
    process.exit(1);
  }
}
