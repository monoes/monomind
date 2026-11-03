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
 *   .agents/skills, .gemini/skills   full copies of .claude/skills
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
  { dir: '.gemini/skills' },
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
 */
function sourceFiles(root) {
  const base = join(root, '.claude');
  let files;
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', '.claude'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    files = out
      .split('\0')
      .filter(Boolean)
      .map((p) => p.slice('.claude/'.length))
      .filter((rel) => existsSync(join(base, rel)));
    if (files.length === 0) throw new Error('no tracked files');
  } catch {
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
export function planTrees({ root = REPO_ROOT, kimiConvert = null } = {}) {
  const claude = join(root, '.claude');
  const files = sourceFiles(root);
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
      execFileSync('node', [script], { cwd: root, stdio: 'ignore' });
      writeFileSync(stamp, current);
    }
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Generate every derived tree into the repo. */
export async function generateTrees({ root = REPO_ROOT, kimi = true } = {}) {
  compileGeneratedSkills(root);
  const kimiConvert = kimi ? await loadKimiConverter(root) : null;
  const wanted = planTrees({ root, kimiConvert });
  return { wanted, ...writeTrees({ outRoot: root, wanted, withKimi: kimi }) };
}

/**
 * Regenerate into two fresh temp dirs: the output must be identical (the
 * generator is deterministic) and complete (every owned tree and every overlay
 * file is present). Then compare with the on-disk trees.
 */
export async function checkTrees({ root = REPO_ROOT, kimi = true } = {}) {
  compileGeneratedSkills(root);
  const kimiConvert = kimi ? await loadKimiConverter(root) : null;
  const problems = [];
  const tmp = mkdtempSync(join(tmpdir(), 'claude-trees-'));
  try {
    const digests = [];
    for (const name of ['a', 'b']) {
      const out = join(tmp, name);
      const wanted = planTrees({ root, kimiConvert });
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

export async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node scripts/generate-claude-trees.mjs [--check] [--no-kimi]');
    return 0;
  }
  const kimi = !argv.includes('--no-kimi');
  try {
    if (argv.includes('--check')) {
      const problems = await checkTrees({ kimi });
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
    const { wanted, written, removed } = await generateTrees({ kimi });
    console.log(
      `✓ Derived .claude trees: ${wanted.size} files, ${written.length} written, ${removed.length} removed.`,
    );
    return 0;
  } catch (err) {
    console.error(`\n❌ ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
