/** Planning and application for evidence-gated platform artifacts. */

import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  mergeManagedBlock,
  mergeSkillManagedBlock,
  removeManagedMarker,
  safeJsonMerge,
  safeJsonRemove,
} from './merge.js';
import { findLegacySurfaces, migrateLegacyArtifacts } from './migration.js';
import { PLATFORM_IDS, PLATFORM_REGISTRY } from './registry.js';
import { getRenderer } from './renderers/index.js';
import type {
  ApplyResult,
  ArtifactIntent,
  ArtifactKind,
  DiscoveryResult,
  InstallRequest,
  MutationRequest,
  PlatformAdapter,
  PlatformDoctorReport,
  PlatformPlan,
  ResolvedArtifactLocation,
} from './types.js';

export interface PlatformEnvironment {
  root?: string;
  home?: string;
  discovery?: DiscoveryResult;
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function locationFor(
  adapter: PlatformAdapter,
  kind: ArtifactKind,
  scope: InstallRequest['scope'],
  discovery?: DiscoveryResult,
) {
  return discovery?.locations?.[kind]?.[scope] ?? adapter.paths.locations[kind]?.[scope];
}

export function redactUserPath(path: string, home = homedir()): string {
  const resolvedHome = resolve(home);
  const resolvedPath = resolve(path);
  return isWithin(resolvedHome, resolvedPath)
    ? `<home>/${relative(resolvedHome, resolvedPath)}`.replace(/\/$/, '')
    : '<external-user-path>';
}

/** The sole conversion from declarative adapter paths into real filesystem paths. */
export function resolveArtifactLocation(
  adapter: PlatformAdapter,
  kind: ArtifactKind,
  scope: InstallRequest['scope'],
  environment: PlatformEnvironment = {},
): ResolvedArtifactLocation | undefined {
  const location = locationFor(adapter, kind, scope, environment.discovery);
  if (!location || location === 'discovery' || location === 'cli_fallback') return undefined;

  const base =
    scope === 'project'
      ? resolve(environment.root ?? process.cwd())
      : resolve(environment.home ?? homedir());
  const fullPath = resolve(base, location.path);
  if (!isWithin(base, fullPath)) return undefined;
  return {
    path: fullPath,
    displayPath:
      scope === 'user' ? redactUserPath(fullPath, base) : relative(base, fullPath) || '.',
    format: location.format,
    entryPath: location.entryPath,
  };
}

function assertMutationAuthorized(request: Pick<InstallRequest, 'scope' | 'yes'>): void {
  if (request.scope === 'user' && request.yes !== true) {
    throw new Error('User-scope mutation requires --scope user --yes');
  }
}

export async function planInstall(request: InstallRequest): Promise<PlatformPlan> {
  const adapter = PLATFORM_REGISTRY[request.platform];
  return getRenderer(request.platform).render(adapter, request);
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
}

function backup(path: string, root: string, privateBackup = false): void {
  if (!existsSync(path)) return;
  const backupRoot = join(root, '.monomind', 'backups', `${Date.now()}-${process.pid}`);
  mkdirSync(backupRoot, { recursive: true, mode: privateBackup ? 0o700 : undefined });
  // mkdir's mode is subject to umask and does not change an existing path. A
  // user-scope backup can contain credentials from a platform config, so its
  // leaf directory must be private regardless of the caller's umask.
  if (privateBackup) chmodSync(backupRoot, 0o700);
  const destination = join(backupRoot, basename(path));
  if (statSync(path).isDirectory()) cpSync(path, destination, { recursive: true });
  else writeFileSync(destination, readFileSync(path));
}

function scopeStateRoot(request: Pick<InstallRequest, 'scope' | 'path'>): string {
  return request.scope === 'project'
    ? resolve(request.path ?? process.cwd(), '.monomind')
    : join(homedir(), '.monomind');
}

/**
 * Locks are deliberately scope-local. A stale lock remains visible and fails
 * safe; it is never removed by a later invocation that cannot prove ownership.
 */
function withScopeLock<T>(request: Pick<InstallRequest, 'scope' | 'path'>, action: () => T): T {
  const privateLock = request.scope === 'user';
  const lockPath = join(scopeStateRoot(request), 'locks', 'platforms.lock');
  mkdirSync(dirname(lockPath), { recursive: true, mode: privateLock ? 0o700 : undefined });
  if (privateLock) chmodSync(dirname(lockPath), 0o700);
  let fd: number;
  try {
    fd = openSync(lockPath, 'wx', privateLock ? 0o600 : undefined);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new Error(
        `Platform mutation lock already exists: ${lockPath}. ` +
          'Inspect its PID and start time, then remove it manually only after verifying the owner is gone.',
      );
    }
    throw error;
  }
  try {
    writeFileSync(
      fd,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), scope: request.scope })}\n`,
      'utf8',
    );
    return action();
  } finally {
    closeSync(fd);
    unlinkSync(lockPath);
  }
}

/** A dry run is read-only, including Monomind's own lock and state roots. */
function withMutationLock<T>(
  request: Pick<InstallRequest, 'scope' | 'path' | 'dryRun'>,
  action: () => T,
): T {
  return request.dryRun ? action() : withScopeLock(request, action);
}

function intentLocation(
  adapter: PlatformAdapter,
  intent: ArtifactIntent,
  request: InstallRequest,
): ResolvedArtifactLocation | undefined {
  const location = resolveArtifactLocation(adapter, intent.locationKey, intent.scope, {
    root: request.path,
    discovery: request.discovery,
  });
  if (!location) return undefined;
  // Skill locations are package roots. Each canonical package supplies its
  // relative output path; callers cannot escape that root.
  if (intent.kind !== 'skill') return location;
  const relativePath = intent.relativePath ?? join('mastermind', 'SKILL.md');
  const skillPath = resolve(location.path, relativePath);
  if (!isWithin(location.path, skillPath)) return undefined;
  return {
    ...location,
    path: skillPath,
    displayPath: join(location.displayPath, relativePath),
  };
}

/**
 * Doctor must tolerate both document artifacts and directory-root artifacts
 * (notably portable skill roots). A directory is managed only when its router
 * package carries this platform's own marker; an arbitrary existing directory
 * remains foreign.
 */
function artifactState(
  path: string,
  kind: ArtifactKind,
  platform: PlatformAdapter['id'],
): 'managed' | 'foreign' {
  // Intent markers use plural artifact namespaces for the two shared roots.
  // Keep this mapping here rather than guessing from a filesystem path.
  const marker =
    kind === 'instruction'
      ? `monomind:start instructions:${platform}`
      : kind === 'skill'
        ? `monomind:start skills:${platform}`
        : kind === 'status'
          ? `monomind:start status:${platform}`
          : `monomind:start ${kind}s:${platform}`;
  try {
    if (statSync(path).isDirectory()) {
      if (kind !== 'skill') return 'foreign';
      const router = join(path, 'mastermind', 'SKILL.md');
      return existsSync(router) && readFileSync(router, 'utf8').includes(marker)
        ? 'managed'
        : 'foreign';
    }
    return readFileSync(path, 'utf8').includes(marker) ? 'managed' : 'foreign';
  } catch {
    // A raced deletion or inaccessible artifact is not evidence of ownership.
    return 'foreign';
  }
}

function isSkillPackage(intent: ArtifactIntent): boolean {
  return intent.kind === 'skill' && (intent.relativePath ?? '').endsWith('/SKILL.md');
}

function markerComment(format: ResolvedArtifactLocation['format']): '#' | '//' {
  return format === 'js' ? '//' : '#';
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
): { changed?: string; skipped?: string; diagnostics: string[] } {
  const location = intentLocation(adapter, intent, request);
  if (!location)
    return {
      skipped: `${adapter.id}:${intent.kind}`,
      diagnostics: [`No declared ${intent.kind} location for ${adapter.id}`],
    };

  const oldContent = existsSync(location.path) ? readFileSync(location.path, 'utf8') : '';
  let content = oldContent;
  let diagnostics: string[] = [];
  if (intent.replace === 'managed_block') {
    const marker = intent.marker ?? `${intent.kind}:${adapter.id}`;
    if (isSkillPackage(intent)) {
      const merged = mergeSkillManagedBlock(oldContent, marker, intent.content);
      content = merged.content;
      diagnostics = [...merged.diagnostics];
    } else {
      content = mergeManagedBlock(
        oldContent,
        marker,
        intent.content,
        markerComment(location.format),
      );
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
  const changed: string[] = [];
  const skipped: string[] = [];
  const diagnostics = [...plan.diagnostics];
  withMutationLock(request, () => {
    for (const intent of plan.intents) {
      const result = applyIntent(adapter, intent, request);
      if (result.changed) changed.push(result.changed);
      if (result.skipped) skipped.push(result.skipped);
      diagnostics.push(...result.diagnostics);
    }
  });
  return { changed, skipped, diagnostics, plan };
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
    withMutationLock(request, () => {
      for (const intent of plan.intents) {
        const location = intentLocation(adapter, intent, { ...request, platform });
        if (!location || !existsSync(location.path)) {
          skipped.push(location?.displayPath ?? `${platform}:${intent.kind}`);
          continue;
        }
        const oldContent = readFileSync(location.path, 'utf8');
        let content = oldContent;
        let resultDiagnostics: readonly string[] = [];
        if (intent.replace === 'managed_block') {
          content = removeManagedMarker(oldContent, intent.marker ?? `${intent.kind}:${platform}`);
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

export async function runPlatformsDoctor(request: {
  platform?: PlatformAdapter['id'];
  path?: string;
  scope: InstallRequest['scope'];
  home?: string;
}): Promise<PlatformDoctorReport[]> {
  const ids = request.platform ? [request.platform] : [...PLATFORM_IDS];
  return ids.map((platform) => {
    const adapter = PLATFORM_REGISTRY[platform];
    const artifacts: PlatformDoctorReport['artifacts'][number][] = [];
    const diagnostics: string[] = [];
    for (const kind of Object.keys(adapter.paths.locations) as ArtifactKind[]) {
      const location = resolveArtifactLocation(adapter, kind, request.scope, {
        root: request.path,
        home: request.home,
      });
      if (!location) continue;
      if (!existsSync(location.path)) {
        artifacts.push({ path: location.displayPath, state: 'missing' });
        continue;
      }
      artifacts.push({
        path: location.displayPath,
        state: artifactState(location.path, kind, platform),
      });
    }
    const base =
      request.scope === 'project'
        ? resolve(request.path ?? process.cwd())
        : resolve(request.home ?? homedir());
    const legacyFindings = findLegacySurfaces(base, request.scope);
    if (adapter.requiresDiscovery)
      diagnostics.push(`${adapter.displayName}: native enhancements require successful discovery.`);
    return {
      platform,
      capabilities: { ...adapter.capabilities },
      verification: Object.fromEntries(
        Object.entries(adapter.verification).map(([capability, evidence]) => [
          capability,
          evidence.level,
        ]),
      ) as PlatformDoctorReport['verification'],
      artifacts,
      legacy: { findings: legacyFindings, migratable: legacyFindings.length > 0 },
      diagnostics,
      sanitized: true,
    };
  });
}
