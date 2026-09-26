/** Resolution of declarative adapter paths into real filesystem paths. */

import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type {
  ArtifactIntent,
  ArtifactKind,
  DiscoveryResult,
  InstallRequest,
  PlatformAdapter,
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

export function intentLocation(
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
