#!/usr/bin/env node

/**
 * Generate packages/@monomind/cli/src/init/retired-files-data.ts (#418).
 *
 * `init` / `init upgrade` retire files an older monomind installed that this
 * version no longer ships, but only when a file still holds content some
 * release shipped: a user-edited copy is kept, with a warning. This script
 * records those contents as hashes. For every retired source file it takes
 * every version in git history (the root `.claude/` tree and the npm-shipped
 * `packages/@monomind/cli/.claude/` tree), and hashes:
 *   - the file itself, as `init` copied it into `.claude/` (and, for skills,
 *     into the `.agents/skills` and `.gemini/skills` mirrors);
 *   - what the current Kimi Code and OpenCode converters make of it
 *     (`.kimi-code/{agents,skills,plugin/commands}`, `.opencode/{agent,command,skills}`);
 *   - every tracked version of the repo's own `.kimi-code` copies.
 * Helper scripts (`helpers/…`) are hashed as `.claude/helpers/…` and `.gemini/helpers/…`
 * only: the Kimi/OpenCode converters do not carry them.
 * Stale READMEs `init` no longer rewrites are listed with the hashes of their
 * old versions, so an unmodified one can be refreshed to the current copy.
 *
 * Needs the built CLI (the converters come from dist): `pnpm -r run build`.
 * Run from the repo root: `node scripts/generate-retired-file-hashes.mjs`.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = 'packages/@monomind/cli/src/init/retired-files-data.ts';
const TREES = ['.claude', 'packages/@monomind/cli/.claude'];

/** Source paths (relative to a `.claude/` tree) removed in 2.22.0 (#418). */
const RETIRED_DIRS = ['commands/monoswarm', 'skills/monoswarm'];
const RETIRED_FILES = [
  'commands/coordination/monoswarm-init.md',
  'commands/coordination/task-orchestrate.md',
  'commands/mastermind/monoswarm.md',
  'commands/mastermind/topology.md',
  'commands/optimization/auto-topology.md',
  'agents/templates/coordinator-monoswarm-init.md',
];
/** Helper scripts removed after 2.29.0: nothing loads them any more. */
const RETIRED_HELPERS = ['helpers/intelligence.cjs', 'helpers/router.cjs'];
/** READMEs still shipped whose old versions named the removed commands. */
const REFRESHED_READMES = [
  'commands/coordination/README.md',
  'commands/monitoring/README.md',
  'commands/workflows/README.md',
];

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

// Same as contentHash / bodyHash in src/init/retired-files.ts.
function contentHash(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
}
function bodyHash(text) {
  const body = text.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '');
  return contentHash(body.trim());
}

/** Every path ever committed under `prefix` (a file or a directory). */
function pathsEverUnder(prefix) {
  const out = git('log', '--all', '--format=', '--name-only', '--', prefix);
  return [...new Set(out.split('\n').filter((p) => p === prefix || p.startsWith(`${prefix}/`)))];
}

/** Every distinct content `repoPath` has had in history. */
function versionsOf(repoPath) {
  const commits = git('log', '--all', '--format=%H', '--', repoPath).split('\n').filter(Boolean);
  const blobs = new Set();
  for (const c of commits) {
    try {
      blobs.add(
        execFileSync('git', ['rev-parse', `${c}:${repoPath}`], {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim(),
      );
    } catch {
      // deleted in this commit
    }
  }
  return [...blobs].map((b) => git('cat-file', 'blob', b));
}

const hashes = new Map(); // project-relative path -> Set<hash>
const bodies = new Set(); // body hashes of every shipped version of a retired source
const add = (path, text) => {
  if (!hashes.has(path)) hashes.set(path, new Set());
  hashes.get(path).add(contentHash(text));
};

const dist = join(ROOT, 'packages/@monomind/cli/dist/src/init');
const { convertClaudeTreeToKimi } = await import(
  pathToFileURL(join(dist, 'write-kimicode.js')).href
);
const { convertClaudeTreeToOpencode } = await import(
  pathToFileURL(join(dist, 'write-opencode.js')).href
);

/** Run both converters over a one-file `.claude` tree holding `rel`. */
function convertOne(rel, text) {
  const tmp = mkdtempSync(join(tmpdir(), 'retired-hashes-'));
  try {
    mkdirSync(join(tmp, dirname(rel)), { recursive: true });
    writeFileSync(join(tmp, rel), text);
    const kimi = convertClaudeTreeToKimi(tmp);
    for (const [f, c] of kimi.agents) add(`.kimi-code/agents/${f}`, c);
    for (const [d, c] of kimi.skills) add(`.kimi-code/skills/${d}/SKILL.md`, c);
    for (const [f, c] of kimi.pluginCommands) add(`.kimi-code/plugin/commands/${f}`, c);
    const oc = convertClaudeTreeToOpencode(tmp);
    for (const [f, c] of oc.agents) add(`.opencode/agent/${f}`, c);
    for (const [f, c] of oc.commands) add(`.opencode/command/${f}`, c);
    for (const [d, c] of oc.skills) add(`.opencode/skills/${d}/SKILL.md`, c);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const sources = new Set([...RETIRED_FILES, ...RETIRED_HELPERS]);
for (const dir of RETIRED_DIRS) {
  for (const tree of TREES) {
    for (const p of pathsEverUnder(`${tree}/${dir}`)) sources.add(p.slice(tree.length + 1));
  }
}

for (const rel of [...sources].sort()) {
  for (const tree of TREES) {
    for (const text of versionsOf(`${tree}/${rel}`)) {
      add(`.claude/${rel}`, text);
      if (rel.startsWith('helpers/')) {
        add(`.gemini/${rel}`, text); // helpers are not converted for Kimi/OpenCode
        continue;
      }
      bodies.add(bodyHash(text));
      if (rel.startsWith('skills/')) {
        add(`.agents/${rel}`, text);
        add(`.gemini/${rel}`, text);
      }
      convertOne(rel, text);
    }
  }
}

// The repo's own tracked mirror copies, in every version they have had.
const derived = [...hashes.keys()].filter((p) => /^\.(kimi-code|agents|gemini)\//.test(p));
for (const p of derived) for (const text of versionsOf(p)) add(p, text);

const readmes = new Map();
for (const rel of REFRESHED_READMES) {
  const set = new Set();
  for (const tree of TREES)
    for (const text of versionsOf(`${tree}/${rel}`)) set.add(contentHash(text));
  readmes.set(`.claude/${rel}`, set);
}

const fmt = (map) =>
  [...map.keys()]
    .sort()
    .map(
      (k) =>
        `  '${k}': [${[...map.get(k)]
          .sort()
          .map((h) => `'${h}'`)
          .join(', ')}],`,
    )
    .join('\n');

writeFileSync(
  join(ROOT, OUT),
  `// Generated by scripts/generate-retired-file-hashes.mjs — do not edit by hand.
// Hashes: first 16 hex chars of sha256 over LF-normalised content.

/** Files older releases installed that 2.22.0 removed (#418), by project path. */
export const RETIRED_FILE_HASHES: Readonly<Record<string, readonly string[]>> = {
${fmt(hashes)}
};

/** Body hashes (after frontmatter) of every shipped version of a retired
 *  source: an older Kimi Code / OpenCode converter rewrote only frontmatter. */
export const RETIRED_BODY_HASHES: readonly string[] = [
${[...bodies]
  .sort()
  .map((h) => `  '${h}',`)
  .join('\n')}
];

/** Still-shipped READMEs whose old versions named removed commands. */
export const STALE_README_HASHES: Readonly<Record<string, readonly string[]>> = {
${fmt(readmes)}
};
`,
);
console.log(`wrote ${OUT}: ${hashes.size} retired paths, ${readmes.size} READMEs`);
