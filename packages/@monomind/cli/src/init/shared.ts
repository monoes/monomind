/**
 * Shared utilities, constants, and types used across init write-* modules.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MASTERMIND_SKILLS } from '../mastermind/manifest-data.js';
import type { Command } from '../types.js';
import type { WorkerRow } from './generated-counts.js';
import type { InitResult } from './types.js';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const MAX_EXEC_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * i-041/i-117: the generated CLAUDE.md / CAPABILITIES.md CLI-commands table
 * used to hardcode each command's subcommand count (drifts every release —
 * real init/agent/monoswarm/mcp counts were all wrong at 091d8e05c). Reading
 * `command.subcommands.length` directly from the live `Command` object
 * fixes that, but `subcommands` is typed optional on `Command` — a command
 * with none is a real, honest 0, not a type error to paper over.
 */
export function subcommandCount(command: Command): number {
  return command.subcommands?.length ?? 0;
}

/**
 * Renders the `| name | priority | description |` markdown rows for the
 * Background Workers table in both CLAUDE.md and CAPABILITIES.md, from
 * generated-counts.ts's WORKER_ROWS (derived from WORKER_CONFIGS at
 * doc-generation time).
 *
 * i-035 reviewer finding (MAJOR 1): deriving the worker *count* did not fix
 * the worker *table* underneath it — it was a hand-maintained list of 14
 * names, 6 of which don't exist (`hooks worker run <name>` errors on them)
 * and one real worker (`reflexion`) it never listed. The heading number and
 * the row list must come from the same source or they will disagree again.
 */
export function workerTableRows(rows: WorkerRow[]): string {
  return rows.map((w) => `| \`${w.name}\` | ${w.priority} | ${w.description} |`).join('\n');
}
const CANONICAL_MASTERMIND_SKILLS = MASTERMIND_SKILLS.map((skill) => skill.source);

/**
 * Probe whether an optionalDependency actually resolved in this install
 * (npm silently skips optionalDependencies it can't satisfy — see
 * docs/AUDIT-BACKLOG.md P1-1/P1-23). Used to caveat generated docs instead
 * of presenting these features as unconditionally working.
 *
 * i-041/i-117: `require.resolve` (via `createRequire`) cannot satisfy a
 * package whose `exports` map gates its root entry behind an `import`
 * condition only — `@monoes/hooks` and `monofence-ai` both do — so it always
 * threw for them, reporting "unavailable" even when correctly installed.
 * `import.meta.resolve()` resolves both require- and import-only export
 * shapes; it is synchronous and throws on failure (not a truthiness check),
 * so the try/catch shape here is unchanged. The sole helper for this
 * question — claudemd-generator.ts's detectOptionalPackages() calls this
 * rather than re-implementing its own resolver.
 */
export function _isOptionalPackageResolvable(pkg: string): boolean {
  try {
    import.meta.resolve(pkg);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomic write helper — writes to a sibling .tmp file then renames into place.
 * SIGINT or crash during a partial write would otherwise corrupt user-critical
 * files (.claude/settings.json, .mcp.json, helper scripts that Claude Code
 * executes on every hook). Without atomicity a half-written settings.json or
 * a zero-byte hook-handler.cjs disables Claude Code's protections silently.
 */
export function atomicWriteFile(
  target: string,
  content: string | Buffer,
  encoding?: BufferEncoding,
): void {
  const tmp = `${target}.${process.pid}.tmp`;
  if (encoding && typeof content === 'string') {
    fs.writeFileSync(tmp, content, encoding);
  } else if (typeof content === 'string') {
    fs.writeFileSync(tmp, content, 'utf-8');
  } else {
    fs.writeFileSync(tmp, content);
  }
  fs.renameSync(tmp, target);
}

/**
 * The `Generated: <ISO timestamp>` stamp that .monomind/config.yaml and
 * .monomind/CAPABILITIES.md carry, in whatever comment syntax their format
 * uses (`# Generated: …`, `> Generated: …`).
 */
const GENERATED_TIMESTAMP = /(Generated:[^\S\r\n]*)\d{4}-\d{2}-\d{2}T[\d:.]+Z/g;

function withoutGeneratedTimestamp(content: string): string {
  return content.replace(GENERATED_TIMESTAMP, '$1<generated>');
}

/**
 * Write a generated file that embeds a `Generated: <ISO timestamp>` line,
 * skipping the write entirely when that stamp is the only thing that would
 * change. Otherwise every `init --force` rewrote these files with a fresh
 * timestamp and left the repository dirty by exactly two files, for
 * information nobody can act on. Skipping the write (rather than reusing the
 * old stamp) keeps the mtime stable too, and the stamp keeps its meaning:
 * when this content was generated.
 */
export function writeGeneratedFile(target: string, content: string): void {
  try {
    const existing = fs.readFileSync(target, 'utf-8');
    if (withoutGeneratedTimestamp(existing) === withoutGeneratedTimestamp(content)) return;
  } catch {
    // No readable file on disk — fall through and write it.
  }
  atomicWriteFile(target, content);
}

/**
 * Guard for the write-opencode.ts / write-kimicode.ts converters, which read
 * `.claude/{agents,commands,skills}` and write the converted result into what
 * is expected to be a separate platform directory (`.opencode/...`,
 * `.kimi-code/...`). If that destination has been symlinked back into
 * `.claude/` (observed live: a committed `.opencode/command -> ../.claude/commands`
 * symlink), the atomic write-then-rename in `atomicWriteFile` resolves through
 * the symlink and lands the converted, flattened, field-injected output
 * straight back in the Claude source tree it was just read from — silently
 * corrupting hand-authored agent/skill/command files and resurrecting
 * "deleted" flattened command duplicates on every `--force` run.
 *
 * Checked once per destination directory (not per file) before its copy loop.
 * Returns false and records one `result.errors` entry when `destDir` resolves
 * inside `claudeDir`; the caller should skip the whole loop rather than write
 * file-by-file into the wrong place.
 */
export function isSafeConversionTarget(
  destDir: string,
  claudeDir: string,
  result: InitResult,
  label: string,
): boolean {
  let realDest: string;
  try {
    realDest = fs.realpathSync(destDir);
  } catch {
    return true; // doesn't exist yet — mkdirSync will create a real directory
  }
  let realClaude: string;
  try {
    realClaude = fs.realpathSync(claudeDir);
  } catch {
    return true; // no .claude/ to collide with
  }
  if (realDest === realClaude || realDest.startsWith(`${realClaude}${path.sep}`)) {
    result.errors.push(
      `${label} resolves inside .claude/ (likely a symlink) — skipping to avoid writing converted files back into the Claude source tree. Remove or repoint the symlink and re-run.`,
    );
    return false;
  }
  return true;
}

/**
 * Skills to copy based on configuration
 */
export const SKILLS_MAP: Record<string, string[]> = {
  core: [
    'monoswarm',
    'hooks-automation',
    'pair-programming',
    'verification-quality',
    'skill-builder',
    'specialagent',
    'monodesign',
    'monomotion',
    'monolean',
    'monolean-review',
    'monolean-audit',
    'monolean-debt',
    'monolean-help',
    // The canonical workflow list comes from the manifest. Keep the wildcard
    // for supplementary legacy workflows that continue to ship during M1;
    // copySkills expands and de-duplicates both sources deterministically.
    ...CANONICAL_MASTERMIND_SKILLS,
    'mastermind-*',
  ],
  browser: ['agent-browser-testing'],
  // NOTE: memory-toolkit and github-toolkit are single consolidated skills
  // (not one skill per capability) — see .claude/skills/memory-toolkit and
  // .claude/skills/github-toolkit. The finer-grained names previously listed
  // here (memory-advanced, github-code-review, etc.) never had matching
  // source directories and silently copied nothing.
  memory: ['memory-toolkit'],
  github: ['github-toolkit'],
  advanced: ['agentic-jujutsu', 'performance-analysis'],
};

/**
 * Commands to copy based on configuration
 */
export const COMMANDS_MAP: Record<string, string[]> = {
  core: ['mastermind.md', 'tokens.md', 'monobrowse.md', 'ts.md'],
  agents: ['agents'],
  analysis: ['analysis'],
  automation: ['automation'],
  coordination: ['coordination'],
  github: ['github'],
  monoswarm: ['monoswarm'],
  hooks: ['hooks'],
  mastermind: ['mastermind'],
  memory: ['memory'],
  monitoring: ['monitoring'],
  monograph: ['monograph'],
  monomind: ['mastermind'],
  optimization: ['optimization'],
  pair: ['pair'],
  streamChain: ['stream-chain'],
  training: ['training'],
  truth: ['truth'],
  verify: ['verify'],
  workflows: ['workflows'],
};

/**
 * Agents to copy based on configuration
 */
export const AGENTS_MAP: Record<string, string[]> = {
  academic: ['academic'],
  analysis: ['analysis'],
  architecture: ['architecture'],
  consensus: ['consensus'],
  core: ['core'],
  data: ['data'],
  design: ['design'],
  development: ['development'],
  devops: ['devops'],
  documentation: ['documentation'],
  engineering: ['engineering'],
  gameDevelopment: ['game-development'],
  github: ['github'],
  goal: ['goal'],
  marketing: ['marketing'],
  neural: ['neural'],
  optimization: ['optimization'],
  paidMedia: ['paid-media'],
  payments: ['payments'],
  product: ['product'],
  projectManagement: ['project-management'],
  reasoning: ['reasoning'],
  sales: ['sales'],
  schemas: ['schemas'],
  sona: ['sona'],
  spatialComputing: ['spatial-computing'],
  specialists: ['specialists'],
  specialized: ['specialized'],
  sublinear: ['sublinear'],
  support: ['support'],
  monoswarm: ['monoswarm'],
  templates: ['templates'],
  testing: ['testing'],
};

/**
 * Directory structure to create
 */
export const DIRECTORIES = {
  claude: [
    '.claude',
    '.claude/skills',
    '.claude/commands',
    '.claude/agents',
    '.claude/helpers',
    '.gemini',
    '.gemini/skills',
    '.gemini/rules',
    '.gemini/helpers',
    '.agents',
    '.agents/skills',
  ],
  runtime: [
    '.monomind',
    '.monomind/data',
    '.monomind/logs',
    '.monomind/sessions',
    '.monomind/hooks',
    '.monomind/agents',
    '.monomind/workflows',
  ],
};

/**
 * Provenance manifest for generated .claude content.
 *
 * init used to "clean stale" entries by deleting every name under
 * .claude/{skills,commands,agents} that was absent from the current version's
 * SKILLS_MAP/COMMANDS_MAP/AGENTS_MAP. Every user-authored command and skill is
 * absent from those maps, so that pass deleted user content on the very first
 * run — unrecoverable data loss.
 *
 * The manifest records exactly which entries *this tool* wrote, so the stale
 * sweep can be restricted to those. Anything init did not write is never
 * removed. Projects initialised by an older version have no manifest, so their
 * first run under the fix deletes nothing and seeds the manifest instead;
 * stale generated content may survive one extra run, which is the correct
 * trade (preserving stale generated content is recoverable, deleting user
 * content is not).
 */
export const INIT_MANIFEST_REL = path.join('.monomind', 'init-manifest.json');

/**
 * One retired entry's provenance (o-38): a name the manifest recorded that
 * this version no longer ships, moved to `movedTo` instead of deleted.
 * Appended-only — a later run's `recordGenerated` never drops this array, so
 * the run after next can still tell a user what was retired and where it went.
 */
export interface RetiredEntry {
  /** The manifest section for a `.claude`/`.kimi-code` entry (an
   *  `InitManifestSection` value), or a descriptive label for a mirror
   *  retirement (e.g. `gemini-skills`) — mirrors have no manifest section
   *  of their own, so this is an audit-trail label, not a lookup key. */
  section: string;
  name: string;
  /** Path (relative to targetDir) the entry was moved to. */
  movedTo: string;
  /** ISO timestamp of the retirement. */
  at: string;
}

export interface InitManifest {
  version: number;
  /** Entry names directly under .claude/skills that init generated. */
  skills: string[];
  /** Entry names directly under .claude/commands that init generated. */
  commands: string[];
  /** Entry names (category dirs) directly under .claude/agents that init generated. */
  agents: string[];
  /** Directory names directly under .kimi-code/skills that init generated. */
  kimiSkills: string[];
  /** File names directly under .kimi-code/plugin/commands that init generated. */
  kimiPluginCommands: string[];
  /** Directory names directly under .opencode/skills that init generated.
   *  Absent in manifests written before this field existed; normalised to
   *  an empty list on read, which the sweep treats as "delete nothing". */
  opencodeSkills: string[];
  /** Every entry ever retired (o-38) — see `RetiredEntry`. Absent on a
   *  manifest written before this field existed; treated as empty. */
  retired?: RetiredEntry[];
}

export type InitManifestSection =
  | 'skills'
  | 'commands'
  | 'agents'
  | 'kimiSkills'
  | 'kimiPluginCommands'
  | 'opencodeSkills';

/**
 * Read the provenance manifest. Returns null when absent or unreadable —
 * callers must treat that as "provenance unknown", i.e. delete nothing.
 */
export function readInitManifest(targetDir: string): InitManifest | null {
  const manifestPath = path.join(targetDir, INIT_MANIFEST_REL);
  try {
    if (!fs.existsSync(manifestPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      skills: Array.isArray(parsed.skills)
        ? parsed.skills.filter((s: unknown) => typeof s === 'string')
        : [],
      commands: Array.isArray(parsed.commands)
        ? parsed.commands.filter((s: unknown) => typeof s === 'string')
        : [],
      agents: Array.isArray(parsed.agents)
        ? parsed.agents.filter((s: unknown) => typeof s === 'string')
        : [],
      kimiSkills: Array.isArray(parsed.kimiSkills)
        ? parsed.kimiSkills.filter((s: unknown) => typeof s === 'string')
        : [],
      kimiPluginCommands: Array.isArray(parsed.kimiPluginCommands)
        ? parsed.kimiPluginCommands.filter((s: unknown) => typeof s === 'string')
        : [],
      opencodeSkills: Array.isArray(parsed.opencodeSkills)
        ? parsed.opencodeSkills.filter((s: unknown) => typeof s === 'string')
        : [],
      retired: Array.isArray(parsed.retired)
        ? parsed.retired.filter(
            (r: unknown): r is RetiredEntry =>
              !!r &&
              typeof r === 'object' &&
              typeof (r as RetiredEntry).section === 'string' &&
              typeof (r as RetiredEntry).name === 'string' &&
              typeof (r as RetiredEntry).movedTo === 'string' &&
              typeof (r as RetiredEntry).at === 'string',
          )
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Names init previously generated in one section. Empty set when no manifest
 * exists — which makes the stale sweep a no-op rather than a delete-everything.
 */
export function previouslyGenerated(targetDir: string, section: InitManifestSection): Set<string> {
  return new Set(readInitManifest(targetDir)?.[section] ?? []);
}

/**
 * Record the entries init just wrote for one section, merging into any
 * existing manifest so a partial run (e.g. --only-claude, or a section whose
 * source dir was missing) never drops provenance for the other sections.
 */
export function recordGenerated(
  targetDir: string,
  section: InitManifestSection,
  entries: string[],
): void {
  const manifestPath = path.join(targetDir, INIT_MANIFEST_REL);
  const existing = readInitManifest(targetDir);
  const manifest: InitManifest = existing ?? {
    version: 1,
    skills: [],
    commands: [],
    agents: [],
    kimiSkills: [],
    kimiPluginCommands: [],
    opencodeSkills: [],
  };
  manifest.version = 1;
  manifest[section] = [...new Set(entries)].sort();
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    atomicWriteFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch {
    // Non-fatal: without a manifest the next run simply deletes nothing.
  }
}

/**
 * Append one retirement to the manifest's `retired` array (o-38). A separate
 * read-modify-write from `recordGenerated`'s, deliberately: `recordGenerated`
 * REPLACES one section's active-entry list, and calling it after every single
 * retirement (the stale-sweep loop can retire several names) would be wrong.
 * This only ever appends, and appending here happens before the sweep's
 * `recordGenerated` call, so `retired` survives that call's read of the
 * manifest — `recordGenerated` never touches this field.
 */
function appendRetiredProvenance(targetDir: string, entry: RetiredEntry): void {
  const manifestPath = path.join(targetDir, INIT_MANIFEST_REL);
  const existing = readInitManifest(targetDir);
  const manifest: InitManifest = existing ?? {
    version: 1,
    skills: [],
    commands: [],
    agents: [],
    kimiSkills: [],
    kimiPluginCommands: [],
    opencodeSkills: [],
    retired: [],
  };
  manifest.retired = [...(manifest.retired ?? []), entry];
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    atomicWriteFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch {
    // Non-fatal, same as recordGenerated: the retire itself already
    // succeeded (the file is safe); only the audit trail entry is lost.
  }
}

// One shared retire-destination root per init run, keyed by the run's own
// InitResult object (created once per `executeInit` call) rather than
// targetDir — safe under concurrent/sequential runs against different
// targetDirs in the same process (e.g. a test suite), and lets every
// retirement in a run land under one timestamped directory instead of a
// different one per call.
const retireRoots = new WeakMap<InitResult, string>();

function getRetireRoot(targetDir: string, result: InitResult): string {
  let root = retireRoots.get(result);
  if (!root) {
    root = path.join(targetDir, '.monomind', 'backups', `${Date.now()}-${process.pid}`, 'retired');
    retireRoots.set(result, root);
  }
  return root;
}

/**
 * Retire a generated entry instead of deleting it (o-38): a name the
 * manifest recorded that this version no longer ships anywhere is moved to
 * `.monomind/backups/<run-timestamp>-<pid>/retired/<label>/` rather than
 * `rmSync`-ed. The manifest's granularity is per-top-level-entry — "did init
 * ever generate this name" — not per-file, so a stale-sweep candidate can
 * still hold user files added since (a note beside a retired skill, e.g.)
 * that must survive byte-identical.
 *
 * `label` doubles as the retirement's section plus display name, e.g.
 * `skills/my-retired-skill` — the first path segment is an
 * `InitManifestSection` value for the five real call sites, or a
 * descriptive mirror label (`gemini-skills`, `agents-skills`,
 * `opencode-skills`) for a mirror copy that turned out to hold user-added
 * content (see `copySkills` / `writeOpencodeFiles`).
 *
 * On any failure, the entry is LEFT IN PLACE and a warning is recorded in
 * `result.errors` — this must never fall back to deleting; a fix that
 * deletes when the move fails is the original bug with extra steps.
 */
export function retireGeneratedEntry(
  targetDir: string,
  label: string,
  stalePath: string,
  result: InitResult,
): void {
  const sepIndex = label.indexOf('/');
  const section = sepIndex === -1 ? label : label.slice(0, sepIndex);
  const name = sepIndex === -1 ? label : label.slice(sepIndex + 1);
  const dest = path.join(getRetireRoot(targetDir, result), label);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.renameSync(stalePath, dest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      fs.cpSync(stalePath, dest, { recursive: true });
      fs.rmSync(stalePath, { recursive: true, force: true });
    }
    const movedTo = path.relative(targetDir, dest);
    result.removed.push(`[retired] ${label} → ${movedTo}`);
    appendRetiredProvenance(targetDir, { section, name, movedTo, at: new Date().toISOString() });
  } catch (error) {
    result.errors.push(
      `Could not retire ${label} (left in place): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Every skill name this version ships, across ALL `SKILLS_MAP` sections —
 * unlike the run's `skillsToCopy` selection (filtered by
 * `options.skills.{core,memory,github,browser,advanced,all}`), this ignores
 * what the user asked for THIS run entirely. o-38: the stale sweep must ask
 * "does this version still ship X" and never "did the user select X this
 * run" — the two questions were conflated, so `--minimal` (a documented
 * flag, no upgrade required) deleted every previously-installed skill
 * outside the minimal set, user files inside included. `mastermind-*`
 * expands against `sourceSkillsDir` exactly as `copySkills`'s own expansion
 * does — the two must agree, or a name real to one and not the other would
 * either wrongly survive as "shipped" or wrongly retire as "gone".
 */
export function allShippedSkills(sourceSkillsDir: string): Set<string> {
  const shipped = new Set<string>();
  for (const entry of new Set(Object.values(SKILLS_MAP).flat())) {
    if (!entry.endsWith('*')) {
      shipped.add(entry);
      continue;
    }
    const prefix = entry.slice(0, -1);
    if (!fs.existsSync(sourceSkillsDir)) continue;
    for (const name of fs.readdirSync(sourceSkillsDir)) {
      if (name.startsWith(prefix) && fs.existsSync(path.join(sourceSkillsDir, name, 'SKILL.md'))) {
        shipped.add(name);
      }
    }
  }
  return shipped;
}

/** Every command name this version ships, across ALL `COMMANDS_MAP`
 *  sections — see `allShippedSkills`'s doc comment; `COMMANDS_MAP` has no
 *  glob entries, so this is a plain flatten. */
export function allShippedCommands(): Set<string> {
  return new Set(Object.values(COMMANDS_MAP).flat());
}

/** Every agent category name this version ships, across ALL `AGENTS_MAP`
 *  sections — see `allShippedSkills`'s doc comment; `AGENTS_MAP` has no
 *  glob entries, so this is a plain flatten. */
export function allShippedAgents(): Set<string> {
  return new Set(Object.values(AGENTS_MAP).flat());
}

/**
 * Find source helpers directory.
 * Validates that the directory contains hook-handler.cjs AND its required
 * subdirectory files (utils/telemetry.cjs etc.) to avoid accepting a partial
 * or corrupted source that would reproduce the missing-utils/ bug class.
 */
export function findSourceHelpersDir(sourceBaseDir?: string): string | null {
  const possiblePaths: string[] = [];
  // All sentinel files must exist — hook-handler.cjs requires these at startup
  const SENTINEL_FILES = [
    'hook-handler.cjs',
    path.join('utils', 'telemetry.cjs'),
    path.join('utils', 'monograph.cjs'),
    path.join('utils', 'micro-agents.cjs'),
  ];

  // If explicit source base directory is provided, check it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude', 'helpers'));
  }

  // Strategy 1: require.resolve to find package root (most reliable for npx)
  // Try both published package names (@monoes/monomindcli is the scoped CLI package,
  // monomind is the umbrella — neither is @monomind/cli which is the monorepo name only)
  for (const pkgName of [
    '@monoes/monomindcli/package.json',
    'monomind/packages/@monomind/cli/package.json',
    '@monomind/cli/package.json',
  ]) {
    try {
      const esmRequire = createRequire(import.meta.url);
      const pkgJsonPath = esmRequire.resolve(pkgName);
      const pkgRoot = path.dirname(pkgJsonPath);
      possiblePaths.push(path.join(pkgRoot, '.claude', 'helpers'));
      break;
    } catch {
      // Not installed under this name — try next
    }
  }

  // Strategy 2: __dirname-based (dist/src/init -> package root)
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageHelpers = path.join(packageRoot, '.claude', 'helpers');
  possiblePaths.push(packageHelpers);

  // Strategy 3: Walk up from __dirname looking for package root
  let currentDir = __dirname;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // hit filesystem root
    const helpersPath = path.join(parentDir, '.claude', 'helpers');
    possiblePaths.push(helpersPath);
    currentDir = parentDir;
  }

  // NOTE: deliberately no cwd-ancestor-search fallback here (removed — see
  // docs/AUDIT-BACKLOG.md P3-25). Searching process.cwd() and its parents for
  // ".claude/helpers" could pick up an unrelated project's own helper scripts
  // (stale, customized, or untrusted) when `monomind init` is run from a
  // nested subdirectory of some other checkout. Helper source resolution is
  // restricted to the package's own bundled location(s) above; if none of
  // those are found, callers should treat it as a corrupt install rather than
  // silently falling back to scanning ancestor directories for someone else's
  // files.

  // Return first path that exists AND contains ALL sentinel files
  for (const p of possiblePaths) {
    if (fs.existsSync(p) && SENTINEL_FILES.every((f) => fs.existsSync(path.join(p, f)))) {
      return p;
    }
  }

  return null;
}

/** Helper-dir files generated per project, never copied from the package:
 *  a shipped skill index lists the package's skills, not the project's. */
export const GENERATED_HELPERS = new Set(['skill-registry.json']);

/**
 * (Re)generates `<targetDir>/.claude/helpers/skill-registry.json` from the
 * project's skill trees, ~/.claude/skills and the Org library, with the
 * package's bundled builder. Returns false when the builder is unavailable.
 */
export function regenerateSkillIndex(targetDir: string, sourceHelpersDir?: string | null): boolean {
  const dir = sourceHelpersDir ?? findSourceHelpersDir();
  const builder = dir ? path.join(dir, 'build-skill-registry.cjs') : '';
  if (!builder || !fs.existsSync(builder)) return false;
  try {
    const mod = createRequire(import.meta.url)(builder) as { write(root: string): unknown };
    mod.write(targetDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find source .claude directory for statusline files
 */
export function findSourceClaudeDir(sourceBaseDir?: string): string | null {
  const possiblePaths: string[] = [];

  // If explicit source base directory is provided, check it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude'));
  }

  // IMPORTANT: Check the package's own .claude directory
  // Go up 3 levels: dist/src/init -> dist/src -> dist -> root
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageClaude = path.join(packageRoot, '.claude');
  if (fs.existsSync(packageClaude)) {
    possiblePaths.unshift(packageClaude); // Add to beginning (highest priority)
  }

  // From dist/src/init -> go up to project root
  let currentDir = __dirname;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    const claudePath = path.join(parentDir, '.claude');
    if (fs.existsSync(claudePath)) {
      possiblePaths.push(claudePath);
    }
    currentDir = parentDir;
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Find source directory for skills/commands/agents
 */
export function findSourceDir(
  type: 'skills' | 'commands' | 'agents',
  sourceBaseDir?: string,
): string | null {
  // Build list of possible paths to check
  const possiblePaths: string[] = [];

  // If explicit source base directory is provided, use it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude', type));
  }

  // IMPORTANT: Check the package's own .claude directory first
  // This is the primary path when running as an npm package
  // __dirname is typically /path/to/node_modules/@monomind/cli/dist/src/init
  // We need to go up 3 levels to reach the package root (dist/src/init -> dist/src -> dist -> root)
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageDotClaude = path.join(packageRoot, '.claude', type);
  if (fs.existsSync(packageDotClaude)) {
    possiblePaths.unshift(packageDotClaude); // Add to beginning (highest priority)
  }

  // From dist/src/init -> go up to project root
  const distPath = __dirname;

  // Try to find the project root by looking for .claude directory
  let currentDir = distPath;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    const dotClaudePath = path.join(parentDir, '.claude', type);
    if (fs.existsSync(dotClaudePath)) {
      possiblePaths.push(dotClaudePath);
    }
    currentDir = parentDir;
  }

  // Also check relative to process.cwd() for development
  const cwdBased = [
    path.join(process.cwd(), '.claude', type),
    path.join(process.cwd(), '..', '.claude', type),
    path.join(process.cwd(), '..', '..', '.claude', type),
  ];
  possiblePaths.push(...cwdBased);

  // Check v2 directory for agents
  if (type === 'agents') {
    possiblePaths.push(
      path.join(process.cwd(), 'v2', '.claude', type),
      path.join(process.cwd(), '..', 'v2', '.claude', type),
    );
  }

  // Plugin directory
  possiblePaths.push(
    path.join(process.cwd(), 'plugin', type),
    path.join(process.cwd(), '..', 'plugin', type),
  );

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/** Relative file paths under `dir` (files only). Used by every o-38 mirror
 *  sweep (copySkills's `.gemini`/`.agents`, writeOpencodeFiles's
 *  `.opencode/skills`) to tell "content the source regenerated" from "a file
 *  someone added directly inside the mirror" (o-38 §2·0b). */
export function listFilesRecursive(dir: string): Set<string> {
  const out = new Set<string>();
  if (!fs.existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.add(path.relative(dir, full));
    }
  };
  walk(dir);
  return out;
}

/**
 * Copy directory recursively
 */
export function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    // Skip exFAT/macOS AppleDouble junk files (e.g. "._foo.js") so they don't
    // get perpetuated into every newly-initialized project.
    if (entry.name.startsWith('._')) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Count files with extension in directory
 */
export function countFiles(dir: string, ext: string): number {
  let count = 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      count += countFiles(fullPath, ext);
    } else if (entry.name.endsWith(ext)) {
      count++;
    }
  }

  return count;
}

/** Recursively collect .md files under dir, returned relative to dir. */
export function walkMdFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}${path.sep}${e.name}` : e.name;
      if (e.isDirectory()) visit(path.join(d, e.name), rel);
      else if (e.isFile() && /\.md$/i.test(e.name)) out.push(rel);
    }
  };
  visit(dir, '');
  return out;
}

/** Skip READMEs and other non-definition markdown. */
export function isLikelyUserFile(rel: string): boolean {
  const base = path.basename(rel).toLowerCase();
  if (base === 'readme.md' || base === 'readme') return false;
  return true;
}

/** Pull the `name:` scalar from a frontmatter block (best-effort). */
export function extractFmName(md: string): string | null {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!m) return null;
  const fm = m[0];
  const nm = fm.match(/^name\s*:\s*(.+?)\s*$/m);
  return nm ? nm[1].replace(/^["']|["']$/g, '') : null;
}

// The managed-block merge primitive lives in its own module — it grew the
// legacy-content migration for GH #276. Re-exported here so the existing
// `from './shared.js'` import sites keep working.
export { mergeGeneratedBlock } from './managed-block.js';
