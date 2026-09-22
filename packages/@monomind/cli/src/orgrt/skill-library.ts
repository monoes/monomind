/**
 * The org skill library: named, reusable skills an org role is fed by name.
 *
 * A skill is a directory `<name>/SKILL.md` (frontmatter + markdown body) with
 * optional extra `.md` reference files beside it. Three roots are searched,
 * first match wins, so a project or the user can override a bundled skill:
 *
 *   1. `<project>/.monomind/org-skills/`   — this project's own skills
 *   2. `~/.monomind/org-skills/`            — the user's skills, every project
 *   3. `<package>/org-skills/`              — curated skills shipped with monomind
 *
 * Frontmatter fields read here: name, description, tags, tools, license,
 * source, source_path, source_commit. `tools` names the monomind MCP tools the
 * skill's work benefits from (monograph_*, monodesign_*); a role holding the
 * skill gets exactly those attached — see `skillToolProvider`.
 *
 * Active catalog skills and archetypes that target `org` (`monomind catalog`)
 * come after the three roots — or before them when approved with
 * `replacesLegacy`. Their `tools` are the granted tools, never the requested
 * ones, and their package digest is re-verified before a body is read.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEntry } from '../catalog/digest.js';
import { buildSnapshot, type CatalogAsset, eligible } from '../catalog/snapshot.js';
import type { OrgRole, ToolProviderConfig } from './types.js';

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface SkillMeta {
  name: string;
  description: string;
  tags: string[];
  tools: string[];
  license?: string;
  source?: string;
  source_path?: string;
  source_commit?: string;
  /** Which root it was found in. */
  origin: 'project' | 'user' | 'bundled' | 'catalog';
  /** Catalog entry id, for `origin: 'catalog'`. */
  catalogId?: string;
  /** Absolute skill directory. */
  dir: string;
}

export interface Skill extends SkillMeta {
  body: string;
  /** Extra .md files in the skill dir, relative, excluding SKILL.md. */
  files: string[];
}

/** Shipped library: <package-root>/org-skills, from dist/src/orgrt or src/orgrt. */
export function bundledSkillsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, '..', '..', '..', 'org-skills');
  return existsSync(built) ? built : join(here, '..', '..', 'org-skills');
}

export function skillRoots(projectRoot?: string): { dir: string; origin: SkillMeta['origin'] }[] {
  const roots: { dir: string; origin: SkillMeta['origin'] }[] = [];
  if (projectRoot)
    roots.push({ dir: join(projectRoot, '.monomind', 'org-skills'), origin: 'project' });
  roots.push({
    dir: join(process.env.MONOMIND_HOME ?? join(homedir(), '.monomind'), 'org-skills'),
    origin: 'user',
  });
  roots.push({ dir: bundledSkillsDir(), origin: 'bundled' });
  return roots;
}

/**
 * Minimal frontmatter reader for top-level scalar and list keys. Handles
 * `key: value`, quoted values, JSON/flow lists (`[a, b]`), block lists
 * (`- a`), and folded/literal block scalars (`>` / `|`). Nested maps are
 * skipped — nothing here needs them.
 */
export function parseFrontmatter(text: string): {
  data: Record<string, string | string[]>;
  body: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string | string[]> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, raw] = kv;
    const val = raw.trim();
    const cont: string[] = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
      cont.push(lines[++i]);
    }
    if (val === '' && cont.some((l) => /^\s*-\s+/.test(l))) {
      data[key] = cont
        .filter((l) => /^\s*-\s+/.test(l))
        .map((l) => unquote(l.replace(/^\s*-\s+/, '')));
    } else if (/^[>|][+-]?$/.test(val)) {
      const parts = cont.map((l) => l.trim());
      data[key] = (val.startsWith('>') ? parts.join(' ') : parts.join('\n')).trim();
    } else if (val.startsWith('[') && val.endsWith(']')) {
      data[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else if (val !== '') {
      // A plain scalar may wrap onto indented continuation lines.
      const nested = cont.some((l) => /^\s+[\w-]+:/.test(l));
      data[key] = unquote([val, ...(nested ? [] : cont.map((l) => l.trim()))].join(' ').trim());
    }
  }
  return { data, body: text.slice(m[0].length) };
}

function unquote(s: string): string {
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"') {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.length >= 2 && s[0] === "'" && s.at(-1) === "'") return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

const asList = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : v.split(/[,\s]+/).filter(Boolean);
const asStr = (v: string | string[] | undefined): string | undefined =>
  v === undefined ? undefined : Array.isArray(v) ? v.join(', ') : v;

function readSkillDir(dir: string, name: string, origin: SkillMeta['origin']): Skill | null {
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) return null;
  const { data, body } = parseFrontmatter(readFileSync(file, 'utf-8'));
  return {
    name,
    description: asStr(data.description) ?? '',
    tags: asList(data.tags),
    tools: asList(data.tools),
    license: asStr(data.license),
    source: asStr(data.source),
    source_path: asStr(data.source_path),
    source_commit: asStr(data.source_commit),
    origin,
    dir,
    body: body.trim(),
    files: listMdFiles(dir).filter((f) => f !== 'SKILL.md'),
  };
}

function listMdFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listMdFiles(dir, rel));
    else if (e.name.endsWith('.md')) out.push(rel);
  }
  return out.sort();
}

/** Active org-target catalog skills by name, verified; empty without state. */
function catalogSkills(projectRoot?: string): Map<string, CatalogAsset> {
  if (!projectRoot) return new Map();
  const snap = buildSnapshot(projectRoot);
  return new Map(
    eligible(snap, 'org')
      .filter((a) => a.kind !== 'blueprint')
      .map((a) => [a.name, a]),
  );
}

/** A catalog skill with its digest re-verified now, or null. */
function readCatalogSkill(projectRoot: string, asset: CatalogAsset): Skill | null {
  const check = verifyEntry(projectRoot, asset);
  if (!check.ok) return null;
  const s = readSkillDir(check.dir, asset.name, 'catalog');
  return s && { ...s, catalogId: asset.id, tools: [...asset.grantedTools] };
}

/** One skill by name, or null. Names are validated before touching the disk. */
export function getSkill(name: string, projectRoot?: string): Skill | null {
  if (!SKILL_NAME_RE.test(name)) return null;
  const asset = catalogSkills(projectRoot).get(name);
  if (asset?.replacesLegacy && projectRoot) {
    const s = readCatalogSkill(projectRoot, asset);
    if (s) return s;
  }
  for (const { dir, origin } of skillRoots(projectRoot)) {
    const s = readSkillDir(join(dir, name), name, origin);
    if (s) return s;
  }
  return asset && projectRoot ? readCatalogSkill(projectRoot, asset) : null;
}

const listCache = new Map<string, { at: number; skills: SkillMeta[] }>();

/** Every skill across the roots (overrides resolved), sorted by name. Cached
 *  briefly per root set — the bundled library has hundreds of entries. */
export function listSkills(projectRoot?: string): SkillMeta[] {
  const key = projectRoot ?? '';
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < 5_000) return hit.skills;
  const seen = new Map<string, SkillMeta>();
  for (const { dir, origin } of skillRoots(projectRoot)) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (seen.has(name) || !SKILL_NAME_RE.test(name)) continue;
      const s = readSkillDir(join(dir, name), name, origin);
      if (s) {
        const { body: _b, files: _f, ...meta } = s;
        seen.set(name, meta);
      }
    }
  }
  for (const asset of catalogSkills(projectRoot).values()) {
    if (seen.has(asset.name) && !asset.replacesLegacy) continue;
    seen.set(asset.name, {
      name: asset.name,
      description: asset.description,
      tags: asset.tags,
      tools: [...asset.grantedTools],
      license: asset.source.license,
      origin: 'catalog',
      catalogId: asset.id,
      dir: asset.dir as string,
    });
  }
  const skills = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  listCache.set(key, { at: Date.now(), skills });
  return skills;
}

/** Crude suffix stripping so "APIs"/"api" and "marketer"/"marketing" meet. */
const stem = (t: string): string =>
  t.length > 4 ? t.replace(/(ings?|ers?|ed|es|s)$/, '') : t.replace(/s$/, '');
const tokens = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem);

/** Rank skills against free text (a role's title and responsibilities, say).
 *  Name and tag hits weigh more than description hits; idf keeps common
 *  words from dominating. */
export function searchSkills(
  query: string,
  projectRoot?: string,
  opts: { tag?: string; limit?: number } = {},
): (SkillMeta & { score: number })[] {
  return rankSkillMeta(
    query,
    listSkills(projectRoot).filter((s) => !opts.tag || s.tags.includes(opts.tag)),
    opts,
  );
}

/** `searchSkills`' scorer over any name/tags/description records (the
 *  catalog ranks its assets with it). */
export function rankSkillMeta<T extends Pick<SkillMeta, 'name' | 'description' | 'tags'>>(
  query: string,
  all: T[],
  opts: { limit?: number } = {},
): (T & { score: number })[] {
  const q = [...new Set(tokens(query))];
  if (q.length === 0) return [];
  const docs = all.map((s) => ({
    s,
    strong: new Set([...tokens(s.name), ...s.tags.flatMap(tokens)]),
    desc: tokens(s.description),
  }));
  const df = (t: string) => docs.filter((d) => d.strong.has(t) || d.desc.includes(t)).length;
  const idf = new Map(q.map((t) => [t, Math.log(1 + docs.length / (1 + df(t)))]));
  return docs
    .map(({ s, strong, desc }) => {
      let score = 0;
      for (const t of q) {
        const w = idf.get(t) ?? 0;
        if (strong.has(t)) score += 3 * w;
        const n = desc.filter((d) => d === t).length;
        if (n) score += w * (1 + Math.log(n));
      }
      return { ...s, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 10);
}

/** Expand a role's `skill_pool` (names and `tag:<t>` selectors) to names. */
export function expandSkillPool(pool: string[] | undefined, projectRoot?: string): string[] {
  const out = new Set<string>();
  for (const entry of pool ?? []) {
    if (entry.startsWith('tag:')) {
      const tag = entry.slice(4);
      for (const s of listSkills(projectRoot)) if (s.tags.includes(tag)) out.add(s.name);
    } else out.add(entry);
  }
  return [...out];
}

/** Every skill a role may use: pinned first, then its pool. */
export function roleSkillNames(
  role: Pick<OrgRole, 'skills' | 'skill_pool'>,
  projectRoot?: string,
): string[] {
  return [...new Set([...(role.skills ?? []), ...expandSkillPool(role.skill_pool, projectRoot)])];
}

/** `org validate` errors for a role's skill references. */
export function validateRoleSkills(
  role: Pick<OrgRole, 'id' | 'skills' | 'skill_pool'>,
  projectRoot?: string,
): string[] {
  const errors: string[] = [];
  for (const s of role.skills ?? []) {
    if (!getSkill(s, projectRoot)) errors.push(`role "${role.id}": unknown skill "${s}"`);
  }
  for (const p of role.skill_pool ?? []) {
    if (p.startsWith('tag:')) {
      if (expandSkillPool([p], projectRoot).length === 0) {
        errors.push(`role "${role.id}": skill_pool "${p}" matches no skill`);
      }
    } else if (!getSkill(p, projectRoot))
      errors.push(`role "${role.id}": unknown skill "${p}" in skill_pool`);
  }
  return errors;
}

/** The pinned-skill text for a role's system prompt, plus the on-demand
 *  catalog. Deterministic for a given config so the prompt stays a stable
 *  cache prefix. */
export function roleSkillGuidance(
  role: Pick<OrgRole, 'skills' | 'skill_pool'>,
  projectRoot?: string,
): string | undefined {
  const parts: string[] = [];
  const pinned = new Set(role.skills ?? []);
  for (const name of pinned) {
    const s = getSkill(name, projectRoot);
    if (s?.body) parts.push(`## Skill: ${name}\n\n${s.body}`);
  }
  const onDemand = expandSkillPool(role.skill_pool, projectRoot).filter((n) => !pinned.has(n));
  const lines = onDemand
    .map((n) => getSkill(n, projectRoot))
    .filter((s): s is Skill => s !== null)
    .map((s) => `- ${s.name}: ${s.description.replace(/\s+/g, ' ').slice(0, 200)}`);
  if (lines.length) {
    parts.push(
      `## Skills available on demand\nLoad one with org_skill_load when a task calls for it; the full text arrives as the tool result.\n${lines.join('\n')}`,
    );
  }
  return parts.length ? parts.join('\n\n') : undefined;
}

/** Text of a skill (or one of its reference files) for org_skill_load. */
export function loadSkillText(
  name: string,
  file: string | undefined,
  projectRoot?: string,
): string {
  const s = getSkill(name, projectRoot);
  if (!s) return `ERROR: unknown skill "${name}"`;
  if (!file) {
    const refs = s.files.length
      ? `\n\n---\nReference files (load with file=): ${s.files.join(', ')}`
      : '';
    return `# Skill: ${s.name}\n\n${s.body}${refs}`;
  }
  const path = normalize(join(s.dir, file));
  const rel = relative(s.dir, path);
  if (
    rel.startsWith('..') ||
    rel.startsWith(sep) ||
    !path.endsWith('.md') ||
    !existsSync(path) ||
    !statSync(path).isFile()
  ) {
    return `ERROR: skill "${name}" has no reference file "${file}". Available: ${s.files.join(', ') || 'none'}`;
  }
  return readFileSync(path, 'utf-8');
}

/** MCP tools a set of skills asks for (monograph_*, monodesign_*). */
export function skillTools(names: string[], projectRoot?: string): string[] {
  const out = new Set<string>();
  for (const n of names) for (const t of getSkill(n, projectRoot)?.tools ?? []) out.add(t);
  return [...out].sort();
}

export const SKILL_PROVIDER_NAME = 'monomind';

/** The monomind MCP server, allow-listed to exactly the tools the role's
 *  skills declare — so a developer role holding a code skill gets monograph,
 *  and a copywriter never sees it. Undefined when no skill asks for a tool or
 *  the role already configures a provider of that name itself. */
export function skillToolProvider(
  role: Pick<OrgRole, 'skills' | 'skill_pool' | 'tool_providers'>,
  projectRoot?: string,
): ToolProviderConfig | undefined {
  if ((role.tool_providers ?? []).some((p) => p.name === SKILL_PROVIDER_NAME)) return undefined;
  const allow = skillTools(roleSkillNames(role, projectRoot), projectRoot);
  if (allow.length === 0) return undefined;
  const cli = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'cli.js');
  const bin = existsSync(cli)
    ? cli
    : join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'cli.js');
  return {
    kind: 'mcp-stdio',
    name: SKILL_PROVIDER_NAME,
    command: process.execPath,
    args: [bin, 'mcp', 'start'],
    env: {},
    allow,
    timeout_ms: 660_000,
    idle_ms: 300_000,
  };
}

/** A role's configured providers plus the skill-derived one, if any. */
export function effectiveToolProviders(
  role: Pick<OrgRole, 'skills' | 'skill_pool' | 'tool_providers'>,
  projectRoot?: string,
): ToolProviderConfig[] {
  const extra = skillToolProvider(role, projectRoot);
  return [...(role.tool_providers ?? []), ...(extra ? [extra] : [])];
}
