/**
 * Explicit, reversible projection of active catalog skills into the two real
 * platform surfaces: `.claude/skills` (platform:claude) and the shared
 * `.agents/skills` (platform:agents). Every projected file carries the stable
 * managed marker `catalog:skill:<name>`; a destination without it is foreign
 * and never written, and no write or removal passes through a symbolic link.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atomicWrite,
  removeManagedSkillPackage,
  symlinkedComponent,
  withMutationLock,
} from '../platform-adapters/mutation.js';
import { applyIntents, resolveArtifactLocation } from '../platform-adapters/operations.js';
import { PLATFORM_REGISTRY } from '../platform-adapters/registry.js';
import type { ArtifactIntent, InstallRequest, PlatformId } from '../platform-adapters/types.js';
import { verifyEntry } from './digest.js';
import { frontmatterViolations } from './frontmatter.js';
import { buildSnapshot, type CatalogAsset, eligible } from './snapshot.js';
import { CatalogIdSchema } from './types.js';

export type ProjectionSurface = 'platform:claude' | 'platform:agents';
export const PROJECTION_SURFACES: readonly ProjectionSurface[] = [
  'platform:claude',
  'platform:agents',
];

/** Any `.agents` adapter resolves the same `.agents/skills` directory. */
const ADAPTER: Record<ProjectionSurface, PlatformId> = {
  'platform:claude': 'claude',
  'platform:agents': 'codex',
};

export interface ProjectedPackage {
  id: string;
  sha256: string;
  paths: string[];
}

export interface ProjectionRemoval {
  id: string;
  /** Package directory relative to the surface's skill root. */
  dir: string;
  marker: string;
  /** Files of a re-projected package to leave alone; only the rest are removed. */
  keep?: string[];
}

export interface ProjectionPlan {
  surface: ProjectionSurface;
  intents: ArtifactIntent[];
  packages: ProjectedPackage[];
  removals: ProjectionRemoval[];
  diagnostics: string[];
}

export interface ProjectionResult extends ProjectionPlan {
  dryRun: boolean;
  changed: string[];
  skipped: string[];
  /** Where each changed file's previous content was backed up. */
  backupDir: string;
  /** The skill registry rebuilt after the apply, when there was one to rebuild. */
  registry?: string;
}

export interface ProjectionOptions {
  /** Plan only the removal of this id's package; project nothing. */
  unproject?: string;
}

export const catalogMarker = (name: string): string => `catalog:skill:${name}`;

/** The first body line of a projected SKILL.md; `jev:` is read by build-skill-registry.cjs. */
export const catalogMarkerLine = (a: Pick<CatalogAsset, 'id' | 'sha256' | 'targets'>): string =>
  `<!-- catalog ${a.id} sha256:${a.sha256} jev:${a.targets.includes('jev') ? 'yes' : 'no'} -->`;

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const isOurs = (content: string, name: string): boolean =>
  content.includes(`monomind:start ${catalogMarker(name)}`);

function requestFor(root: string, surface: ProjectionSurface, dryRun: boolean): InstallRequest {
  return { platform: ADAPTER[surface], scope: 'project', path: root, dryRun };
}

function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

function withMarkerLine(skillMd: string, line: string): string {
  const header = FRONTMATTER.exec(skillMd)?.[0];
  if (!header) return skillMd;
  return `${header}\n${line}\n${skillMd.slice(header.length).replace(/^\r?\n/, '')}`;
}

/** Intents for one verified package, or the reason it is refused. */
function packageIntents(
  root: string,
  skillRoot: string,
  asset: CatalogAsset,
): { intents: ArtifactIntent[]; paths: string[]; files: string[] } | { refused: string } {
  const check = verifyEntry(root, asset);
  if (!check.ok) return { refused: check.reason };
  const intents: ArtifactIntent[] = [];
  const paths: string[] = [];
  const files = listFiles(check.dir);
  if (files.includes('SKILL.md')) {
    const bad = frontmatterViolations(readFileSync(join(check.dir, 'SKILL.md'), 'utf8'));
    if (bad.length) return { refused: `frontmatter-not-allowed: ${bad.join(', ')}` };
  }
  for (const file of files) {
    const dest = join(skillRoot, asset.name, file);
    const display = relative(root, dest);
    const link = symlinkedComponent(root, dest);
    if (link) return { refused: `symlinked-destination: ${relative(root, link) || link}` };
    let content = readFileSync(join(check.dir, file), 'utf8');
    if (file === 'SKILL.md') content = withMarkerLine(content, catalogMarkerLine(asset));
    const st = lstatSync(dest, { throwIfNoEntry: false });
    if (st) {
      const existing = st.isFile() ? readFileSync(dest, 'utf8') : '';
      if (!isOurs(existing, asset.name)) return { refused: `not catalog-managed: ${display}` };
      if (file === 'SKILL.md' && FRONTMATTER.exec(existing)?.[0] !== FRONTMATTER.exec(content)?.[0])
        return {
          refused: `frontmatter-drift: run catalog unproject ${asset.id} then catalog project`,
        };
    }
    paths.push(display);
    intents.push({
      kind: 'skill',
      locationKey: 'skill',
      scope: 'project',
      replace: 'managed_block',
      format: 'md',
      marker: catalogMarker(asset.name),
      relativePath: `${asset.name}/${file}`,
      content,
    });
  }
  return { intents, paths, files };
}

/** Files below `dir` (not following links) that carry `name`'s marker. */
function markedFiles(dir: string, name: string): string[] {
  try {
    return listFiles(dir).filter((f) => isOurs(readFileSync(join(dir, f), 'utf8'), name));
  } catch {
    return [];
  }
}

function buildPlan(
  root: string,
  surface: ProjectionSurface,
  opts: ProjectionOptions,
): ProjectionPlan {
  const plan: ProjectionPlan = {
    surface,
    intents: [],
    packages: [],
    removals: [],
    diagnostics: [],
  };
  const adapter = PLATFORM_REGISTRY[ADAPTER[surface]];
  const location = resolveArtifactLocation(adapter, 'skill', 'project', { root });
  if (!location) throw new Error(`no project skill location for ${surface}`);
  const skillRoot = location.path;
  const unprojectName = opts.unproject ? parseId(opts.unproject) : undefined;
  const snapshot = buildSnapshot(root);
  const wanted = unprojectName ? [] : eligible(snapshot, surface);
  if (!unprojectName)
    for (const d of snapshot.diagnostics) {
      const a = snapshot.assets.find((x) => x.id === d.id);
      if (!a || (a.status === 'active' && a.targets.includes(surface)))
        plan.diagnostics.push(`${d.id}: ${d.reason}`);
    }
  const rootLink = symlinkedComponent(root, skillRoot);
  if (rootLink) {
    if (wanted.length || unprojectName || existsSync(skillRoot))
      plan.diagnostics.push(`symlinked-destination: ${relative(root, rootLink)}`);
    return plan;
  }
  for (const asset of wanted) {
    if (asset.kind !== 'skill') {
      plan.diagnostics.push(`${asset.id}: only skills are projected`);
      continue;
    }
    const r = packageIntents(root, skillRoot, asset);
    if ('refused' in r) plan.diagnostics.push(`${asset.id}: ${r.refused}`);
    else {
      plan.intents.push(...r.intents);
      plan.packages.push({ id: asset.id, sha256: asset.sha256, paths: r.paths });
      const stale = markedFiles(join(skillRoot, asset.name), asset.name).filter(
        (f) => !r.files.includes(f),
      );
      if (stale.length)
        plan.removals.push({
          id: asset.id,
          dir: asset.name,
          marker: catalogMarker(asset.name),
          keep: r.files,
        });
    }
  }
  // Only skills own a projection; a refused skill keeps its earlier verified copy.
  const keep = new Set(wanted.filter((a) => a.kind === 'skill').map((a) => a.name));
  const entries = existsSync(skillRoot) ? readdirSync(skillRoot, { withFileTypes: true }) : [];
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (unprojectName ? e.name !== unprojectName : keep.has(e.name)) continue;
    if (e.isSymbolicLink()) {
      if (unprojectName)
        plan.diagnostics.push(`symlinked-destination: ${relative(root, join(skillRoot, e.name))}`);
      continue;
    }
    if (e.isDirectory() && markedFiles(join(skillRoot, e.name), e.name).length)
      plan.removals.push({ id: `skill:${e.name}`, dir: e.name, marker: catalogMarker(e.name) });
  }
  return plan;
}

function parseId(id: string): string {
  const parsed = CatalogIdSchema.safeParse(id);
  if (!parsed.success || !parsed.data.startsWith('skill:'))
    throw new Error(`not a skill catalog id: ${id}`);
  return parsed.data.slice('skill:'.length);
}

/**
 * Surfaces that still hold a projected copy of catalog skill `id` (a marked
 * package dir reached without following a link). Read-only; disable/revoke use
 * it to point at the `project --apply` that removes the copy.
 */
export function projectedSurfaces(root: string, id: string): ProjectionSurface[] {
  if (!id.startsWith('skill:')) return [];
  const name = id.slice('skill:'.length);
  return PROJECTION_SURFACES.filter((surface) => {
    const adapter = PLATFORM_REGISTRY[ADAPTER[surface]];
    const location = resolveArtifactLocation(adapter, 'skill', 'project', { root });
    if (!location) return false;
    const dir = join(location.path, name);
    return !symlinkedComponent(root, dir) && markedFiles(dir, name).length > 0;
  });
}

/** Read-only plan: what `applyProjection` would write and remove. */
export async function planProjection(
  root: string,
  surface: ProjectionSurface,
  opts: ProjectionOptions = {},
): Promise<ProjectionPlan> {
  return buildPlan(root, surface, opts);
}

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/catalog → ../.. is the package root; dist/src/catalog → ../../.. */
const BUILDER_CANDIDATES = [
  join(HERE, '..', '..', '.claude', 'helpers', 'build-skill-registry.cjs'),
  join(HERE, '..', '..', '..', '.claude', 'helpers', 'build-skill-registry.cjs'),
];

/**
 * Regenerates `<root>/.claude/helpers/skill-registry.json` with the bundled
 * builder (which knows the catalog `jev:` flag) — only when the project
 * already has one, so a project without the per-prompt router gains nothing.
 */
function rebuildSkillRegistry(root: string): string | undefined {
  const file = join(root, '.claude', 'helpers', 'skill-registry.json');
  if (!existsSync(file) || symlinkedComponent(root, file)) return undefined;
  const builder = BUILDER_CANDIDATES.find((p) => existsSync(p));
  if (!builder) return undefined;
  const { build } = createRequire(import.meta.url)(builder) as {
    build(root: string): unknown;
  };
  atomicWrite(file, `${JSON.stringify(build(root), null, 2)}\n`);
  return relative(root, file);
}

/**
 * Plans and applies in one transaction under the platform mutation lock. A dry
 * run takes the same path with `dryRun` set (no lock, no writes), so its
 * `changed` list is the prediction.
 */
export async function applyProjection(
  root: string,
  surface: ProjectionSurface,
  opts: ProjectionOptions & { dryRun: boolean },
): Promise<ProjectionResult> {
  const request = requestFor(root, surface, opts.dryRun);
  const adapter = PLATFORM_REGISTRY[request.platform];
  const run = (plan: ProjectionPlan): ProjectionResult => {
    const applied = applyIntents(adapter, plan.intents, request);
    const result: ProjectionResult = {
      ...plan,
      dryRun: opts.dryRun,
      changed: applied.changed,
      skipped: applied.skipped,
      diagnostics: [...plan.diagnostics, ...applied.diagnostics],
      backupDir: '.monomind/backups/',
    };
    for (const r of plan.removals) {
      const removed = removeManagedSkillPackage(adapter, request, r.dir, r.marker, r.keep);
      result.changed.push(...removed.changed);
      result.skipped.push(...removed.skipped);
      result.diagnostics.push(...removed.diagnostics.map((d) => `${r.id}: ${d}`));
    }
    if (!opts.dryRun && surface === 'platform:claude' && result.changed.length)
      result.registry = rebuildSkillRegistry(root);
    return result;
  };
  const preview = buildPlan(root, surface, opts);
  // Nothing to do: return without taking the lock, so an empty apply creates nothing.
  if (opts.dryRun || (preview.intents.length === 0 && preview.removals.length === 0))
    return run(preview);
  return withMutationLock(request, () => run(buildPlan(root, surface, opts)));
}
