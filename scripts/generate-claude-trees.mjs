#!/usr/bin/env node

/**
 * Generate the derived copies of the root `.claude/` asset tree.
 *
 * The root `.claude/` tree is the only source of truth this repo edits. These
 * trees are DERIVED from it, gitignored, and written by this script (the CLI
 * `build`, the vitest global setup and `pnpm run sync:claude-trees` all call it):
 *
 *   packages/@monomind/cli/.claude   what `npm pack` ships and `monomind init`
 *                                    copies from: the root agents, commands,
 *                                    helpers, skills and settings.json, minus
 *                                    PACKAGE_EXCLUDE (machine-local or
 *                                    repo-only files), plus every file under
 *                                    packages/@monomind/cli/claude-overlay/
 *                                    (the files that ship but are not part of
 *                                    this repo's own `.claude/`)
 *   .agents/skills, .gemini/skills   full copies of .claude/skills; the
 *                                    Antigravity-only .gemini/skills/monomind/SKILL.md
 *                                    stays tracked
 *   .gemini/helpers                  copy of .claude/helpers (minus the repo's
 *                                    git hooks); statusline.sh stays tracked
 *   .kimi-code/{agents,plugin/commands,skills}
 *                                    the built CLI's kimi converters over
 *                                    .claude/{agents,commands,skills}, plus the
 *                                    supporting files of each skill directory
 *
 * Hand-written platform files (.agents/hooks.json, .gemini/settings.json,
 * .kimi-code/plugin/kimi.plugin.json, ...) stay tracked and are never touched.
 *
 *     node scripts/generate-claude-trees.mjs            write the trees
 *     node scripts/generate-claude-trees.mjs --check    regenerate into a temp
 *         dir twice, require identical and complete output, and report an
 *         on-disk tree that is missing or stale (exit 1)
 *     node scripts/generate-claude-trees.mjs --no-kimi  skip the kimi trees
 *         (they need the built CLI; vitest setup uses this before a build)
 *     node scripts/generate-claude-trees.mjs --strict   fail instead of
 *         warning when `git ls-files` cannot list the tracked `.claude/` files
 *         (the CLI's prepack passes it; --check implies it)
 *     node scripts/generate-claude-trees.mjs --probe    exit 1 with the reason
 *         if this host cannot run the generator: git ls-files, spawning node,
 *         and a test write into every destination, which fails only where
 *         something needs writing (#789); writes nothing that stays. The
 *         release org's BUILD runs it in the checkout it builds
 *     node scripts/generate-claude-trees.mjs --probe --host-only    only git
 *         ls-files and spawning node, no writes: the release preflight, which
 *         runs in the operator's checkout, not the one that gets built
 *
 * Writes are skipped for files that already hold the right bytes, so running
 * it while tests read the trees is safe.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'packages/@monomind/cli';
const PKG_TREE = `${PKG}/.claude`;
const OVERLAY = `${PKG}/claude-overlay`;

/** Exact names skipped at any depth: machine-local or regenerated per machine. */
const IGNORED_NAMES = new Set([
  '.DS_Store',
  'settings.local.json',
  'scheduled_tasks.lock',
  'skill-registry.json',
]);
/** Directory names skipped at any depth. */
const IGNORED_DIRS = new Set(['worktrees', 'checkpoints', 'node_modules', '.git']);

/** Top-level entries of the root `.claude/` that go into the package tree. */
const PACKAGE_INCLUDE = ['agents', 'commands', 'helpers', 'skills', 'settings.json'];
/** Paths (files or directories) under `.claude/` that never ship. */
const PACKAGE_EXCLUDE = [
  'agents/dashboard-verifier.md',
  'commands/monomind-status.md',
  'helpers/pre-commit', // this repo's git hooks, not shipped helpers
  'helpers/post-commit',
  'skills/monoagent-image', // root-only skills
  'skills/monodoc',
];
/** `.gemini/helpers` is a copy of the helpers minus the repo's git hooks. */
const GEMINI_HELPERS_EXCLUDE = ['pre-commit', 'post-commit'];

/**
 * Kimi skill directories produced by something other than the converter:
 * `monodesign` is compiled by packages/@monoes/monodesign/scripts/sync-skill.mjs.
 */
const KIMI_EXCEPT_SKILLS = new Set(['monodesign']);
const KIMI_CONVERTER = `${PKG}/dist/src/init/write-kimicode.js`;

/** Directories each derived tree owns; files in them that are not wanted are removed. */
const OWNED = [
  { dir: PKG_TREE },
  { dir: '.agents/skills' },
  { dir: '.gemini/skills', keep: ['monomind/SKILL.md'] },
  { dir: '.gemini/helpers', keep: ['statusline.sh'] },
  { dir: '.kimi-code/agents', kimi: true },
  { dir: '.kimi-code/plugin/commands', kimi: true },
  { dir: '.kimi-code/skills', kimi: true },
];

function isIgnored(name) {
  // AppleDouble resource forks appear on exFAT volumes and are filesystem noise.
  return name.startsWith('._') || IGNORED_NAMES.has(name) || IGNORED_DIRS.has(name);
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
    else
      out.push(
        full
          .slice(base.length + 1)
          .split('\\')
          .join('/'),
      );
  }
  return out;
}

/**
 * Files of the root `.claude/` tree: what git tracks (so untracked
 * machine-local files never leak into a shipped tree), plus the gitignored
 * monodesign skill compiled by `compileGeneratedSkills`.
 *
 * When git cannot list them (no checkout, no git, a sandbox that blocks it),
 * every file on disk is used instead, with a warning: that can include
 * untracked machine-local files, so `strict` (release builds) throws (#796).
 */
function sourceFiles(root, { strict = false } = {}) {
  const base = join(root, '.claude');
  let files;
  let reason;
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', '.claude'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    files = out
      .split('\0')
      .filter(Boolean)
      .map((p) => p.slice('.claude/'.length))
      .filter((rel) => existsSync(join(base, rel)));
    if (files.length === 0) reason = 'git ls-files listed no tracked .claude/ files';
  } catch (err) {
    const detail = `${err.stderr ?? ''}`.trim().split('\n')[0] || err.message;
    reason = `git ls-files failed: ${detail}`;
  }
  if (reason) {
    if (strict) {
      throw new Error(
        `${reason} (in ${root}).\n` +
          '   A release build ships only git-tracked .claude/ files; run it from a git checkout where git works.',
      );
    }
    console.warn(
      `⚠ generate-claude-trees: ${reason}; using every file under .claude/ instead, ` +
        'which can include untracked machine-local files (--strict makes this an error).',
    );
    files = collectFiles(base);
  }
  const gen = collectFiles(join(base, 'skills', 'monodesign')).map((r) => `skills/monodesign/${r}`);
  const kept = new Set(
    [...files, ...gen].filter((rel) => !rel.split('/').some((seg) => isIgnored(seg))),
  );
  return [...kept].sort();
}

const under = (rel, prefix) => rel === prefix || rel.startsWith(`${prefix}/`);

/**
 * Map of every file the derived trees must hold: repo-relative target path ->
 * `{ file }` (copy of a source file) or a string (generated content).
 */
export function planTrees({ root = REPO_ROOT, kimiConvert = null, strict = false } = {}) {
  const claude = join(root, '.claude');
  const files = sourceFiles(root, { strict });
  const wanted = new Map();
  const copy = (target, rel) => wanted.set(target, { file: join(claude, rel) });

  for (const rel of files) {
    if (
      PACKAGE_INCLUDE.some((top) => under(rel, top)) &&
      !PACKAGE_EXCLUDE.some((ex) => under(rel, ex))
    ) {
      copy(`${PKG_TREE}/${rel}`, rel);
    }
    if (under(rel, 'skills')) {
      copy(`.agents/${rel}`, rel);
      copy(`.gemini/${rel}`, rel);
    }
    if (under(rel, 'helpers') && !GEMINI_HELPERS_EXCLUDE.includes(rel.slice('helpers/'.length))) {
      copy(`.gemini/${rel}`, rel);
    }
  }
  for (const rel of collectFiles(join(root, OVERLAY))) {
    wanted.set(`${PKG_TREE}/${rel}`, { file: join(root, OVERLAY, rel) });
  }

  if (kimiConvert) {
    const out = kimiConvert(claude);
    for (const [file, content] of out.agents) wanted.set(`.kimi-code/agents/${file}`, content);
    for (const [file, content] of out.pluginCommands) {
      wanted.set(`.kimi-code/plugin/commands/${file}`, content);
    }
    for (const [dir, content] of out.skills) {
      if (!KIMI_EXCEPT_SKILLS.has(dir)) wanted.set(`.kimi-code/skills/${dir}/SKILL.md`, content);
    }
    // Supporting files of each skill directory (SKILL.md excepted for converted ones).
    for (const rel of files) {
      if (!under(rel, 'skills')) continue;
      const [, dir, ...rest] = rel.split('/');
      if (rest.length === 0) continue;
      const isSkillMd = rest.length === 1 && rest[0] === 'SKILL.md';
      if (isSkillMd && !KIMI_EXCEPT_SKILLS.has(dir)) continue;
      copy(`.kimi-code/${rel}`, rel);
    }
  }
  return wanted;
}

const read = (src) =>
  typeof src === 'object' && src.file ? readFileSync(src.file) : Buffer.from(src);

/** Files under the owned directories of `outRoot` that the plan does not want. */
function staleFiles(outRoot, wanted, withKimi) {
  const stale = [];
  for (const { dir, keep = [], kimi } of OWNED) {
    if (kimi && !withKimi) continue;
    for (const rel of collectFiles(join(outRoot, dir))) {
      const target = `${dir}/${rel}`;
      if (!wanted.has(target) && !keep.includes(rel)) stale.push(target);
    }
  }
  return stale.sort();
}

/** Apply the plan to `outRoot`: write what differs, remove what is stale. */
export function writeTrees({ outRoot, wanted, withKimi = true }) {
  const written = [];
  for (const [target, src] of wanted) {
    const abs = join(outRoot, target);
    const data = read(src);
    if (existsSync(abs) && readFileSync(abs).equals(data)) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data);
    written.push(target);
  }
  const removed = staleFiles(outRoot, wanted, withKimi);
  for (const target of removed) rmSync(join(outRoot, target), { force: true });
  return { written, removed };
}

/** Targets in `outRoot` that are missing, differ from the plan, or are stale. */
export function diffTrees({ outRoot, wanted, withKimi = true }) {
  const missing = [];
  const diverged = [];
  for (const [target, src] of wanted) {
    const abs = join(outRoot, target);
    if (!existsSync(abs)) missing.push(target);
    else if (!readFileSync(abs).equals(read(src))) diverged.push(target);
  }
  return { missing, diverged, stale: staleFiles(outRoot, wanted, withKimi) };
}

function treeDigest(dir) {
  const hash = createHash('sha256');
  for (const rel of collectFiles(dir).sort()) {
    hash
      .update(rel)
      .update('\0')
      .update(readFileSync(join(dir, rel)))
      .update('\0');
  }
  return hash.digest('hex');
}

export async function loadKimiConverter(root = REPO_ROOT) {
  const modPath = join(root, KIMI_CONVERTER);
  if (!existsSync(modPath)) {
    throw new Error(
      `${KIMI_CONVERTER} is missing — build the CLI first (pnpm run build). ` +
        'The kimi trees are produced by its converters.',
    );
  }
  const mod = await import(pathToFileURL(modPath).href);
  return (claudeDir) => mod.convertClaudeTreeToKimi(claudeDir);
}

/**
 * The root `.claude/skills/monodesign` copy is gitignored: it is compiled from
 * packages/@monoes/monodesign by that package's sync-skill.mjs. Compile it
 * first so every derived tree sees the same content on a clean checkout.
 */
const MONODESIGN = 'packages/@monoes/monodesign';
const MONODESIGN_INPUTS = ['skill', 'cli/engine', 'cli/lib', 'scripts/sync-skill.mjs'];
const MONODESIGN_OUTPUTS = [
  '.claude/skills/monodesign/SKILL.md',
  `${PKG_TREE}/skills/monodesign/SKILL.md`,
];

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
 * Compile the monodesign skill when its sources changed since the last compile
 * (or an output is missing). sync-skill.mjs deletes and rewrites its output
 * directories, so an up-to-date compile is skipped to avoid racing readers; a
 * lock serialises concurrent first compiles.
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
      try {
        execFileSync(process.execPath, [script], {
          cwd: root,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
      } catch (err) {
        const stderr = `${err.stderr ?? ''}`.trim();
        throw new Error(
          `could not compile the monodesign skill (${process.execPath} ${script}): ${err.message}` +
            (stderr ? `\n${stderr}` : ''),
        );
      }
      writeFileSync(stamp, current);
    }
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Generate every derived tree into the repo. */
export async function generateTrees({ root = REPO_ROOT, kimi = true, strict = false } = {}) {
  compileGeneratedSkills(root);
  const kimiConvert = kimi ? await loadKimiConverter(root) : null;
  const wanted = planTrees({ root, kimiConvert, strict });
  return { wanted, ...writeTrees({ outRoot: root, wanted, withKimi: kimi }) };
}

/**
 * Regenerate into two fresh temp dirs: the output must be identical (the
 * generator is deterministic) and complete (every owned tree and every overlay
 * file is present). Then compare with the on-disk trees.
 */
export async function checkTrees({ root = REPO_ROOT, kimi = true, strict = false } = {}) {
  compileGeneratedSkills(root);
  const kimiConvert = kimi ? await loadKimiConverter(root) : null;
  const problems = [];
  const tmp = mkdtempSync(join(tmpdir(), 'claude-trees-'));
  try {
    const digests = [];
    for (const name of ['a', 'b']) {
      const out = join(tmp, name);
      const wanted = planTrees({ root, kimiConvert, strict });
      writeTrees({ outRoot: out, wanted, withKimi: kimi });
      digests.push(treeDigest(out));
      if (name === 'a') {
        for (const { dir, kimi: isKimi } of OWNED) {
          if (isKimi && !kimi) continue;
          if (collectFiles(join(out, dir)).length === 0) problems.push(`${dir} generated empty`);
        }
        for (const rel of collectFiles(join(root, OVERLAY))) {
          if (!existsSync(join(out, PKG_TREE, rel)))
            problems.push(`${PKG_TREE}/${rel} not generated`);
        }
        for (const rel of PACKAGE_INCLUDE) {
          if (existsSync(join(root, '.claude', rel)) && !existsSync(join(out, PKG_TREE, rel))) {
            problems.push(`${PKG_TREE}/${rel} not generated`);
          }
        }
        const disk = diffTrees({ outRoot: root, wanted, withKimi: kimi });
        for (const [kind, list] of Object.entries(disk)) {
          for (const rel of list) problems.push(`${rel} (${kind} on disk)`);
        }
      }
    }
    if (digests[0] !== digests[1]) problems.push('generation is not deterministic');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return problems;
}

/** Probe entries start with `._`, which isIgnored skips, so a concurrent run
 *  never copies or removes one. */
const PROBE_NAME = `._gentrees-probe-${process.pid}`;
const CACHE_DIR = 'node_modules/.cache/sync-claude-trees';
const SANDBOX_HINT =
  'A Claude Code / Agent SDK sandbox denies writes below every .claude/agents and ' +
  '.claude/commands directory under its working directory, whatever its allowWrite ' +
  'says, so a sandboxed role cannot create these files. Run ' +
  '`node scripts/generate-claude-trees.mjs --no-kimi` in this checkout from outside that ' +
  "sandbox first (the release org's publisher, #789); once they are current the " +
  'generator has nothing to write there.';

/** The directory a write test covers for `target`: the owned directory, or its
 *  first subdirectory when the target lies deeper. The SDK's rule matches only
 *  BELOW `.claude/agents`, so a file directly in the package tree proves
 *  nothing about `.claude/agents/...`. */
function probeDir(target) {
  const owned = OWNED.find(({ dir }) => under(target, dir));
  if (!owned) return dirname(target);
  const rest = target.slice(owned.dir.length + 1).split('/');
  return rest.length > 1 ? `${owned.dir}/${rest[0]}` : owned.dir;
}

/** Create and remove a file in `dir` (creating `dir` too when missing, and
 *  removing what was created). Returns the error code of a refused write. */
function writeDenied(root, dir) {
  const abs = join(root, dir);
  let made;
  try {
    made = mkdirSync(abs, { recursive: true });
    writeFileSync(join(abs, PROBE_NAME), '');
    return null;
  } catch (err) {
    return err.code ?? err.message;
  } finally {
    rmSync(join(abs, PROBE_NAME), { force: true });
    // Only the directories this probe created, innermost first, and only while
    // empty: a concurrent run may have started filling them.
    for (let d = abs; made && d.length >= made.length; d = dirname(d)) {
      try {
        rmdirSync(d);
      } catch {
        break;
      }
    }
  }
}

/**
 * Check that this host can run the generator: git lists the tracked `.claude/`
 * files, a node child process starts, and every destination the generator
 * writes to takes a new file (#789: the 2.29.4 release builder's sandbox
 * refused `mkdir packages/@monomind/cli/.claude/agents/...` with EPERM). A
 * destination that refuses writes fails only when something there needs
 * writing (missing, diverged or stale against the plan); when it is already
 * current the generator writes nothing there, which is reported as a note.
 * The kimi trees (they need the built CLI to plan) and the compile cache must
 * be writable. Leaves nothing behind. `hostOnly` skips the writes. Throws with
 * the reason; returns notes.
 */
export function probe(root = REPO_ROOT, { hostOnly = false } = {}) {
  const wanted = planTrees({ root, strict: true });
  try {
    execFileSync(process.execPath, ['-e', ''], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    throw new Error(`cannot start a node child process (${process.execPath}): ${err.message}`);
  }
  if (hostOnly) return [];
  const { missing, diverged, stale } = diffTrees({ outRoot: root, wanted, withKimi: false });
  const pending = [...missing, ...diverged, ...stale];
  const always = [CACHE_DIR, ...OWNED.filter((o) => o.kimi).map((o) => o.dir)];
  const dirs = new Set([...always, ...[...wanted.keys()].map(probeDir)]);
  const notes = [];
  for (const dir of [...dirs].sort()) {
    const code = writeDenied(root, dir);
    if (!code) continue;
    if (always.includes(dir)) {
      throw new Error(
        `cannot write under ${join(root, dir)} (${code}); every run of the generator writes there.`,
      );
    }
    const need = pending.filter((t) => probeDir(t) === dir).sort();
    if (need.length === 0) {
      notes.push(`writes under ${dir} are refused here (${code}), but every file there is current`);
      continue;
    }
    throw new Error(
      `cannot write under ${join(root, dir)} (${code}), and ${need.length} file(s) there ` +
        `need writing, e.g. ${need[0]}.\n   ${SANDBOX_HINT}`,
    );
  }
  return notes;
}

export async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(
      'Usage: node scripts/generate-claude-trees.mjs [--check] [--no-kimi] [--strict] [--probe [--host-only]]',
    );
    return 0;
  }
  const kimi = !argv.includes('--no-kimi');
  const check = argv.includes('--check');
  const strict = check || argv.includes('--strict');
  try {
    if (argv.includes('--probe')) {
      const hostOnly = argv.includes('--host-only');
      for (const note of probe(REPO_ROOT, { hostOnly })) console.log(`  note: ${note}`);
      console.log(
        hostOnly
          ? '✓ generate-claude-trees can run on this host (git ls-files and node child processes work).'
          : '✓ generate-claude-trees can run here (git ls-files, node child processes and its writes work).',
      );
      return 0;
    }
    if (check) {
      const problems = await checkTrees({ kimi, strict });
      if (problems.length === 0) {
        console.log(
          '✓ Derived .claude trees regenerate deterministically and match what is on disk.',
        );
        return 0;
      }
      for (const p of problems.slice(0, 40)) console.error(`    ${p}`);
      if (problems.length > 40) console.error(`    ... and ${problems.length - 40} more`);
      console.error(
        `\n❌ ${problems.length} problem(s) with the derived .claude trees.\n` +
          '   Run `pnpm run sync:claude-trees` to regenerate them (the root .claude/ is the source).',
      );
      return 1;
    }
    const { wanted, written, removed } = await generateTrees({ kimi, strict });
    console.log(
      `✓ Derived .claude trees: ${wanted.size} files, ${written.length} written, ${removed.length} removed.`,
    );
    return 0;
  } catch (err) {
    console.error(`\n❌ ${err.message}`);
    if (
      ['EPERM', 'EACCES'].includes(err.code) &&
      /\/\.claude\/(agents|commands)\//.test(err.path ?? '')
    ) {
      console.error(`   ${SANDBOX_HINT}`);
    }
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
