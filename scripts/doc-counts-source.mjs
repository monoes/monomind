#!/usr/bin/env node
/**
 * doc-count generation — count computation, each function reading exactly
 * one source of truth. Split out of generate-doc-counts.mjs (file-size
 * sweep). Pure move.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLI_PKG, counts, REPO_ROOT, read } from './doc-counts-shared.mjs';

/** The WORKER_CONFIGS object body in worker-manager-types.ts, key positions included. */
function workerConfigsBody() {
  const src = read('packages/@monomind/hooks/src/workers/worker-manager-types.ts');
  const start = src.indexOf('export const WORKER_CONFIGS');
  if (start === -1) throw new Error('WORKER_CONFIGS not found in worker-manager-types.ts');
  const end = src.indexOf('\n};', start);
  return src.slice(start, end === -1 ? undefined : end);
}

/** WORKER_CONFIGS in packages/@monomind/hooks/src/workers/worker-manager-types.ts. */
export function countWorkers() {
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
export function extractWorkerRows() {
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
        `WORKER_CONFIGS.${name}: could not extract description/priority — worker-manager-types.ts's shape changed, update the extractor`,
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
export function countNamedFiles(relDir, fileName) {
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
      else if (name === fileName && counts(full.slice(REPO_ROOT.length + 1))) count++;
    }
  };
  walk(join(REPO_ROOT, relDir));
  return count;
}

export function countRootSkills() {
  return countNamedFiles('.claude/skills', 'SKILL.md');
}

/** Top-level CLI commands: keys of COMMAND_LOADERS in commands/index.ts
 *  (includes the hidden `report-crash`, which --help omits). */
export function countCliCommands() {
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

/** `org` subcommands: inline objects, multi-line (`      name:`) or one-line
 *  (`    { name:`), or `xxxSubcommand` identifiers defined in sibling modules. */
export function countOrgSubcommands() {
  const block = subcommandsBlock('packages/@monomind/cli/src/commands/org.ts', 'orgCommand');
  return [...block.matchAll(/^( {6}name: '| {4}\{ name: '| {4}[a-z][A-Za-z]*Subcommand,$)/gm)]
    .length;
}

/** `hooks` subcommands: identifiers listed one per line (deprecated/aliases included). */
export function countHooksSubcommands() {
  const block = subcommandsBlock('packages/@monomind/cli/src/commands/hooks.ts', 'hooksCommand');
  return [...block.matchAll(/^ {4}[A-Za-z]+Command,$/gm)].length;
}

/** User-facing /mastermind:* commands in the npm-shipped asset tree; `_`-prefixed
 *  files are internal includes (e.g. _repeat, _taskfile), not commands. */
export function countMastermindCommands() {
  const rel = 'packages/@monomind/cli/.claude/commands/mastermind';
  return readdirSync(join(REPO_ROOT, rel)).filter(
    (n) => n.endsWith('.md') && !n.startsWith('_') && !n.startsWith('.') && counts(`${rel}/${n}`),
  ).length;
}

/**
 * Agent definitions in the shipped tree, as the registry builder sees them
 * (src/agents/registry-builder.ts: every `.md`, minus its SKIP_DIRS and `._`
 * files). `pickable` leaves out `deprecated: true` agents, which stay
 * spawnable by name but are never ranked.
 */
export function countShippedAgents() {
  const skipDirs = new Set(['schemas', 'ephemeral', 'reengineer-squad']);
  let total = 0;
  let deprecated = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('._')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(full);
      } else if (e.name.endsWith('.md') && counts(full.slice(REPO_ROOT.length + 1))) {
        total++;
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(full, 'utf8'));
        if (fm && /^deprecated:\s*true\s*$/m.test(fm[1])) deprecated++;
      }
    }
  };
  walk(join(REPO_ROOT, CLI_PKG, '.claude/agents'));
  return { total, pickable: total - deprecated };
}

/** Agents a default `monomind init` installs: the core pack's agent entries
 *  (CORE_PACK in packages/@monomind/cli/src/init/packs.ts) — a category
 *  directory counts every `.md` in it — minus files whose frontmatter says
 *  `deprecated: true`, the same rule copyAgents applies. */
export function countInstalledAgents() {
  const src = read(`${CLI_PKG}/src/init/packs.ts`);
  const start = src.indexOf('export const CORE_PACK');
  if (start === -1) throw new Error('CORE_PACK not found in packs.ts');
  const agentsAt = src.indexOf('  agents: [', start);
  const body = src.slice(agentsAt, src.indexOf('\n  ],', agentsAt));
  const entries = [...body.matchAll(/'([^']+)'/g)].map((q) => q[1]);
  let installed = 0;
  const add = (full) => {
    if (!full.endsWith('.md') || !counts(full.slice(REPO_ROOT.length + 1))) return;
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(full, 'utf8'));
    if (!(fm && /^deprecated:\s*true\s*$/m.test(fm[1]))) installed++;
  };
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else add(full);
    }
  };
  for (const entry of entries) {
    const full = join(REPO_ROOT, CLI_PKG, '.claude/agents', entry);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) walk(full);
    else add(full);
  }
  return installed;
}

/** Slash commands and skills the pick index lists for the shipped tree —
 *  the same builder the hooks and CLI use (.claude/helpers/build-skill-registry.cjs),
 *  without the machine-local ~/.claude/skills. */
export function countShippedIndex() {
  // The builder reads <root>/.claude/{commands,skills} from disk, so give it a
  // snapshot holding only the files that ship.
  const snapshot = mkdtempSync(join(tmpdir(), 'doc-counts-'));
  try {
    for (const sub of ['.claude/commands', '.claude/skills']) {
      const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name);
          const rel = full.slice(REPO_ROOT.length + 1);
          if (e.isDirectory()) walk(full);
          else if (counts(rel)) {
            const dest = join(snapshot, full.slice(join(REPO_ROOT, CLI_PKG).length + 1));
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(full, dest);
          }
        }
      };
      walk(join(REPO_ROOT, CLI_PKG, sub));
    }
    const require = createRequire(import.meta.url);
    const builder = require(join(REPO_ROOT, '.claude/helpers/build-skill-registry.cjs'));
    const { counts: c } = builder.build(snapshot, { user: false })._meta;
    return { commands: c.commands, skills: c.skills };
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

/** Bundled Org skills: `<name>/SKILL.md` directories in the package's org-skills. */
export function countOrgSkills() {
  const dir = join(REPO_ROOT, CLI_PKG, 'org-skills');
  return readdirSync(dir).filter(
    (n) =>
      /^[a-z0-9][a-z0-9-]{0,63}$/.test(n) &&
      existsSync(join(dir, n, 'SKILL.md')) &&
      counts(`${CLI_PKG}/org-skills/${n}/SKILL.md`),
  ).length;
}

/** Workspace packages with a package.json (pnpm-workspace.yaml globs), not counting the root umbrella. */
export function countPackages() {
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

/**
 * MCP tool counts, read from the BUILT CLI (the same source lint-tool-refs.mjs
 * uses): `full` is every tool the registry can load, which is what `tools/list`
 * returns under MONOMIND_MCP_FULL=1; `core` is the default advertised roster,
 * CORE_ADVERTISED_TOOLS limited to tools that are registered. Build the CLI first.
 */
export async function countMcpTools() {
  const dist = join(REPO_ROOT, CLI_PKG, 'dist/src');
  if (!existsSync(join(dist, 'mcp-client-registry.js'))) {
    throw new Error(`${CLI_PKG}/dist/src/mcp-client-registry.js is missing: build the CLI first`);
  }
  const registry = await import(pathToFileURL(join(dist, 'mcp-client-registry.js')).href);
  const roster = await import(pathToFileURL(join(dist, 'mcp-client-roster.js')).href);
  await registry.ensureAllLoaded();
  const names = new Set(registry.TOOL_REGISTRY.keys());
  return {
    full: names.size,
    core: [...roster.CORE_ADVERTISED_TOOLS].filter((n) => names.has(n)).length,
  };
}
