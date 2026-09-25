#!/usr/bin/env node

/**
 * Keep the five copies of the `.claude` asset tree in agreement.
 *
 * WHY THIS EXISTS
 * ---------------
 * The root `.claude/` tree is the copy this repo edits and uses. Four other
 * trees hold copies of (parts of) it: the npm-shipped
 * `packages/@monomind/cli/.claude`, and the `.agents/skills`, `.gemini/skills`
 * and `.kimi-code/skills` platform trees. `scripts/lint-skills.mjs` and
 * `tests/repo/claude-tree-parity.test.ts` require them to agree, so a
 * hand-edit of the root copy has to reach the others.
 *
 * Older `monomind init --force` runs also wrapped the Mastermind skills in
 * `skills:<platform>:<name>` ownership markers, and this script stripped them
 * again. init no longer writes those markers (GH #344: ownership lives in
 * `.monomind/init-manifest.json`), so the trees are compared as they are, and
 * `tests/repo/no-skill-ownership-markers.test.ts` keeps markers out of them.
 *
 * WHY THIS DOES NOT DELETE OR CREATE
 * ----------------------------------
 * `packages/@monomind/cli/.claude/skills` is not a mirror of the root tree: it
 * is the asset SOURCE init copies from (`findSourceDir()` in
 * `src/init/shared.ts`), and a deliberate SUPERSET of it.
 *
 * THE RULE
 * --------
 *   1. The canonical content of a file is the repo-root `.claude/` copy.
 *   2. For every path present in BOTH the root tree and a given mirror tree,
 *      a mirror copy whose bytes differ is rewritten to it.
 *   3. A path that exists on only one side is NEVER created and NEVER deleted.
 *      This is load-bearing: the shipped package tree is a deliberate SUPERSET
 *      (121 agent definitions vs the root's 31, extra skills, whole
 *      `commands/` trees), and the root holds machine-local files that must
 *      never ship (`settings.local.json`, `mcp.json`, `worktrees/`). Its
 *      predecessor `sync-claude-assets.sh` had `rsync --delete` semantics,
 *      had to be hard-disabled in 2026-07 for exactly that reason, and is now
 *      deleted. The one exception is a mirror marked `copyMissing`
 *      (`.gemini/helpers`, a full install copy of `.claude/helpers`): a file
 *      missing from it is created. Nothing is ever deleted from any mirror.
 *
 * WHEN TO RUN IT
 * --------------
 * After hand-editing the root `.claude/` tree, before committing:
 *
 *     pnpm run sync:claude-trees          # write
 *     pnpm run sync:claude-trees:check    # report only, exit 1 on divergence
 *
 * The check mode runs in `pnpm run verify` and in CI alongside the other
 * cross-tree guards. The sync is idempotent: running it twice in a row writes
 * nothing.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Exact names skipped at any depth: machine-local or regenerated per machine. */
const IGNORED_NAMES = new Set([
  '.DS_Store',
  'settings.local.json',
  'scheduled_tasks.lock',
  'skill-registry.json',
]);

/** Directory names skipped at any depth: per-machine state, never mirrored. */
const IGNORED_DIRS = new Set(['worktrees', 'checkpoints', 'node_modules', '.git']);

/**
 * Every tree that must agree with the root `.claude/` tree, and the part of the
 * source it holds. `packages/@monomind/cli/.claude` covers the whole tree
 * (helpers, agents, commands, skills); the three platform trees hold skills.
 */
const MIRRORS = [
  { source: '.claude', mirror: 'packages/@monomind/cli/.claude' },
  { source: '.claude/skills', mirror: '.agents/skills' },
  { source: '.claude/skills', mirror: '.gemini/skills' },
  { source: '.claude/skills', mirror: '.kimi-code/skills' },
  // init copies the whole helper tree into `.gemini/helpers` too (writeHelpers
  // in src/init/write-claude.ts), so this copy is a full mirror: files missing
  // from it are created as well. Its own extras (statusline.sh) are kept.
  // pre-commit/post-commit are this repo's git hooks, not shipped helpers.
  {
    source: '.claude/helpers',
    mirror: '.gemini/helpers',
    copyMissing: true,
    exceptions: ['pre-commit', 'post-commit'],
  },
];

function isIgnored(name) {
  // AppleDouble resource forks — this repo lives on an exFAT volume, so they
  // reappear constantly and are pure filesystem noise.
  if (name.startsWith('._')) return true;
  return IGNORED_NAMES.has(name) || IGNORED_DIRS.has(name);
}

/** Relative paths of every non-ignored regular file under `dir`. */
function collectFiles(dir, base = dir, out = []) {
  let entries;
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

/**
 * Compare one source/mirror pair on the intersection of their paths.
 * `diverged` lists mirror paths that do not hold the source content.
 */
export function comparePair({ root, source, mirror, exceptions = [], copyMissing = false }) {
  const sourceDir = join(root, source);
  const mirrorDir = join(root, mirror);
  const excluded = new Set(exceptions);

  const sourceFiles = new Set(collectFiles(sourceDir));
  const mirrorFiles = collectFiles(mirrorDir);
  const shared = mirrorFiles.filter((rel) => sourceFiles.has(rel));
  // Only a copyMissing mirror is expected to hold every source file.
  const inMirror = new Set(mirrorFiles);
  const missing = copyMissing
    ? [...sourceFiles].filter((rel) => !inMirror.has(rel) && !excluded.has(rel)).sort()
    : [];

  const diverged = [];
  for (const rel of shared) {
    if (excluded.has(rel)) continue;
    if (readFileSync(join(mirrorDir, rel), 'utf8') !== readFileSync(join(sourceDir, rel), 'utf8'))
      diverged.push(rel);
  }

  // An exception that is now identical on both sides is no longer an
  // exception — shrink the list rather than letting it hide a real drift.
  const staleExceptions = [...excluded].filter((rel) => {
    const a = join(sourceDir, rel);
    const b = join(mirrorDir, rel);
    if (!existsSync(a) || !existsSync(b)) return false;
    return readFileSync(a, 'utf8') === readFileSync(b, 'utf8');
  });

  return {
    source,
    mirror,
    shared: shared.length,
    diverged: diverged.sort(),
    missing,
    staleExceptions,
  };
}

/** Compare (and unless `check`, rewrite) every mirror pair. */
export function syncTrees({ root = REPO_ROOT, mirrors = MIRRORS, check = false } = {}) {
  const pairs = [];
  const written = [];
  const staleExceptions = [];

  for (const spec of mirrors) {
    const result = comparePair({ root, ...spec });
    pairs.push(result);
    for (const rel of result.staleExceptions) staleExceptions.push(`${spec.mirror}/${rel}`);
    if (check) continue;

    for (const rel of [...result.diverged, ...result.missing]) {
      const target = join(root, spec.mirror, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(join(root, spec.source, rel)));
      written.push(`${spec.mirror}/${rel}`);
    }
  }

  return { pairs, written, staleExceptions };
}

/**
 * THE KIMI TREES
 * --------------
 * `.kimi-code/agents/*.md`, `.kimi-code/plugin/commands/*.md` and every
 * `.kimi-code/skills/<dir>/SKILL.md` are not mirrors: they are the OUTPUT of
 * the kimi converters (`convertClaudeTreeToKimi` in
 * `packages/@monomind/cli/src/init/write-kimicode.ts`) run over the root
 * `.claude/{agents,commands,skills}` tree. So unlike the mirrors above they are
 * compared against the converter's output, a file the converter no longer
 * produces is stale, and regenerating removes it. Only `SKILL.md` files are
 * owned here — other files inside a skill directory are the mirror's business.
 *
 * The converter is loaded from the BUILT CLI (`pnpm -r run build`, or
 * `npm run build` in packages/@monomind/cli). A missing build is an error, not
 * a skip — a check that silently passes when it cannot run is no check.
 */
const KIMI_CONVERTER = 'packages/@monomind/cli/dist/src/init/write-kimicode.js';

/**
 * Kimi skill directories produced by something other than the converter:
 * `monodesign` is compiled by packages/@monoes/monodesign/scripts/sync-skill.mjs
 * and its root `.claude/skills/monodesign` source is gitignored, so it cannot
 * be derived from a clean checkout.
 */
const KIMI_EXCEPT_SKILLS = ['monodesign'];

export async function loadKimiConverter(root = REPO_ROOT) {
  const modPath = join(root, KIMI_CONVERTER);
  if (!existsSync(modPath)) {
    throw new Error(
      `${KIMI_CONVERTER} is missing — build the CLI first (pnpm -r run build). ` +
        'The kimi trees are compared against its converters.',
    );
  }
  const mod = await import(pathToFileURL(modPath).href);
  return (claudeDir) => mod.convertClaudeTreeToKimi(claudeDir);
}

function listDir(dir) {
  try {
    return readdirSync(dir).filter((name) => !isIgnored(name));
  } catch {
    return [];
  }
}

/**
 * Compare (and unless `check`, regenerate) the kimi trees. `convert` maps a
 * `.claude` directory to `{ agents, skills, pluginCommands }` maps.
 */
export function syncKimiTrees({
  root = REPO_ROOT,
  convert,
  check = false,
  exceptSkills = KIMI_EXCEPT_SKILLS,
}) {
  const expected = convert(join(root, '.claude'));
  const except = new Set(exceptSkills);
  const kimi = '.kimi-code';
  const wanted = new Map();
  for (const [file, content] of expected.agents) wanted.set(`${kimi}/agents/${file}`, content);
  for (const [dir, content] of expected.skills) {
    if (!except.has(dir)) wanted.set(`${kimi}/skills/${dir}/SKILL.md`, content);
  }
  for (const [file, content] of expected.pluginCommands) {
    wanted.set(`${kimi}/plugin/commands/${file}`, content);
  }

  const missing = [];
  const diverged = [];
  for (const [rel, content] of wanted) {
    const abs = join(root, rel);
    if (!existsSync(abs)) missing.push(rel);
    else if (readFileSync(abs, 'utf8') !== content) diverged.push(rel);
  }

  const stale = [];
  for (const file of listDir(join(root, kimi, 'agents'))) {
    if (file.endsWith('.md') && !expected.agents.has(file)) stale.push(`${kimi}/agents/${file}`);
  }
  for (const file of listDir(join(root, kimi, 'plugin', 'commands'))) {
    if (file.endsWith('.md') && !expected.pluginCommands.has(file)) {
      stale.push(`${kimi}/plugin/commands/${file}`);
    }
  }
  for (const dir of listDir(join(root, kimi, 'skills'))) {
    if (!except.has(dir) && !expected.skills.has(dir)) stale.push(`${kimi}/skills/${dir}`);
  }

  const written = [];
  if (!check) {
    for (const rel of [...missing, ...diverged]) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, wanted.get(rel));
      written.push(rel);
    }
    for (const rel of stale) {
      rmSync(join(root, rel), { recursive: true, force: true });
      written.push(`${rel} (removed)`);
    }
  }

  return { missing: missing.sort(), diverged: diverged.sort(), stale: stale.sort(), written };
}

/**
 * The root `.claude/skills/monodesign` copy is gitignored: it is compiled from
 * packages/@monoes/monodesign by that package's sync-skill.mjs. The tracked
 * `.agents` and `.gemini` copies mirror it, so without compiling it first the
 * comparison depended on whether this machine happened to have run
 * sync-skill.mjs (a clean checkout compared nothing, a stale local copy
 * "fixed" the mirrors backwards). Compile it before comparing; it writes only
 * gitignored output, so this is safe in --check mode too.
 */
const MONODESIGN = 'packages/@monoes/monodesign';
const MONODESIGN_INPUTS = ['skill', 'cli/engine', 'cli/lib', 'scripts/sync-skill.mjs'];
const MONODESIGN_OUTPUTS = [
  '.claude/skills/monodesign/SKILL.md',
  'packages/@monomind/cli/.claude/skills/monodesign/SKILL.md',
];

/** Content hash of everything sync-skill.mjs compiles from. */
function monodesignSourceHash(root) {
  const hash = createHash('sha256');
  for (const input of MONODESIGN_INPUTS) {
    const abs = join(root, MONODESIGN, input);
    const files = statSync(abs, { throwIfNoEntry: false })?.isDirectory()
      ? collectFiles(abs).map((rel) => join(abs, rel))
      : [abs];
    for (const file of files.sort()) {
      if (!existsSync(file)) continue;
      hash.update(file.slice(root.length)).update('\0').update(readFileSync(file)).update('\0');
    }
  }
  return hash.digest('hex');
}

/**
 * Compile the monodesign skill when its sources changed since the last
 * compile (or an output is missing). Skipping an up-to-date compile matters:
 * sync-skill.mjs deletes and rewrites its output directories, so running it on
 * every --check would race any concurrent reader of the trees (the repo tests
 * run in parallel). A lock serialises concurrent first compiles.
 */
export function compileGeneratedSkills(root = REPO_ROOT) {
  const script = join(root, MONODESIGN, 'scripts', 'sync-skill.mjs');
  if (!existsSync(script)) return;
  const cacheDir = join(root, 'node_modules', '.cache', 'sync-claude-trees');
  const stamp = join(cacheDir, 'monodesign.sha256');
  const lock = join(cacheDir, 'monodesign.lock');
  mkdirSync(cacheDir, { recursive: true });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST' || Date.now() > deadline) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  try {
    const current = monodesignSourceHash(root);
    const fresh =
      existsSync(stamp) &&
      readFileSync(stamp, 'utf8') === current &&
      MONODESIGN_OUTPUTS.every((rel) => existsSync(join(root, rel)));
    if (!fresh) {
      execFileSync('node', [script], { cwd: root, stdio: 'ignore' });
      writeFileSync(stamp, current);
    }
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(
      [
        'Usage: node scripts/sync-claude-trees.mjs [--check]',
        '',
        "Mirrors the repo's root .claude asset tree into the other four copies on",
        'the INTERSECTION of paths only. A file',
        'present in just one tree is never created and never deleted — the shipped',
        'package tree is a deliberate superset.',
        '',
        'Then regenerates the derived kimi trees (.kimi-code/agents, .kimi-code/',
        'plugin/commands and every .kimi-code/skills/<dir>/SKILL.md) by running the',
        "built CLI's kimi converters over .claude/, removing entries they no longer",
        'produce. Needs the CLI built (pnpm -r run build).',
        '',
        '  --check   report divergence and exit 1 without writing anything',
      ].join('\n'),
    );
    return 0;
  }

  const check = argv.includes('--check');
  compileGeneratedSkills();
  const { pairs, written, staleExceptions } = syncTrees({ check });

  let divergedTotal = 0;
  for (const pair of pairs) {
    divergedTotal += pair.diverged.length + pair.missing.length;
    const missingNote = pair.missing.length ? `, ${pair.missing.length} missing` : '';
    console.log(
      `${pair.source} -> ${pair.mirror}: ${pair.shared} shared, ${pair.diverged.length} diverged${missingNote}`,
    );
    for (const rel of pair.diverged) console.log(`    ${rel}`);
    for (const rel of pair.missing) console.log(`    ${rel} (missing)`);
  }

  if (staleExceptions.length > 0) {
    console.error(
      '\n❌ Stale exceptions — these paths now hold the canonical content, so they ' +
        'no longer need to be exceptions. Remove them from MIRRORS in ' +
        'scripts/sync-claude-trees.mjs:',
    );
    for (const rel of staleExceptions) console.error(`    ${rel}`);
    return 1;
  }

  // Kimi runs after the mirrors so it sees the synced .claude/ tree.
  let kimi;
  try {
    kimi = syncKimiTrees({ convert: await loadKimiConverter(), check });
  } catch (err) {
    console.error(`\n❌ ${err.message}`);
    return 1;
  }
  const kimiOff = kimi.missing.length + kimi.diverged.length + kimi.stale.length;
  console.log(
    `.claude -> .kimi-code (converted): ${kimi.missing.length} missing, ` +
      `${kimi.diverged.length} diverged, ${kimi.stale.length} stale`,
  );
  for (const rel of kimi.missing) console.log(`    ${rel} (missing)`);
  for (const rel of kimi.diverged) console.log(`    ${rel}`);
  for (const rel of kimi.stale) console.log(`    ${rel} (stale)`);

  if (check) {
    if (divergedTotal === 0 && kimiOff === 0) {
      console.log(
        '\n✓ All .claude asset trees and the derived kimi trees hold the canonical content.',
      );
      return 0;
    }
    console.error(
      `\n❌ ${divergedTotal} mirrored file(s) and ${kimiOff} kimi file(s) are not ` +
        'in their canonical form.\n' +
        '   Run `pnpm run sync:claude-trees` to fix them.',
    );
    return 1;
  }

  const total = written.length + kimi.written.length;
  console.log(
    total === 0
      ? '\n✓ Nothing to do — all .claude asset trees and kimi trees already hold the canonical content.'
      : `\n✓ Rewrote ${total} file(s) to the canonical content.`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
