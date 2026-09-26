/** Planning and application for evidence-gated platform artifacts. */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { FileGuard } from '../init/file-guard.js';
import { intentLocation } from './locations.js';
import {
  adoptSupersededBlocks,
  type MarkerComment,
  mergeManagedBlock,
  mergeSkillFileManagedBlock,
  mergeSkillManagedBlock,
  readManagedBlock,
  removeManagedMarker,
  safeJsonMerge,
  safeJsonRemove,
} from './merge.js';
import { migrateLegacyArtifacts } from './migration.js';
import {
  addSurfaceOwners,
  atomicWrite,
  backup,
  dropSurfaceOwner,
  withMutationLock,
} from './mutation.js';
import { applyOwnedFile, hasLegacyOwnership, releaseOwnedFile } from './owned-files.js';
import { PLATFORM_IDS, PLATFORM_REGISTRY } from './registry.js';
import { getRenderer } from './renderers/index.js';
import { legacySurfaceOwners, releaseSharedBlock } from './shared-surface.js';
import type {
  ApplyResult,
  ArtifactIntent,
  InstallRequest,
  MutationRequest,
  OwnedFileWriter,
  PlatformAdapter,
  PlatformPlan,
  ResolvedArtifactLocation,
} from './types.js';

function assertMutationAuthorized(request: Pick<InstallRequest, 'scope' | 'yes'>): void {
  if (request.scope === 'user' && request.yes !== true) {
    throw new Error('User-scope mutation requires --scope user --yes');
  }
}

export async function planInstall(request: InstallRequest): Promise<PlatformPlan> {
  const adapter = PLATFORM_REGISTRY[request.platform];
  return getRenderer(request.platform).render(adapter, request);
}

function isSkillPackage(intent: ArtifactIntent): boolean {
  return intent.kind === 'skill' && (intent.relativePath ?? '').endsWith('/SKILL.md');
}

function markerComment(location: ResolvedArtifactLocation, marker = ''): MarkerComment {
  // Catalog projections keep the `#` form: build-skill-registry.cjs reads the
  // line `# monomind:start catalog:<id>` literally.
  if (marker.startsWith('catalog:')) return '#';
  if (location.format === 'md' || location.path.endsWith('.md')) return 'html';
  return location.format === 'js' ? '//' : '#';
}

function isEmptyOwnedSkillFile(content: string, intent: ArtifactIntent): boolean {
  if (intent.kind !== 'skill') return false;
  if (!isSkillPackage(intent)) return content.trim().length === 0;
  const frontmatter = content.match(/^---\n[\s\S]*?\n---\n/);
  return frontmatter !== null && content.slice(frontmatter[0].length).trim().length === 0;
}

function applyIntent(
  adapter: PlatformAdapter,
  intent: ArtifactIntent,
  request: InstallRequest,
  writer: () => OwnedFileWriter,
): { changed?: string; skipped?: string; diagnostics: string[] } {
  const location = intentLocation(adapter, intent, request);
  if (!location)
    return {
      skipped: `${adapter.id}:${intent.kind}`,
      diagnostics: [`No declared ${intent.kind} location for ${adapter.id}`],
    };

  if (request.protectedPaths?.has(location.path))
    return { skipped: location.displayPath, diagnostics: [] };
  if (intent.replace === 'owned_file')
    return applyOwnedFile(location, intent, request.dryRun === true, writer);
  const oldContent = existsSync(location.path) ? readFileSync(location.path, 'utf8') : '';
  let content = oldContent;
  let diagnostics: string[] = [];
  if (intent.replace === 'managed_block') {
    const marker = intent.marker ?? `${intent.kind}:${adapter.id}`;
    const base = adoptSupersededBlocks(oldContent, marker, intent.supersedes ?? []);
    if (isSkillPackage(intent)) {
      const merged = mergeSkillManagedBlock(
        base,
        marker,
        intent.content,
        markerComment(location, marker),
      );
      content = merged.content;
      diagnostics = [...merged.diagnostics];
    } else if (intent.kind === 'skill') {
      // Reference files beside a SKILL.md are wholly generated and were written
      // unwrapped before markers existed, so they need the migrating merge or a
      // second copy is appended below the first (GH #286).
      content = mergeSkillFileManagedBlock(
        base,
        marker,
        intent.content,
        markerComment(location, marker),
      );
    } else {
      const merge = (text: string): string =>
        mergeManagedBlock(text, marker, intent.content, markerComment(location, marker));
      // An instruction block the user edited is kept, as init keeps its own.
      const guarded =
        intent.kind === 'instruction' && !request.dryRun
          ? writer().guardBlock(location.path, base, marker, intent.content, {
              label: marker,
              read: (text) => readManagedBlock(text, marker),
              merge,
            })
          : merge(base);
      if (guarded === null) return { skipped: location.displayPath, diagnostics: [] };
      content = guarded;
    }
  } else if (intent.replace === 'named_entry') {
    if (location.format !== 'json') {
      return {
        skipped: location.displayPath,
        diagnostics: [
          `ERROR: safe named-entry mutation for ${location.format ?? 'unknown'} is not available`,
        ],
      };
    }
    const parsed = JSON.parse(intent.content) as unknown;
    const merged = safeJsonMerge(
      oldContent || '{}',
      intent.entryPath ?? location.entryPath ?? [],
      parsed,
    );
    content = merged.content;
    diagnostics = [...merged.diagnostics];
  } else if (!existsSync(location.path)) {
    content = intent.content;
  }
  if (diagnostics.some((diagnostic) => diagnostic.startsWith('ERROR:')))
    return { skipped: location.displayPath, diagnostics };
  if (content === oldContent) return { skipped: location.displayPath, diagnostics };
  if (!request.dryRun) {
    backup(
      location.path,
      request.scope === 'project' ? resolve(request.path ?? process.cwd()) : homedir(),
      request.scope === 'user',
      request.backupDir,
    );
    atomicWrite(location.path, content);
  }
  return { changed: location.displayPath, diagnostics };
}

export async function applyPlan(plan: PlatformPlan, request: InstallRequest): Promise<ApplyResult> {
  assertMutationAuthorized(request);
  if (plan.scope !== request.scope)
    throw new Error('Plan scope does not match mutation request scope');
  if (!plan.authorizedUserMutation)
    throw new Error('Plan is not authorized for user-scope mutation');
  const adapter = PLATFORM_REGISTRY[request.platform];
  const surface = plan.intents.find((intent) => intent.surface)?.surface;
  const result = withMutationLock(request, () => {
    const pathOf = (intent: ArtifactIntent) => intentLocation(adapter, intent, request)?.path;
    const legacy = legacySurfaceOwners(plan.intents, pathOf);
    const applied = applyIntents(adapter, plan.intents, request);
    if (surface) addSurfaceOwners(request, surface, [...legacy, adapter.id]);
    return applied;
  });
  return { ...result, diagnostics: [...plan.diagnostics, ...result.diagnostics], plan };
}

/** Applies intents without taking the lock; callers hold it (or dry-run). */
export function applyIntents(
  adapter: PlatformAdapter,
  intents: readonly ArtifactIntent[],
  request: InstallRequest,
): { changed: string[]; skipped: string[]; diagnostics: string[] } {
  const changed: string[] = [];
  const skipped: string[] = [];
  const diagnostics: string[] = [];
  // Outside init (which passes its run's guard) the install keeps its own,
  // recording what it writes in the init manifest.
  let own: FileGuard | undefined;
  const writer = () =>
    request.fileGuard ??
    (own ??= new FileGuard(mutationRoot(request), { replaceUnrecorded: false }));
  for (const intent of intents) {
    const result = applyIntent(adapter, intent, request, writer);
    if (result.changed) changed.push(result.changed);
    if (result.skipped) skipped.push(result.skipped);
    diagnostics.push(...result.diagnostics);
  }
  if (own) {
    own.flush();
    diagnostics.push(...own.warnings);
  }
  return { changed, skipped, diagnostics };
}

export async function installPlatform(request: InstallRequest): Promise<ApplyResult> {
  const plan = await planInstall(request);
  if (request.dryRun) return { changed: [], skipped: [], diagnostics: plan.diagnostics, plan };
  return applyPlan(plan, request);
}

function targets(request: MutationRequest): PlatformAdapter['id'][] {
  if (request.all) return [...PLATFORM_IDS];
  if (request.platform) return [request.platform];
  throw new Error('Specify a platform or --all');
}

function mutationRoot(request: Pick<InstallRequest, 'scope' | 'path'>): string {
  return request.scope === 'project' ? resolve(request.path ?? process.cwd()) : resolve(homedir());
}

function mergeMigrationResult(
  results: ApplyResult[],
  migration: ReturnType<typeof migrateLegacyArtifacts>,
): void {
  if (!results[0]) return;
  results[0] = {
    ...results[0],
    changed: [...results[0].changed, ...migration.changed],
    skipped: [...results[0].skipped, ...migration.skipped],
    diagnostics: [...results[0].diagnostics, ...migration.diagnostics],
  };
}

/**
 * Legacy cleanup is part of upgrade, never an unscoped side effect of update.
 * The adapter operation owns authorization, locking, and recoverable backups.
 */
function migrateUnderLock(request: MutationRequest) {
  const root = mutationRoot(request);
  return withMutationLock(request, () =>
    migrateLegacyArtifacts(root, request.scope, {
      dryRun: request.dryRun,
      removeLegacy: request.removeLegacy,
      beforeWrite: (path) => backup(path, root),
    }),
  );
}

export async function upgradePlatforms(request: MutationRequest): Promise<ApplyResult[]> {
  assertMutationAuthorized(request);
  const results: ApplyResult[] = [];
  for (const platform of targets(request))
    results.push(await installPlatform({ ...request, platform }));
  mergeMigrationResult(results, migrateUnderLock(request));
  return results;
}

export async function uninstallPlatform(request: MutationRequest): Promise<ApplyResult[]> {
  assertMutationAuthorized(request);
  const results: ApplyResult[] = [];
  for (const platform of targets(request)) {
    const plan = await planInstall({ ...request, platform });
    const adapter = PLATFORM_REGISTRY[platform];
    const changed: string[] = [];
    const skipped: string[] = [];
    const diagnostics = [...plan.diagnostics];
    const surface = plan.intents.find((intent) => intent.surface)?.surface;
    withMutationLock(request, () => {
      // A co-owned block stays while any other platform still installs into it.
      const coOwners = surface ? dropSurfaceOwner(request, surface, platform) : [];
      for (const intent of plan.intents) {
        const location = intentLocation(adapter, intent, { ...request, platform });
        if (!location || !existsSync(location.path)) {
          skipped.push(location?.displayPath ?? `${platform}:${intent.kind}`);
          continue;
        }
        const oldContent = readFileSync(location.path, 'utf8');
        let content = oldContent;
        let resultDiagnostics: readonly string[] = [];
        if (intent.replace === 'owned_file' && !hasLegacyOwnership(oldContent, intent)) {
          const removed =
            !coOwners.length &&
            releaseOwnedFile(mutationRoot(request), location.path, intent, request);
          (removed ? changed : skipped).push(location.displayPath);
          continue;
        }
        if (intent.replace === 'managed_block' || intent.replace === 'owned_file') {
          content = intent.surface
            ? releaseSharedBlock(oldContent, intent, platform, coOwners)
            : removeManagedMarker(oldContent, intent.marker ?? `${intent.kind}:${platform}`);
        } else if (intent.replace === 'named_entry') {
          if (location.format !== 'json') {
            diagnostics.push(
              `ERROR: safe named-entry removal for ${location.format ?? 'unknown'} is not available`,
            );
            skipped.push(location.displayPath);
            continue;
          }
          const entryPath = intent.entryPath ?? location.entryPath;
          if (!entryPath?.length) {
            diagnostics.push(`ERROR: no named-entry path for ${location.displayPath}`);
            skipped.push(location.displayPath);
            continue;
          }
          const removal = safeJsonRemove(
            oldContent,
            entryPath.slice(0, -1),
            entryPath[entryPath.length - 1]!,
          );
          content = removal.content;
          resultDiagnostics = removal.diagnostics;
        } else {
          skipped.push(location.displayPath);
          continue;
        }
        diagnostics.push(...resultDiagnostics);
        if (
          resultDiagnostics.some((diagnostic) => diagnostic.startsWith('ERROR:')) ||
          content === oldContent
        ) {
          skipped.push(location.displayPath);
          continue;
        }
        if (!request.dryRun) {
          backup(
            location.path,
            request.scope === 'project' ? resolve(request.path ?? process.cwd()) : homedir(),
            request.scope === 'user',
          );
          if (isEmptyOwnedSkillFile(content, intent)) unlinkSync(location.path);
          else atomicWrite(location.path, content);
        }
        changed.push(location.displayPath);
      }
    });
    results.push({ changed, skipped, diagnostics, plan });
  }
  if (request.removeLegacy) {
    mergeMigrationResult(results, migrateUnderLock(request));
  }
  return results;
}

export async function migrateLegacyInstall(request: MutationRequest): Promise<ApplyResult[]> {
  return upgradePlatforms(request);
}
// Split out of this module; re-exported so existing importers keep working.
export {
  intentLocation,
  type PlatformEnvironment,
  redactUserPath,
  resolveArtifactLocation,
} from './locations.js';
export { runPlatformsDoctor } from './platform-doctor.js';
