#!/usr/bin/env node
/**
 * Packs a package and every workspace sibling it depends on, transitively,
 * and prints the tarball paths one per line.
 *
 * ## Why
 *
 * `pnpm pack` rewrites each `workspace:*` dependency to the version that
 * package currently declares — which is routinely ahead of npm, because
 * versions are bumped in the repo before the release is published. Installing
 * such a tarball with npm then resolves those siblings from the registry and
 * fails with ETARGET on a version that does not exist yet.
 *
 * The publish smoke test already worked around this for exactly one edge
 * (`monomind` -> `@monoes/monomindcli`) by packing that sibling too and
 * installing both together, which lets npm satisfy the dependency locally.
 * That left every deeper edge broken: bumping `@monoes/monograph` for a fix,
 * without publishing it first, failed all four smoke jobs with
 * "No matching version found for @monoes/monograph@1.6.5" even though the
 * code was fine.
 *
 * Walking the whole closure fixes the general case: whatever the workspace
 * graph looks like, the smoke test installs this checkout's own build of
 * every sibling instead of whatever the registry happens to hold.
 *
 * Usage: node scripts/pack-workspace-closure.mjs <package-dir> [outDir]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(process.argv[2] ?? '.');
const outDir = process.argv[3] ?? mkdtempSync(join(tmpdir(), 'monomind-pack-'));

/** name -> directory, for every package in the workspace. */
function workspacePackages() {
  const byName = new Map();
  const add = (dir) => {
    const file = join(dir, 'package.json');
    if (!existsSync(file)) return;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (pkg.name) byName.set(pkg.name, { dir, pkg });
  };
  add(repoRoot);
  const scopes = join(repoRoot, 'packages');
  for (const scope of readdirSync(scopes, { withFileTypes: true })) {
    if (!scope.isDirectory()) continue;
    const scopeDir = join(scopes, scope.name);
    add(scopeDir);
    for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
      if (entry.isDirectory()) add(join(scopeDir, entry.name));
    }
  }
  return byName;
}

const packages = workspacePackages();
const byDir = new Map([...packages.values()].map((p) => [p.dir, p]));

/** Every workspace package the target needs, itself included, deepest first
 *  so a dependency is always packed before whatever depends on it. */
function closureOf(dir) {
  const order = [];
  const seen = new Set();
  const visit = (d) => {
    if (seen.has(d)) return;
    seen.add(d);
    const entry = byDir.get(d);
    if (!entry) return;
    const deps = { ...entry.pkg.dependencies, ...entry.pkg.optionalDependencies };
    for (const name of Object.keys(deps)) {
      const sibling = packages.get(name);
      if (sibling) visit(sibling.dir);
    }
    order.push(d);
  };
  visit(dir);
  return order;
}

const tarballs = [];
for (const dir of closureOf(target)) {
  const json = execFileSync('pnpm', ['pack', '--pack-destination', outDir, '--json'], {
    cwd: dir,
    encoding: 'utf8',
  });
  // A package's own prepare/prepack script may print its own banner ahead of
  // the JSON, so parse from the first '{' rather than the first byte.
  const parsed = JSON.parse(json.slice(json.indexOf('{')));
  tarballs.push(join(outDir, parsed.filename.split('/').pop()));
}

for (const t of tarballs) console.log(t);
