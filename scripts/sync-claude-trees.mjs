#!/usr/bin/env node

/**
 * Keep the five copies of the `.claude` asset tree in agreement, and undo the
 * in-place rewrite `monomind init --force` performs when it is run inside this
 * repo.
 *
 * WHY THIS EXISTS
 * ---------------
 * `monomind init --force` is a supported thing to run here, and it rewrites
 * assets in place: the skill writer wraps each file it owns in
 * `# monomind:start skills:<platform>:<name>` / `# monomind:end` markers. That
 * is correct behaviour in a *user's* project — it is how the writer claims the
 * files it manages. In this repo it is not, because here those same files are
 * the product's sources.
 *
 * init only writes the trees a platform adapter points at — `.claude/` (the
 * claude adapter) and `.agents/skills` (the shared portable root for
 * opencode/kimi/codex). The other three copies are never touched, so a clean
 * reproduction of `init --force` on 2.11.6 leaves:
 *
 *   - `tests/repo/claude-tree-parity.test.ts` failing on 14 paths under
 *     `skills/mastermind*` (root vs the npm-shipped tree);
 *   - `scripts/lint-skills.mjs` failing with 5 errors (mastermind, -plan,
 *     -execute, -debug, -org are required to be byte-identical across all five
 *     skill trees).
 *
 * WHY THIS DOES NOT JUST COPY THE ROOT COPY OVER THE MIRRORS
 * ----------------------------------------------------------
 * That was the obvious fix and it is wrong, reproducibly so.
 * `packages/@monomind/cli/.claude/skills` is not a mirror of the root tree: it
 * is the asset SOURCE init copies from (`findSourceDir()` in
 * `src/init/shared.ts` gives the package's own `.claude/<type>` highest
 * priority, and `copySkills()` writes it into the project before the adapter
 * install runs). Mirroring the marked root copy into it therefore:
 *
 *   1. publishes init's per-project ownership markers to every npm user, and
 *   2. makes the NEXT `init --force` nest a second block inside the first —
 *      observed directly: `.claude/skills/mastermind-debug/SKILL.md` came out
 *      with `# monomind:start skills:claude:mastermind-debug` twice.
 *
 * The markers are install bookkeeping, not asset content. The repo's committed
 * form has none of them (verified: zero `monomind:*:skills` markers anywhere
 * under `.claude/`, `.gemini/`, `.kimi-code/` or the package tree on `main`).
 *
 * THE RULE
 * --------
 *   1. The canonical content of a file is the repo-root `.claude/` copy with
 *      its `monomind:start|end skills:…` marker LINES removed. Only those
 *      marker lines are dropped — never a line of the body, and never an
 *      `instructions:` or any other marker namespace.
 *   2. For every path present in BOTH the root tree and a given mirror tree,
 *      any copy (the root's included) whose bytes differ from the canonical
 *      content is rewritten to it.
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
 * So a genuine hand-edit of `.claude/skills/x/SKILL.md` still propagates
 * outward to the other four trees, and init's marker noise is normalised away
 * instead of being propagated into the sources.
 *
 * THE `.agents/skills` EXCEPTION
 * ------------------------------
 * `.agents/skills` is not a passive mirror — it is a live install target that
 * opencode, kimi, codex and the other portable platforms share, and the body
 * sits in one co-owned `skills:agents:<name>` block. Nine files there are
 * committed in exactly that marked form and have never matched the `.claude`
 * copy (AGENTS_OWNED below). Rewriting them would
 * clobber committed content and would make `--check` fail on a clean checkout,
 * which would make it useless as a guard. They are excluded by path, and
 * `--check` errors if one ever becomes identical again so the list cannot rot.
 *
 * WHEN TO RUN IT
 * --------------
 * After `monomind init --force`, or after hand-editing the root `.claude/`
 * tree, before committing:
 *
 *     pnpm run sync:claude-trees          # write
 *     pnpm run sync:claude-trees:check    # report only, exit 1 on divergence
 *
 * The check mode runs in `pnpm run verify` and in CI alongside the other
 * cross-tree guards. `init --force` → sync converges in one pass, and the sync
 * is idempotent: running it twice in a row writes nothing.
 */

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
 * A whole-line `# monomind:start skills:<platform>:<name>` / `# monomind:end …`
 * marker, in any of the comment syntaxes the writer emits. Deliberately scoped
 * to the `skills:` namespace: `instructions:` blocks (CLAUDE.md, AGENTS.md) are
 * committed content owned by a different, still-live subsystem.
 */
const SKILL_MARKER_LINE =
  /^[\t ]*(?:(?:#|\/\/)\s*|<!--\s*)?monomind:(?:start|end)\s+skills:\S+[^\S\r\n]*(?:-->)?[^\S\r\n]*\r?\n/gm;

/** YAML frontmatter followed immediately by the body, with no blank line. */
const FRONTMATTER_WITHOUT_GAP = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)(?!\r?\n)/;

/**
 * `.agents/skills` paths carrying a committed co-owned `skills:agents:<name>`
 * block the `.claude` copy does not have. That tree's own install output, not
 * a stale mirror, so the sync leaves them alone.
 */
const AGENTS_OWNED = [
  'mastermind/references/antigravity-tools.md',
  'mastermind/references/claude-code-tools.md',
  'mastermind/references/codex-tools.md',
  'mastermind/references/copilot-tools.md',
  'mastermind/references/gemini-tools.md',
  'mastermind/references/pi-tools.md',
  'mastermind-memory/SKILL.md',
  'mastermind-research/SKILL.md',
  'mastermind-review/SKILL.md',
];

/**
 * Every tree that must agree with the root `.claude/` tree, and the part of the
 * source it holds. `packages/@monomind/cli/.claude` covers the whole tree
 * (helpers, agents, commands, skills); the three platform trees hold skills.
 */
const MIRRORS = [
  { source: '.claude', mirror: 'packages/@monomind/cli/.claude' },
  { source: '.claude/skills', mirror: '.agents/skills', exceptions: AGENTS_OWNED },
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
 * The root copy with init's skill-ownership marker lines removed.
 *
 * The opening marker is written *over* the blank line that separates YAML
 * frontmatter from the body, so removing it would close the gap and leave every
 * synced file one whitespace line away from its committed form. All 629
 * frontmatter'd markdown files in the five skill trees have that blank line, so
 * it is restored when a marker removal closed it — and only then.
 */
export function canonicalContent(text) {
  SKILL_MARKER_LINE.lastIndex = 0;
  const stripped = text.replace(SKILL_MARKER_LINE, '');
  if (stripped === text) return stripped;
  return stripped.replace(FRONTMATTER_WITHOUT_GAP, (_m, frontmatter) => `${frontmatter}\n`);
}

/**
 * Compare one source/mirror pair on the intersection of their paths.
 *
 * `unmarked` lists source paths whose root copy still carries init's markers;
 * `diverged` lists mirror paths that do not hold the canonical content.
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
  const unmarked = [];
  for (const rel of shared) {
    if (excluded.has(rel)) continue;
    const raw = readFileSync(join(sourceDir, rel), 'utf8');
    const canonical = canonicalContent(raw);
    if (canonical !== raw) unmarked.push(rel);
    if (readFileSync(join(mirrorDir, rel), 'utf8') !== canonical) diverged.push(rel);
  }

  // An exception that is now identical on both sides is no longer an
  // exception — shrink the list rather than letting it hide a real drift.
  const staleExceptions = [...excluded].filter((rel) => {
    const a = join(sourceDir, rel);
    const b = join(mirrorDir, rel);
    if (!existsSync(a) || !existsSync(b)) return false;
    return canonicalContent(readFileSync(a, 'utf8')) === readFileSync(b, 'utf8');
  });

  return {
    source,
    mirror,
    shared: shared.length,
    diverged: diverged.sort(),
    missing,
    unmarked: unmarked.sort(),
    staleExceptions,
  };
}

/**
 * Compare (and unless `check`, rewrite) every mirror pair plus the root copies
 * that still carry init's markers.
 */
export function syncTrees({ root = REPO_ROOT, mirrors = MIRRORS, check = false } = {}) {
  const pairs = [];
  const written = [];
  const staleExceptions = [];

  for (const spec of mirrors) {
    const result = comparePair({ root, ...spec });
    pairs.push(result);
    for (const rel of result.staleExceptions) staleExceptions.push(`${spec.mirror}/${rel}`);
    if (check) continue;

    for (const rel of result.unmarked) {
      const path = join(root, spec.source, rel);
      writeFileSync(path, canonicalContent(readFileSync(path, 'utf8')));
      const label = `${spec.source}/${rel}`;
      if (!written.includes(label)) written.push(label);
    }
    for (const rel of [...result.diverged, ...result.missing]) {
      const canonical = canonicalContent(readFileSync(join(root, spec.source, rel), 'utf8'));
      const target = join(root, spec.mirror, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, canonical);
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

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(
      [
        'Usage: node scripts/sync-claude-trees.mjs [--check]',
        '',
        "Normalises the repo's five .claude asset trees: strips the ownership",
        'markers `monomind init --force` writes into the root tree, then mirrors',
        'the result into the other four on the INTERSECTION of paths only. A file',
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
  const { pairs, written, staleExceptions } = syncTrees({ check });

  let divergedTotal = 0;
  const markedRootFiles = new Set();
  for (const pair of pairs) {
    divergedTotal += pair.diverged.length + pair.missing.length;
    for (const rel of pair.unmarked) markedRootFiles.add(`${pair.source}/${rel}`);
    const missingNote = pair.missing.length ? `, ${pair.missing.length} missing` : '';
    console.log(
      `${pair.source} -> ${pair.mirror}: ${pair.shared} shared, ${pair.diverged.length} diverged${missingNote}`,
    );
    for (const rel of pair.diverged) console.log(`    ${rel}`);
    for (const rel of pair.missing) console.log(`    ${rel} (missing)`);
  }

  if (markedRootFiles.size > 0) {
    console.log(
      `\n${markedRootFiles.size} root file(s) carry \`monomind:* skills:\` ownership markers ` +
        `(left by \`init --force\`)${check ? '' : ' — stripped'}:`,
    );
    for (const rel of [...markedRootFiles].sort()) console.log(`    ${rel}`);
  }

  if (staleExceptions.length > 0) {
    console.error(
      '\n❌ Stale exceptions — these paths now hold the canonical content, so they ' +
        'are no longer .agents-owned. Remove them from AGENTS_OWNED in ' +
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
    if (divergedTotal === 0 && markedRootFiles.size === 0 && kimiOff === 0) {
      console.log(
        '\n✓ All .claude asset trees and the derived kimi trees hold the canonical content.',
      );
      return 0;
    }
    console.error(
      `\n❌ ${divergedTotal} mirrored file(s), ${markedRootFiles.size} root file(s) and ` +
        `${kimiOff} kimi file(s) are not in their canonical form.\n` +
        '   Run `pnpm run sync:claude-trees` to fix them.\n' +
        '   (`monomind init --force` rewrites .claude/ and .agents/skills only, ' +
        'adding its ownership markers, which is what leaves the rest behind.)',
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
