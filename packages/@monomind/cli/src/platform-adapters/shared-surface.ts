/**
 * Skill roots several platforms declare at one path. `.agents/skills` is the
 * portable root for codex, kimi, opencode, gemini, cursor and more, so each
 * file there is written by every one of those adapters. It is co-owned: the
 * ledger records the platforms installed into it, and a file goes only with
 * the last of them. Older versions wrapped each file in a `skills:agents:<name>`
 * block (before that, one `skills:<platform>:<name>` copy per platform); those
 * markers are still read so such files migrate.
 */

import { existsSync, readFileSync } from 'node:fs';
import { intentLocation } from './locations.js';
import { hasManagedMarker, removeManagedMarker } from './merge.js';
import { addSurfaceOwners, withMutationLock } from './mutation.js';
import { applyIntents, planInstall } from './operations.js';
import { PLATFORM_IDS, PLATFORM_REGISTRY } from './registry.js';
import type {
  ArtifactIntent,
  InstallRequest,
  InstallScope,
  OwnedFileWriter,
  PlatformAdapter,
  PlatformId,
} from './types.js';

export interface SharedSkillSurface {
  /** Marker namespace for the shared root: `.agents/skills` -> `agents`. */
  id: string;
  platforms: readonly PlatformId[];
}

/** The skill root this adapter shares with other platforms, if any. */
export function sharedSkillSurface(
  adapter: PlatformAdapter,
  scope: InstallScope,
): SharedSkillSurface | undefined {
  const own = adapter.paths.locations.skill?.[scope];
  if (own === undefined || typeof own === 'string') return undefined;
  const platforms = PLATFORM_IDS.filter((id) => {
    const location = PLATFORM_REGISTRY[id].paths.locations.skill?.[scope];
    return typeof location === 'object' && location.path === own.path;
  });
  if (platforms.length < 2) return undefined;
  return { id: own.path.split('/')[0]!.replace(/^\./, ''), platforms };
}

/** The platform a superseded `skills:<platform>:<name>` marker belonged to. */
function supersededOwner(marker: string): string | undefined {
  return marker.split(':')[1];
}

/** Platforms whose pre-surface block for this co-owned artifact is in `content`. */
function legacyOwnersIn(content: string, intent: ArtifactIntent): string[] {
  return (intent.supersedes ?? [])
    .filter((marker) => hasManagedMarker(content, marker))
    .flatMap((marker) => supersededOwner(marker) ?? []);
}

/**
 * Co-owners known only from their pre-surface blocks. Read before an apply
 * folds those blocks away, or the ownership they record is lost.
 */
export function legacySurfaceOwners(
  intents: readonly ArtifactIntent[],
  pathOf: (intent: ArtifactIntent) => string | undefined,
): string[] {
  return intents.flatMap((intent) => {
    const path = intent.supersedes && pathOf(intent);
    if (!path || !existsSync(path)) return [];
    return legacyOwnersIn(readFileSync(path, 'utf8'), intent);
  });
}

/**
 * Uninstall of one platform from a co-owned artifact: its own pre-surface
 * block always goes, the shared block only when no other platform still
 * installs into the surface (per the ledger or a remaining legacy block).
 */
export function releaseSharedBlock(
  content: string,
  intent: ArtifactIntent,
  platform: PlatformId,
  coOwners: readonly string[],
): string {
  const own = intent.supersedes?.find((marker) => supersededOwner(marker) === platform);
  const released = own ? removeManagedMarker(content, own) : content;
  if (coOwners.length || legacyOwnersIn(released, intent).length || !intent.marker) return released;
  return removeManagedMarker(released, intent.marker);
}

/**
 * Collapses per-platform blocks left in a project's shared skill roots by an
 * install that predates co-owned blocks. `init upgrade` installs no platform,
 * so it calls this directly; only files that still hold a superseded block are
 * rewritten (with a backup), and the platforms those blocks named are recorded
 * as the surface's owners.
 */
export async function foldLegacySharedSkills(
  root: string,
  fileGuard?: OwnedFileWriter,
): Promise<string[]> {
  const changed: string[] = [];
  const folded = new Set<string>();
  for (const platform of PLATFORM_IDS) {
    const request: InstallRequest = { platform, scope: 'project', path: root, fileGuard };
    const shared = (await planInstall(request)).intents.filter((intent) => intent.supersedes);
    const surface = shared[0]?.surface;
    if (!surface || folded.has(surface)) continue;
    folded.add(surface);
    const adapter = PLATFORM_REGISTRY[platform];
    const pathOf = (intent: ArtifactIntent) => intentLocation(adapter, intent, request)?.path;
    const stale = shared.filter((intent) => legacySurfaceOwners([intent], pathOf).length);
    if (!stale.length) continue;
    withMutationLock(request, () => {
      const owners = legacySurfaceOwners(stale, pathOf);
      changed.push(...applyIntents(adapter, stale, request).changed);
      addSurfaceOwners(request, surface, owners);
    });
  }
  return changed;
}
