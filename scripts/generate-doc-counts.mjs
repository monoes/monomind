#!/usr/bin/env node
/**
 * #128: hand-maintained counts in docs (CLI subcommand counts, worker
 * counts, agent/skill/command tallies) drift every time the underlying code
 * changes — multiple "docs: update all surfaces" commits have each fixed
 * some and left others stale. The sharpest live example found in the
 * 2026-08-09 audit: README.md/CLAUDE.md say "8 background workers" while
 * doc/index.html, doc/commands/cli-reference.md, doc/concepts/hooks.md,
 * doc/concepts/statusline.md, and doc/design-system.html all say "15" —
 * the real number (WORKER_CONFIGS in packages/@monomind/hooks) is 8; the
 * 15-era docs were never updated after 7 workers were deleted in the
 * 2026-07-17 audit.
 *
 * This script computes counts from source and substitutes them into a
 * small set of `<!-- doc-count:NAME -->N<!-- /doc-count:NAME -->` markers
 * placed in the docs (HTML and Markdown both use HTML comments, so the same
 * marker syntax works in every file this script touches).
 *
 * Usage:
 *   node scripts/generate-doc-counts.mjs           # rewrite markers in place
 *   node scripts/generate-doc-counts.mjs --check    # exit 1 if any marker is stale (no writes)
 *
 * `registry.json` (agent count, per-machine) is intentionally NOT read here
 * — both copies are gitignored and regenerated per-install, so a doc build
 * must count source `.md` files directly to get a value that's the same on
 * every machine and in CI.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(REPO_ROOT, p), 'utf8');

// ---------------------------------------------------------------------------
// Count computation — each function reads exactly one source of truth.
// ---------------------------------------------------------------------------

/** The WORKER_CONFIGS object body in worker-manager.ts, key positions included. */
function workerConfigsBody() {
  const src = read('packages/@monomind/hooks/src/workers/worker-manager.ts');
  const start = src.indexOf('export const WORKER_CONFIGS');
  if (start === -1) throw new Error('WORKER_CONFIGS not found in worker-manager.ts');
  const end = src.indexOf('\n};', start);
  return src.slice(start, end === -1 ? undefined : end);
}

/** WORKER_CONFIGS in packages/@monomind/hooks/src/workers/worker-manager.ts. */
function countWorkers() {
  const body = workerConfigsBody();
  const keys = [...body.matchAll(/^\s*'?([a-zA-Z0-9_-]+)'?:\s*\{/gm)];
  return keys.length;
}

/**
 * i-035 reviewer finding (MAJOR 1): the generated worker TABLES (name,
 * priority, purpose) were a hand-maintained list that drifted from
 * WORKER_CONFIGS independently of the count — the count said 9, the table
 * had 14 rows naming 6 workers that don't exist and omitting the one real
 * `reflexion` worker. Deriving the count alone doesn't fix a hardcoded row
 * list sitting underneath it; this extracts the actual rows the same way.
 * Each top-level key's own `{ ... }` block is scanned independently so one
 * worker's `description:`/`priority:` can't bleed into a neighbor's.
 */
function extractWorkerRows() {
  const body = workerConfigsBody();
  const keyMatches = [...body.matchAll(/^\s*'?([a-zA-Z0-9_-]+)'?:\s*\{/gm)];
  const rows = [];
  for (let i = 0; i < keyMatches.length; i++) {
    const name = keyMatches[i][1];
    const blockStart = keyMatches[i].index + keyMatches[i][0].length;
    const blockEnd = i + 1 < keyMatches.length ? keyMatches[i + 1].index : body.length;
    const block = body.slice(blockStart, blockEnd);
    const descMatch = block.match(/description:\s*['"]([^'"]+)['"]/);
    const priorityMatch = block.match(/priority:\s*WorkerPriority\.(\w+)/);
    if (!descMatch || !priorityMatch) {
      throw new Error(
        `WORKER_CONFIGS.${name}: could not extract description/priority — worker-manager.ts's shape changed, update the extractor`,
      );
    }
    rows.push({
      name,
      priority: priorityMatch[1].toLowerCase(),
      description: descMatch[1],
    });
  }
  return rows;
}

/** Recursively counts files matching `fileName` under `relDir`. */
function countNamedFiles(relDir, fileName) {
  let count = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith('._') || name === '.DS_Store' || name === 'node_modules') continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (name === fileName) count++;
    }
  };
  walk(join(REPO_ROOT, relDir));
  return count;
}

function countRootSkills() {
  return countNamedFiles('.claude/skills', 'SKILL.md');
}

/** Top-level CLI commands: keys of COMMAND_LOADERS in commands/index.ts
 *  (includes the hidden `report-crash`, which --help omits). */
function countCliCommands() {
  const src = read('packages/@monomind/cli/src/commands/index.ts');
  const start = src.indexOf('const COMMAND_LOADERS');
  if (start === -1) throw new Error('COMMAND_LOADERS not found in commands/index.ts');
  const body = src.slice(start, src.indexOf('\n};', start));
  return [...body.matchAll(/^ {2}'?[a-z][a-z-]*'?: async/gm)].length;
}

/** The top-level `subcommands: [ ... ]` block of one exported Command. */
function subcommandsBlock(relFile, exportName) {
  const src = read(relFile);
  const start = src.indexOf(`export const ${exportName}`);
  if (start === -1) throw new Error(`${exportName} not found in ${relFile}`);
  const open = src.indexOf('\n  subcommands: [', start);
  const close = src.indexOf('\n  ],', open);
  if (open === -1 || close === -1) throw new Error(`${exportName}.subcommands not found`);
  return src.slice(open, close);
}

/** `org` subcommands: inline objects, multi-line (`      name:`) or one-line (`    { name:`). */
function countOrgSubcommands() {
  const block = subcommandsBlock('packages/@monomind/cli/src/commands/org.ts', 'orgCommand');
  return [...block.matchAll(/^( {6}name: '| {4}\{ name: ')/gm)].length;
}

/** `hooks` subcommands: identifiers listed one per line (deprecated/aliases included). */
function countHooksSubcommands() {
  const block = subcommandsBlock('packages/@monomind/cli/src/commands/hooks.ts', 'hooksCommand');
  return [...block.matchAll(/^ {4}[A-Za-z]+Command,$/gm)].length;
}

/** User-facing /mastermind:* commands in the npm-shipped asset tree; `_`-prefixed
 *  files are internal includes (e.g. _repeat, _taskfile), not commands. */
function countMastermindCommands() {
  return readdirSync(join(REPO_ROOT, 'packages/@monomind/cli/.claude/commands/mastermind')).filter(
    (n) => n.endsWith('.md') && !n.startsWith('_') && !n.startsWith('.'),
  ).length;
}

/** The npm-shipped asset tree `monomind init` copies from. */
const CLI_PKG = 'packages/@monomind/cli';

/**
 * Agent definitions in the shipped tree, as the registry builder sees them
 * (src/agents/registry-builder.ts: every `.md`, minus its SKIP_DIRS and `._`
 * files). `pickable` leaves out `deprecated: true` agents, which stay
 * spawnable by name but are never ranked.
 */
function countShippedAgents() {
  const skipDirs = new Set(['schemas', 'ephemeral', 'reengineer-squad']);
  let total = 0;
  let deprecated = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('._')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(full);
      } else if (e.name.endsWith('.md')) {
        total++;
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(full, 'utf8'));
        if (fm && /^deprecated:\s*true\s*$/m.test(fm[1])) deprecated++;
      }
    }
  };
  walk(join(REPO_ROOT, CLI_PKG, '.claude/agents'));
  return { total, pickable: total - deprecated };
}

/** Slash commands and skills the pick index lists for the shipped tree —
 *  the same builder the hooks and CLI use (.claude/helpers/build-skill-registry.cjs),
 *  without the machine-local ~/.claude/skills. */
function countShippedIndex() {
  const require = createRequire(import.meta.url);
  const builder = require(join(REPO_ROOT, '.claude/helpers/build-skill-registry.cjs'));
  const { counts } = builder.build(join(REPO_ROOT, CLI_PKG), { user: false })._meta;
  return { commands: counts.commands, skills: counts.skills };
}

/** Bundled Org skills: `<name>/SKILL.md` directories in the package's org-skills. */
function countOrgSkills() {
  const dir = join(REPO_ROOT, CLI_PKG, 'org-skills');
  return readdirSync(dir).filter(
    (n) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(n) && existsSync(join(dir, n, 'SKILL.md')),
  ).length;
}

/** Workspace packages with a package.json (pnpm-workspace.yaml globs), not counting the root umbrella. */
function countPackages() {
  let n = 0;
  for (const scope of ['packages/@monomind', 'packages/@monoes']) {
    for (const name of readdirSync(join(REPO_ROOT, scope))) {
      try {
        statSync(join(REPO_ROOT, scope, name, 'package.json'));
        n++;
      } catch {}
    }
  }
  try {
    statSync(join(REPO_ROOT, 'packages/monofence-ai/package.json'));
    n++;
  } catch {}
  return n;
}

// ---------------------------------------------------------------------------
// Marker substitution
// ---------------------------------------------------------------------------

const SHIPPED_AGENTS = countShippedAgents();
const SHIPPED_INDEX = countShippedIndex();

const COUNTS = {
  workers: countWorkers(),
  'root-skills': countRootSkills(),
  'cli-commands': countCliCommands(),
  'org-subcommands': countOrgSubcommands(),
  'hooks-subcommands': countHooksSubcommands(),
  'mastermind-commands': countMastermindCommands(),
  packages: countPackages(),
  'bundled-agents': SHIPPED_AGENTS.total,
  'pickable-agents': SHIPPED_AGENTS.pickable,
  'bundled-skills': countNamedFiles(`${CLI_PKG}/.claude/skills`, 'SKILL.md'),
  'pickable-skills': SHIPPED_INDEX.skills,
  'slash-commands': SHIPPED_INDEX.commands,
  'org-skills': countOrgSkills(),
};

/**
 * i-041/i-117: WORKER_CONFIGS lives in @monoes/hooks, an *optional* package
 * that may not resolve at `init` time, so the CLAUDE.md/CAPABILITIES.md
 * generators cannot import it directly to count workers. This module is the
 * build-time hand-off: computed here from source (same countWorkers() the
 * doc markers use) and consumed in-process by the generators, so the worker
 * count is never hardcoded and never requires the optional package to be
 * installed just to render a doc string.
 */
const GENERATED_COUNTS_FILE = 'packages/@monomind/cli/src/init/generated-counts.ts';

/** Single-quoted JS string literal, escaping embedded single quotes — matches
 * biome.json's quoteStyle so the generated file doesn't need a reformat pass
 * beyond the line-wrap `biome format --write` below already handles. */
function quote(s) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function generatedCountsContent() {
  const rows = extractWorkerRows();
  const rowsLiteral = rows
    .map(
      (r) =>
        `  { name: ${quote(r.name)}, priority: ${quote(r.priority)}, description: ${quote(r.description)} },`,
    )
    .join('\n');
  return `// AUTO-GENERATED by \`node scripts/generate-doc-counts.mjs\` — do not
// hand-edit. \`--check\` runs in prepublishOnly (package.json) and blocks
// publish if this drifts from WORKER_CONFIGS.
//
// WORKER_CONFIGS lives in the optional @monoes/hooks package, which may not
// resolve at \`init\` time. These are computed from source at doc-generation
// time instead, so CLAUDE.md/CAPABILITIES.md's worker count AND worker table
// rows are always correct without an optional-package import for a doc
// string. WORKER_ROWS exists because deriving the count alone still let the
// row list beneath it drift independently (i-035 reviewer finding).
export const WORKER_COUNT = ${COUNTS.workers};

export interface WorkerRow {
  name: string;
  priority: string;
  description: string;
}

export const WORKER_ROWS: WorkerRow[] = [
${rowsLiteral}
];
`;
}

/** Every doc file that carries at least one <!-- doc-count:* --> marker. */
const DOC_FILES = [
  'README.md',
  'CLAUDE.md',
  'packages/@monomind/cli/CLAUDE.md',
  'doc/index.html',
  'doc/design-system.html',
  'doc/getting-started.md',
  'doc/concepts/agents-and-skills.md',
  'doc/commands/cli-reference.md',
  'doc/commands/org.md',
  'doc/concepts/hooks.md',
  'doc/concepts/statusline.md',
];

/**
 * CLI source strings that embed the worker count as a plain literal (no HTML
 * comment marker — TS source can't use one inside a template string without it
 * surfacing in --help output). Each entry is { file, regex, replacePattern }
 * where replacePattern uses %COUNT% as the substitution token.
 *
 * Kept conservative: one distinctive match per file.
 */
const CLI_SOURCE_PATCHES = [
  {
    file: 'packages/@monomind/cli/src/commands/hooks.ts',
    // Matches: `${output.highlight('worker')}          - Background worker management (N workers)`,
    regex:
      /(`\$\{output\.highlight\('worker'\)}\s+-\s+Background worker management\s+\()\d+(\s+workers\)`,)/,
    replacePattern: '$1%COUNT%$2',
  },
];

function markerRegex(name) {
  // Non-greedy: matches the shortest run up to the next closing marker, so
  // adjacent same-name markers on one line don't bleed into each other.
  return new RegExp(`<!-- doc-count:${name} -->.*?<!-- /doc-count:${name} -->`, 'g');
}

function applyMarkers(content) {
  let changed = false;
  let out = content;
  for (const [name, value] of Object.entries(COUNTS)) {
    const re = markerRegex(name);
    const replacement = `<!-- doc-count:${name} -->${value}<!-- /doc-count:${name} -->`;
    if (re.test(out)) {
      const next = out.replace(markerRegex(name), replacement);
      if (next !== out) changed = true;
      out = next;
    }
  }
  return { out, changed };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const stale = [];

  for (const relPath of DOC_FILES) {
    let content;
    try {
      content = read(relPath);
    } catch {
      continue; // doc file not present in this checkout — skip
    }
    const { out, changed } = applyMarkers(content);
    if (changed) {
      if (checkOnly) {
        stale.push(relPath);
      } else {
        writeFileSync(join(REPO_ROOT, relPath), out, 'utf8');
        console.log(`updated: ${relPath}`);
      }
    }
  }

  // CLI source strings: plain literals, not <!-- doc-count --> markers.
  for (const { file, regex, replacePattern } of CLI_SOURCE_PATCHES) {
    let content;
    try {
      content = read(file);
    } catch {
      continue;
    }
    if (!regex.test(content)) continue;
    // Re-extract the current count with a tight probe (regex above captures
    // prefix/suffix groups but not the digit on its own — kept readable).
    const digitMatch = content.match(/Background worker management\s+\((\d+)\s+workers\)/);
    const current = digitMatch ? Number(digitMatch[1]) : NaN;
    if (current === COUNTS.workers) continue;
    if (checkOnly) {
      stale.push(`${file} (worker-count literal: ${current} → ${COUNTS.workers})`);
    } else {
      const next = content.replace(
        regex,
        replacePattern.replace('%COUNT%', String(COUNTS.workers)),
      );
      writeFileSync(join(REPO_ROOT, file), next, 'utf8');
      console.log(`updated: ${file} (worker-count literal)`);
    }
  }

  // packages/@monomind/cli/src/init/generated-counts.ts — a real TS module,
  // not an HTML-comment marker, consumed in-process by the CLAUDE.md /
  // CAPABILITIES.md generators.
  {
    // Formatted through biome (matching this repo's line-width/quote-style
    // config) before comparing or writing — otherwise a --check run right
    // after a real write always reports stale, because the on-disk file was
    // reformatted by the repo's own format-on-save/lint step but the raw
    // template string here never was.
    const next = execFileSync(
      'npx',
      ['biome', 'format', `--stdin-file-path=${GENERATED_COUNTS_FILE}`],
      { cwd: REPO_ROOT, input: generatedCountsContent(), encoding: 'utf8' },
    );
    let current = null;
    try {
      current = read(GENERATED_COUNTS_FILE);
    } catch {
      // Not present yet — treat as stale so --check fails until it's generated.
    }
    if (current !== next) {
      if (checkOnly) {
        stale.push(GENERATED_COUNTS_FILE);
      } else {
        writeFileSync(join(REPO_ROOT, GENERATED_COUNTS_FILE), next, 'utf8');
        console.log(`updated: ${GENERATED_COUNTS_FILE}`);
      }
    }
  }

  if (checkOnly) {
    if (stale.length) {
      console.error(`Stale doc-count marker(s) in:\n${stale.map((p) => `  - ${p}`).join('\n')}`);
      console.error('\nRun: node scripts/generate-doc-counts.mjs');
      process.exit(1);
    }
    console.log('doc-count markers are up to date.');
  } else {
    console.log('Computed counts:', COUNTS);
  }
}

main();
