/**
 * `owned_file` intents: files Monomind ships whole — the Mastermind skills and
 * their reference files. Older versions wrapped each in a
 * `skills:<owner>:<name>` marker block to claim it, which made every install
 * rewrite files whose content had not changed (GH #344). Ownership now comes
 * from the init manifest's file hashes, through the same guard init uses for
 * every other shipped file: an untouched install is refreshed, one the user
 * edited is kept with the new version beside it, and a file an older version
 * marked is recognised by its content once that markup is ignored.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { NEW_VERSION_SUFFIX } from '../init/file-guard.js';
import { readInitManifest } from '../init/init-manifest.js';
import { hasManagedMarker, skillName } from './merge.js';
import { backup } from './mutation.js';
import type {
  ArtifactIntent,
  InstallRequest,
  OwnedFileWriter,
  ResolvedArtifactLocation,
} from './types.js';

export interface OwnedFileResult {
  changed?: string;
  skipped?: string;
  diagnostics: string[];
}

/** Write `intent.content` as the whole file, unless the user edited it. */
export function applyOwnedFile(
  location: ResolvedArtifactLocation,
  intent: ArtifactIntent,
  dryRun: boolean,
  writer: () => OwnedFileWriter,
): OwnedFileResult {
  const display = location.displayPath;
  const old = existsSync(location.path) ? readFileSync(location.path, 'utf8') : undefined;
  if (old === intent.content) return { skipped: display, diagnostics: [] };
  const name = location.path.endsWith('SKILL.md') ? skillName(intent.content) : undefined;
  if (old !== undefined && name && skillName(old) !== name)
    return {
      skipped: display,
      diagnostics: [`ERROR: foreign SKILL.md prevents installing ${name}`],
    };
  if (dryRun) return { changed: display, diagnostics: [] };
  if (writer().write(location.path, intent.content) !== 'kept')
    return { changed: display, diagnostics: [] };
  return {
    skipped: display,
    diagnostics: [
      `${display}: kept because it was edited; the new version is beside it as ${display}${NEW_VERSION_SUFFIX}`,
    ],
  };
}

/** Whether `content` still holds a block an older version wrapped this file in. */
export function hasLegacyOwnership(content: string, intent: ArtifactIntent): boolean {
  return [intent.marker, ...(intent.supersedes ?? [])].some(
    (marker) => marker !== undefined && hasManagedMarker(content, marker),
  );
}

/** Whether the file at `path` is exactly what Monomind shipped or last wrote. */
function isUnedited(root: string, path: string, intent: ArtifactIntent): boolean {
  const content = readFileSync(path, 'utf8');
  if (content === intent.content) return true;
  const rel = relative(root, path).split(sep).join('/');
  const recorded = readInitManifest(root)?.files?.[rel];
  return recorded === createHash('sha256').update(content).digest('hex');
}

/** Uninstall: remove the file (after a backup) unless the user edited it. */
export function releaseOwnedFile(
  root: string,
  path: string,
  intent: ArtifactIntent,
  request: Pick<InstallRequest, 'dryRun' | 'scope'>,
): boolean {
  if (!isUnedited(root, path, intent)) return false;
  if (!request.dryRun) {
    backup(path, root, request.scope === 'user');
    unlinkSync(path);
  }
  return true;
}
