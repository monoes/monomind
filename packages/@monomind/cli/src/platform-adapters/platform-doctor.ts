/** `platforms doctor`: what each adapter declares, and what is on disk. */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { readInitManifest } from '../init/init-manifest.js';
import { resolveArtifactLocation } from './locations.js';
import { findLegacySurfaces } from './migration.js';
import { PLATFORM_IDS, PLATFORM_REGISTRY } from './registry.js';
import { sharedSkillSurface } from './shared-surface.js';
import type {
  ArtifactKind,
  Capability,
  InstallRequest,
  PlatformAdapter,
  PlatformDoctorReport,
} from './types.js';

/**
 * Doctor must tolerate both document artifacts and directory-root artifacts
 * (notably portable skill roots). A directory is managed only when its router
 * package is recorded in the init manifest (or, from an older install, carries
 * this platform's own marker); an arbitrary existing directory remains foreign.
 */
function artifactState(
  path: string,
  kind: ArtifactKind,
  platform: string,
  base: string,
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
      const recorded = readInitManifest(base)?.files?.[relative(base, router).split(sep).join('/')];
      return existsSync(router) &&
        (recorded !== undefined || readFileSync(router, 'utf8').includes(marker))
        ? 'managed'
        : 'foreign';
    }
    return readFileSync(path, 'utf8').includes(marker) ? 'managed' : 'foreign';
  } catch {
    // A raced deletion or inaccessible artifact is not evidence of ownership.
    return 'foreign';
  }
}

/**
 * The capability that gates each artifact kind's renderer (see
 * renderers/*.ts, each of which skips rendering unless its capability is
 * 'native'). Doctor uses this to tell a capability-gated location — declared
 * in the registry but intentionally never written because the capability
 * hasn't been promoted — apart from a genuine gap in an already-native one.
 * A kind absent here (e.g. the unused 'plugin') falls back to plain 'missing'.
 */
const KIND_CAPABILITY: Partial<Record<ArtifactKind, Capability>> = {
  instruction: 'instructions',
  skill: 'skills',
  mcp: 'mcp',
  command: 'commands',
  agent: 'agents',
  hook: 'hooks',
  hook_bridge: 'hooks',
  status: 'status',
  permission: 'permissions',
};

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
    const base =
      request.scope === 'project'
        ? resolve(request.path ?? process.cwd())
        : resolve(request.home ?? homedir());
    for (const kind of Object.keys(adapter.paths.locations) as ArtifactKind[]) {
      const location = resolveArtifactLocation(adapter, kind, request.scope, {
        root: request.path,
        home: request.home,
      });
      if (!location) continue;
      if (!existsSync(location.path)) {
        const capability = KIND_CAPABILITY[kind];
        const level = capability && adapter.capabilities[capability];
        if (capability && level !== 'native') {
          artifacts.push({
            path: location.displayPath,
            state: 'gated',
            reason: `capability ${capability} is ${level}; this artifact is not rendered until it is native`,
          });
        } else {
          artifacts.push({ path: location.displayPath, state: 'missing' });
        }
        continue;
      }
      const owner = kind === 'skill' ? sharedSkillSurface(adapter, request.scope)?.id : undefined;
      artifacts.push({
        path: location.displayPath,
        state: artifactState(location.path, kind, owner ?? platform, base),
      });
    }
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
