import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './fs-helpers.js';
import type { InitResult } from './types.js';

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
  /** sha256 of each shipped file as init last left it, keyed by its
   *  project-relative path — how a later run tells a user edit from an
   *  untouched install (see file-guard.ts). */
  files?: Record<string, string>;
  /** sha256 of each managed block's body as init last wrote it, keyed
   *  `<file>#<marker>` (see file-guard.ts). */
  blocks?: Record<string, string>;
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
      files: stringRecord(parsed.files),
      blocks: stringRecord(parsed.blocks),
    };
  } catch {
    return null;
  }
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** Replace the manifest's `files` or `blocks` hash map, keeping every other
 *  field (see file-guard.ts). */
export function recordManifestHashes(
  targetDir: string,
  field: 'files' | 'blocks',
  hashes: Record<string, string>,
): void {
  const manifestPath = path.join(targetDir, INIT_MANIFEST_REL);
  const manifest: InitManifest = readInitManifest(targetDir) ?? {
    version: 1,
    skills: [],
    commands: [],
    agents: [],
    kimiSkills: [],
    kimiPluginCommands: [],
    opencodeSkills: [],
  };
  manifest[field] = Object.fromEntries(
    Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)),
  );
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    atomicWriteFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch {
    // Non-fatal: without hashes the next run treats these files as unrecorded.
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
