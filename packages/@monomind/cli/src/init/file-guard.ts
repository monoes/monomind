/**
 * Edit-preserving writes for what init ships into a project.
 *
 * Files (skills, agents, commands, helpers), keyed by project-relative path
 * against the sha256 recorded in `.monomind/init-manifest.json` `files`:
 *  - missing, or already identical to the new content: written / left;
 *  - exactly what monomind left there last time: an untouched install, so it
 *    is replaced with the new version;
 *  - different from what monomind left: the user edited it. It is kept, the
 *    new version is written beside it as `<file>.monomind-new`, and the run
 *    reports it. `--force` does not change this;
 *  - never recorded (installed before hashes existed): provenance unknown. A
 *    file that matches the new version once ownership-marker lines and blank
 *    lines are ignored is adopted. Otherwise it is kept like an edit, unless
 *    the caller replaces unrecorded files (`init --force`, and `init upgrade`
 *    for helpers), in which case it is first copied to the run's backup
 *    directory `.monomind/backups/<run>/`.
 * Hashes are taken at the end of the run (`finalize`), because platform
 * adapters and doctor rewrite some of these files after they are copied.
 *
 * Managed blocks (CLAUDE.md, AGENTS.md, GEMINI.md, shared_instructions.md),
 * keyed `<file>#<marker>` in `blocks`: a block whose body differs from what
 * monomind last wrote is left alone with a warning — or, under `--force`,
 * backed up and replaced, and the run says so.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backup } from '../platform-adapters/mutation.js';
import { mergeGeneratedBlock, readGeneratedBlock } from './managed-block.js';
import { atomicWriteFile, readInitManifest, recordManifestHashes } from './shared.js';
import type { InitResult } from './types.js';

export const NEW_VERSION_SUFFIX = '.monomind-new';
/** Backup directories kept by pruneBackups (retirement ones are never pruned). */
export const BACKUPS_KEPT = 5;

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** Content with ownership-marker lines and blank lines removed, for adopting
 *  an unrecorded file that differs from the shipped one only by those. */
const withoutMarkers = (text: string): string =>
  text
    .split(/\r?\n/)
    .filter(
      (line) => line.trim() !== '' && !/^\s*(?:#|\/\/|<!--)\s*monomind:(?:start|end)\s/.test(line),
    )
    .join('\n');

export interface FileGuardOptions {
  /** Replace a differing file that has no recorded hash (after backing it up). */
  replaceUnrecorded: boolean;
  /** `--force`: replace an edited managed block (after backing it up). */
  force?: boolean;
}

export type GuardOutcome = 'written' | 'unchanged' | 'kept';

export class FileGuard {
  /** Project-relative paths kept because the user edited them. */
  readonly kept: string[] = [];
  /** Messages the run must show the user. */
  readonly warnings: string[] = [];
  readonly backupDir: string;
  private readonly files: Record<string, string>;
  private readonly blocks: Record<string, string>;
  private readonly touched = new Set<string>();

  constructor(
    readonly targetDir: string,
    private readonly options: FileGuardOptions,
  ) {
    const manifest = readInitManifest(targetDir);
    this.files = { ...(manifest?.files ?? {}) };
    this.blocks = { ...(manifest?.blocks ?? {}) };
    this.backupDir = path.join(targetDir, '.monomind', 'backups', `${Date.now()}-${process.pid}`);
  }

  private rel(file: string): string {
    return path.relative(this.targetDir, file).split(path.sep).join('/');
  }

  /** Absolute paths of the files kept this run, for installs that must skip them. */
  keptPaths(): Set<string> {
    return new Set(this.kept.map((rel) => path.join(this.targetDir, rel)));
  }

  private backup(file: string): string {
    const copy = backup(file, this.targetDir, false, this.backupDir);
    return copy ? this.rel(copy) : this.rel(this.backupDir);
  }

  /** Write `content` to `dest` unless that would overwrite a user edit. */
  write(dest: string, content: string | Buffer, mode?: number): GuardOutcome {
    const rel = this.rel(dest);
    const next = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const newVersion = `${dest}${NEW_VERSION_SUFFIX}`;
    let outcome: GuardOutcome = 'written';
    if (fs.existsSync(dest)) {
      const disk = fs.readFileSync(dest);
      const recorded = this.files[rel];
      if (disk.equals(next)) outcome = 'unchanged';
      else if (recorded ? sha256(disk) !== recorded : !this.adoptable(disk, next, dest)) {
        atomicWriteFile(newVersion, next);
        if (!this.kept.includes(rel)) this.kept.push(rel);
        return 'kept';
      }
    }
    if (outcome === 'written') {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      atomicWriteFile(dest, next);
      if (mode !== undefined) fs.chmodSync(dest, mode);
    }
    this.files[rel] = sha256(next);
    this.touched.add(rel);
    if (fs.existsSync(newVersion)) fs.rmSync(newVersion);
    return outcome;
  }

  /** An unrecorded file may be replaced: it is ours modulo markers, or the
   *  caller replaces unrecorded files and a backup was taken first. */
  private adoptable(disk: Buffer, next: Buffer, dest: string): boolean {
    if (withoutMarkers(disk.toString('utf-8')) === withoutMarkers(next.toString('utf-8')))
      return true;
    if (!this.options.replaceUnrecorded) return false;
    this.warnings.push(
      `${this.rel(dest)}: replaced; your previous copy is in ${this.backup(dest)}`,
    );
    return true;
  }

  copyFile(src: string, dest: string): GuardOutcome {
    return this.write(dest, fs.readFileSync(src), fs.statSync(src).mode & 0o777);
  }

  /** copyDirRecursive through the guard. */
  copyDir(src: string, dest: string): void {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      // Skip exFAT/macOS AppleDouble junk files (e.g. "._foo.js").
      if (entry.name.startsWith('._')) continue;
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) this.copyDir(from, to);
      else this.copyFile(from, to);
    }
  }

  /**
   * The content to write for `file` with `generated` merged into its
   * `marker` block, or null when the block was edited and must be kept.
   */
  mergeBlock(file: string, existing: string, marker: string, generated: string): string | null {
    const key = `${this.rel(file)}#${marker}`;
    const body = readGeneratedBlock(existing, marker);
    const recorded = this.blocks[key];
    if (body !== null && recorded && sha256(body) !== recorded) {
      if (!this.options.force) {
        this.warnings.push(
          `${this.rel(file)}: text inside the monomind-block:${marker} markers was edited — left as is. ` +
            'Move your text outside the markers; `init --force` replaces the block (with a backup).',
        );
        return null;
      }
      this.warnings.push(
        `${this.rel(file)}: edited monomind-block:${marker} replaced (--force); previous file in ${this.backup(file)}`,
      );
    } else if (body !== null && !recorded && body !== generated.trimEnd()) {
      // Written before block hashes existed: it may hold edits, so keep a copy.
      this.warnings.push(
        `${this.rel(file)}: monomind-block:${marker} differed from the generated text and was refreshed; previous file in ${this.backup(file)}`,
      );
    }
    const merged = mergeGeneratedBlock(existing, marker, generated);
    this.blocks[key] = sha256(readGeneratedBlock(merged, marker) ?? '');
    recordManifestHashes(this.targetDir, 'blocks', this.blocks);
    return merged;
  }

  /** Record hashes for what was written; call once every writer has run. */
  finalize(): void {
    for (const rel of this.touched) {
      const file = path.join(this.targetDir, rel);
      if (fs.existsSync(file)) this.files[rel] = sha256(fs.readFileSync(file));
    }
    recordManifestHashes(this.targetDir, 'files', this.files);
  }

  /** Persist hashes now (a writer called outside a full run has no finalize). */
  flush(): void {
    recordManifestHashes(this.targetDir, 'files', this.files);
  }
}

const guards = new WeakMap<InitResult, FileGuard>();

/** The run's guard, created on first use. */
export function guardFor(
  targetDir: string,
  options: { force?: boolean; preserveEdits?: boolean },
  result: InitResult,
): FileGuard {
  let guard = guards.get(result);
  if (!guard) {
    guard = new FileGuard(targetDir, {
      replaceUnrecorded: options.force === true,
      force: options.force === true && options.preserveEdits !== true,
    });
    guards.set(result, guard);
  }
  return guard;
}

/** Record the run's hashes and move its kept files and warnings into `result`. */
export function finalizeGuard(result: InitResult): void {
  const guard = guards.get(result);
  if (!guard) return;
  guard.finalize();
  result.kept = [...guard.kept];
  result.warnings = [...(result.warnings ?? []), ...guard.warnings];
}

/**
 * Whether `file` is one init kept because the user edited it: a
 * `.monomind-new` copy sits beside it, or its content no longer matches the
 * hash init recorded. Other tools that refresh shipped files (doctor --fix)
 * must leave such a file alone.
 */
export function isKeptUserEdit(targetDir: string, file: string): boolean {
  if (fs.existsSync(`${file}${NEW_VERSION_SUFFIX}`)) return true;
  const rel = path.relative(targetDir, file).split(path.sep).join('/');
  const recorded = readInitManifest(targetDir)?.files?.[rel];
  try {
    return recorded !== undefined && sha256(fs.readFileSync(file)) !== recorded;
  } catch {
    return false;
  }
}

/** The warning a run prints for the files it kept, or '' when there are none. */
export function formatKeptFiles(kept: readonly string[] | undefined): string {
  if (!kept?.length) return '';
  return [
    `Kept ${kept.length} file(s) you edited; the new version of each is beside it as <file>${NEW_VERSION_SUFFIX} — merge what you want, then delete that copy:`,
    ...kept.map((rel) => `  ${rel}`),
  ].join('\n');
}

/**
 * Keep the newest `keep` backup directories. A directory holding retired
 * entries (`retired/`) is never removed: the manifest points at it and it can
 * be the only copy of a user's file.
 */
export function pruneBackups(targetDir: string, keep = BACKUPS_KEPT): string[] {
  const root = path.join(targetDir, '.monomind', 'backups');
  let names: string[];
  try {
    names = fs.readdirSync(root).filter((name) => /^\d+-\d+$/.test(name));
  } catch {
    return [];
  }
  const prunable = names
    .filter((name) => !fs.existsSync(path.join(root, name, 'retired')))
    .sort((a, b) => Number(b.split('-')[0]) - Number(a.split('-')[0]) || b.localeCompare(a));
  const removed = prunable.slice(keep);
  for (const name of removed) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  return removed;
}
