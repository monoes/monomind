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
 *
 *   node scripts/check-release-deps.mjs --preflight
 *
 * The release org's PREFLIGHT, on the machine that runs the release (#789),
 * instead of the registry check: the Claude SDK version the CLI pins
 * (peerDependencies in packages/@monomind/cli/package.json) must be installed
 * in `$MONOMIND_HOME/deps` (default `~/.monomind/deps`), or agent trials and
 * drills fail late; and scripts/generate-claude-trees.mjs --probe must pass,
 * so a host that cannot run the tree generator is reported before BUILD.
 * Read-only; not run by the release workflow, whose runner has no deps cache.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
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

const SDK = '@anthropic-ai/claude-agent-sdk';

/** The SDK version the CLI pins. */
export function claudeSdkPin(root = repoRoot) {
  const cli = JSON.parse(readFileSync(join(root, 'packages/@monomind/cli/package.json'), 'utf8'));
  return cli.peerDependencies?.[SDK];
}

/**
 * Whether the deps cache holds a complete copy of the pinned SDK: the
 * package.json inside `<deps>/@anthropic-ai+claude-agent-sdk@<pin>/` must carry
 * the pin (a directory existing proves nothing, #592). Returns a problem
 * string, or null when it is installed.
 */
export function findClaudeSdkProblem({ pin, env = process.env, home = homedir() }) {
  const deps = join(env.MONOMIND_HOME || join(home, '.monomind'), 'deps');
  const prefix = `${SDK.replace('/', '+')}@`;
  const pj = join(deps, `${prefix}${pin}`, 'node_modules', SDK, 'package.json');
  try {
    if (JSON.parse(readFileSync(pj, 'utf8')).version === pin) return null;
  } catch {
    // missing or unreadable: reported below
  }
  let others = [];
  try {
    others = readdirSync(deps)
      .filter((e) => e.startsWith(prefix) && e !== `${prefix}${pin}`)
      .map((e) => e.slice(prefix.length));
  } catch {
    // no deps dir
  }
  return (
    `${SDK}@${pin} (the CLI's pin) is not installed in ${deps}` +
    (others.length ? ` (found only ${others.join(', ')})` : '') +
    '. Fix: run `monomind deps install` outside any org role.'
  );
}

function preflight() {
  const problems = [];
  const sdk = findClaudeSdkProblem({ pin: claudeSdkPin() });
  if (sdk) problems.push(sdk);
  const res = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'generate-claude-trees.mjs'), '--probe'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (res.status !== 0) {
    const why = `${res.stderr ?? ''}`.trim() || res.error?.message || `exit ${res.status}`;
    problems.push(`scripts/generate-claude-trees.mjs cannot run on this host: ${why}`);
  }
  if (problems.length) {
    console.error('\n✗ release preflight:\n');
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }
  console.log(`✓ release preflight ok — ${SDK}@${claudeSdkPin()} installed, tree generator runs`);
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
  if (process.argv.includes('--preflight')) return preflight();
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
