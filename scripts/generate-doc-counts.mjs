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
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(REPO_ROOT, p), 'utf8');

// ---------------------------------------------------------------------------
// Count computation — each function reads exactly one source of truth.
// ---------------------------------------------------------------------------

/** WORKER_CONFIGS in packages/@monomind/hooks/src/workers/worker-manager.ts. */
function countWorkers() {
  const src = read('packages/@monomind/hooks/src/workers/worker-manager.ts');
  const start = src.indexOf('export const WORKER_CONFIGS');
  if (start === -1) throw new Error('WORKER_CONFIGS not found in worker-manager.ts');
  const end = src.indexOf('\n};', start);
  const body = src.slice(start, end === -1 ? undefined : end);
  const keys = [...body.matchAll(/^\s*'?([a-zA-Z0-9_-]+)'?:\s*\{/gm)];
  return keys.length;
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

// ---------------------------------------------------------------------------
// Marker substitution
// ---------------------------------------------------------------------------

const COUNTS = {
  workers: countWorkers(),
  'root-skills': countRootSkills(),
};

/** Every doc file that carries at least one <!-- doc-count:* --> marker. */
const DOC_FILES = [
  'README.md',
  'CLAUDE.md',
  'packages/@monomind/cli/CLAUDE.md',
  'doc/index.html',
  'doc/design-system.html',
  'doc/commands/cli-reference.md',
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

  if (checkOnly) {
    if (stale.length) {
      console.error('Stale doc-count marker(s) in:\n' + stale.map((p) => `  - ${p}`).join('\n'));
      console.error('\nRun: node scripts/generate-doc-counts.mjs');
      process.exit(1);
    }
    console.log('doc-count markers are up to date.');
  } else {
    console.log('Computed counts:', COUNTS);
  }
}

main();
