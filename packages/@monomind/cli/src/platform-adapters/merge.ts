/** Safe, format-neutral primitives for Monomind-managed configuration content. */

import { dropLegacyUnmarked, replaceLegacyUnmarked } from '../init/managed-block.js';

export interface SafeJsonResult {
  content: string;
  diagnostics: readonly string[];
}

type JsonObject = Record<string, unknown>;

interface ParsedJsonObject {
  value: JsonObject;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isValidMarker(marker: string): boolean {
  return marker.trim().length > 0 && marker.trim() === marker && !/[\r\n]/.test(marker);
}

function markerBlockPattern(marker: string): RegExp | undefined {
  if (!isValidMarker(marker)) return undefined;

  const escapedMarker = escapeRegExp(marker);
  const commentPrefix = '(?:(?:#|//)\\s*|<!--\\s*)?';
  const suffix = '[^\\S\\r\\n]*(?:-->)?[^\\S\\r\\n]*(?:\\r?\\n|$)';
  return new RegExp(
    `^[\\t ]*${commentPrefix}monomind:start\\s+${escapedMarker}${suffix}[\\s\\S]*?^[\\t ]*${commentPrefix}monomind:end\\s+${escapedMarker}${suffix}`,
    'gm',
  );
}

function lineEnding(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/** `html` (`<!-- … -->`) is the Markdown form: a `# monomind:start` line is a
 *  level-1 heading there. All three forms are read, whatever is written. */
export type MarkerComment = '#' | '//' | 'html';

function managedBlock(
  marker: string,
  content: string,
  eol: '\n' | '\r\n',
  comment: MarkerComment,
): string {
  const body = content.replace(/\r\n|\r|\n/g, eol).replace(new RegExp(`(?:${eol})+$`), '');
  const edge = (kind: 'start' | 'end') =>
    comment === 'html'
      ? `<!-- monomind:${kind} ${marker} -->`
      : `${comment} monomind:${kind} ${marker}`;
  const start = edge('start');
  const end = edge('end');
  return body.length > 0 ? `${start}${eol}${body}${eol}${end}${eol}` : `${start}${eol}${end}${eol}`;
}

/**
 * Adds or replaces one managed marker block. Blocks for other artifacts and
 * platforms are deliberately left untouched.
 */
export function mergeManagedBlock(
  existing: string,
  marker: string,
  content: string,
  comment: MarkerComment = '#',
): string {
  const pattern = markerBlockPattern(marker);
  if (!pattern) return existing;

  const block = managedBlock(marker, content, lineEnding(existing), comment);
  let found = false;
  const merged = existing.replace(pattern, () => {
    if (found) return '';
    found = true;
    return block;
  });

  if (found) return merged;
  return existing.length === 0 || /(?:\r?\n)$/.test(existing)
    ? `${existing}${block}`
    : `${existing}${lineEnding(existing)}${block}`;
}

/**
 * Every Monomind marker block in the text, whoever owns it. Skill roots are
 * shared — `.agents/skills` is the portable skill location for opencode, kimi
 * and codex at once — so a merge routinely meets blocks that are not its own.
 */
function anyManagedBlockPattern(): RegExp {
  const commentPrefix = '(?:(?:#|//)\\s*|<!--\\s*)?';
  const suffix = '[^\\S\\r\\n]*(?:-->)?[^\\S\\r\\n]*(?:\\r?\\n|$)';
  return new RegExp(
    `^[\\t ]*${commentPrefix}monomind:start\\s+(\\S+)${suffix}[\\s\\S]*?^[\\t ]*${commentPrefix}monomind:end\\s+\\1${suffix}`,
    'gm',
  );
}

interface ContentSegment {
  text: string;
  /** The marker name, when this segment is a managed block rather than free text. */
  marker?: string;
}

function splitManagedBlocks(text: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(anyManagedBlockPattern())) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ text: text.slice(cursor, index) });
    segments.push({ text: match[0], marker: match[1] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

/**
 * The merge for portable skill files. Their content is wholly generated:
 * `copySkills` writes the canonical source to this same path unwrapped before
 * the adapter install runs, and every version predating markers left exactly
 * that. `mergeManagedBlock` found no marker of its own, appended a fresh block,
 * and the body ended up in the file twice (GH #286 — codex-tools.md 64 -> 130
 * lines, six reference files doubled).
 *
 * So before appending, an undelimited copy of the generated body is looked for
 * and replaced where it sits, reusing the detection GH #276 built for CLAUDE.md
 * (init/managed-block.ts): the region must open on the generated title line and
 * carry at least three of the generated `## ` headings, and it stops at the
 * first heading that is demonstrably not ours. Hand-authored text on either side
 * keeps its position, and a body that cannot be proven generated is left alone
 * and appended beside instead.
 *
 * Only text OUTSIDE every marker block is searched: in a shared skill root each
 * adapter installs its own block around this same body, and absorbing a
 * neighbour's would gut it.
 */
export function mergeSkillFileManagedBlock(
  existing: string,
  marker: string,
  content: string,
  comment: MarkerComment = 'html',
): string {
  if (!isValidMarker(marker)) return existing;
  const block = managedBlock(marker, content, lineEnding(existing), comment);
  if (existing.length === 0) return block;

  const segments = splitManagedBlocks(existing);
  const owned = segments.findIndex((segment) => segment.marker === marker);
  if (owned !== -1) {
    // Refresh in place, and sweep the free text around it for a stale unwrapped
    // copy: a marked block sitting below an unmarked body is the exact shape
    // 2.11.4 produced, and it heals back to a single copy.
    segments[owned] = { text: block, marker };
    return segments
      .map((segment) =>
        segment.marker === undefined ? dropLegacyUnmarked(segment.text, content) : segment.text,
      )
      .join('');
  }

  for (const segment of segments) {
    if (segment.marker !== undefined) continue;
    const replaced = replaceLegacyUnmarked(segment.text, content, block);
    if (replaced === null) continue;
    segment.text = replaced;
    return segments.map(({ text }) => text).join('');
  }

  return /(?:\r?\n)$/.test(existing)
    ? `${existing}${block}`
    : `${existing}${lineEnding(existing)}${block}`;
}

/**
 * Folds blocks written under superseded markers into `marker`. Before shared
 * skill roots were co-owned, each platform targeting `.agents/skills` wrapped
 * the same body in its own `skills:<platform>:<name>` block. The first such
 * block is renamed in place (so the refresh keeps its position) unless
 * `marker` already exists; every other one is dropped. Text outside the
 * blocks is untouched.
 */
export function adoptSupersededBlocks(
  existing: string,
  marker: string,
  superseded: readonly string[],
): string {
  const stale = new Set(superseded.filter((candidate) => candidate !== marker));
  const segments = splitManagedBlocks(existing);
  let adopted = segments.some((segment) => segment.marker === marker);
  return segments
    .map(({ text, marker: owner }) => {
      if (owner === undefined || !stale.has(owner)) return text;
      if (adopted) return '';
      adopted = true;
      const edge = new RegExp(
        `(monomind:(?:start|end)\\s+)${escapeRegExp(owner)}(?=\\s|-->|$)`,
        'gm',
      );
      return text.replace(edge, `$1${marker}`);
    })
    .join('');
}

/** Removes exactly one artifact/platform block, leaving all other content unchanged. */
export function removeManagedBlock(content: string, artifact: string, platform: string): string {
  return removeManagedMarker(content, `${artifact}:${platform}`);
}

/** Whether `content` holds a complete block for exactly `marker`. */
export function hasManagedMarker(content: string, marker: string): boolean {
  return markerBlockPattern(marker)?.test(content) ?? false;
}

/** Removes a block by its full marker for artifacts with qualified names. */
export function removeManagedMarker(content: string, marker: string): string {
  const pattern = markerBlockPattern(marker);
  return pattern ? content.replace(pattern, '') : content;
}

function frontmatterEnd(content: string): number | undefined {
  if (!content.startsWith('---\n')) return undefined;
  const end = content.indexOf('\n---\n', 4);
  return end === -1 ? undefined : end + '\n---\n'.length;
}

function skillName(content: string): string | undefined {
  const end = frontmatterEnd(content);
  if (end === undefined) return undefined;
  return /^name:\s*([^\s]+)\s*$/m.exec(content.slice(0, end))?.[1];
}

/**
 * SKILL.md requires YAML frontmatter to be its first bytes. Keep it outside
 * the managed marker and replace only Monomind's body block. A same-name file
 * may contain user guidance around the block; a different-name file is foreign
 * and is never overwritten by an adapter install.
 */
export function mergeSkillManagedBlock(
  existing: string,
  marker: string,
  rendered: string,
  comment: MarkerComment = 'html',
): SafeJsonResult {
  const renderedEnd = frontmatterEnd(rendered);
  const name = skillName(rendered);
  if (renderedEnd === undefined || !name)
    return { content: existing, diagnostics: ['ERROR: rendered skill has invalid frontmatter'] };
  // A block right after the frontmatter follows the blank line there; the
  // `#` form used to be written over that line, and it is restored here.
  // Anything else (user text first) is left exactly as it is.
  const afterHeader = (merged: string): string =>
    /^(?:<!--|#|\/\/)[^\S\r\n]*monomind:start /.test(merged) ? `\n${merged}` : merged;
  if (!existing) {
    const header = rendered.slice(0, renderedEnd);
    const body = rendered.slice(renderedEnd).replace(/^\n/, '');
    return {
      content: `${header}${afterHeader(mergeSkillFileManagedBlock('', marker, body, comment))}`,
      diagnostics: [],
    };
  }
  const existingEnd = frontmatterEnd(existing);
  if (existingEnd === undefined || skillName(existing) !== name) {
    return {
      content: existing,
      diagnostics: [`ERROR: foreign SKILL.md prevents installing ${name}`],
    };
  }
  const header = existing.slice(0, existingEnd);
  const body = existing.slice(existingEnd);
  const renderedBody = rendered.slice(renderedEnd).replace(/^\n/, '');
  // The legacy skill copier (copySkills) writes this same canonical source
  // unwrapped to this same path before the managed-block install runs. That
  // is Monomind's own content, not foreign text surrounding the block — merge
  // as if the file were new, or the block ends up wrapped around a second,
  // redundant copy of the body it already matches.
  const normalize = (value: string): string => value.replace(/\r\n|\r/g, '\n').trim();
  // Beyond that exact match, a body an older version wrote and this one has
  // since edited is recognised structurally and replaced where it sits, rather
  // than appended to (GH #286).
  const base = normalize(body) === normalize(renderedBody) ? '' : body;
  return {
    content: `${header}${afterHeader(mergeSkillFileManagedBlock(base, marker, renderedBody, comment))}`,
    diagnostics: [],
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(content: string): ParsedJsonObject | SafeJsonResult {
  try {
    const parsed: unknown = JSON.parse(content);
    if (isJsonObject(parsed)) return { value: parsed };
    return { content, diagnostics: ['ERROR: expected a JSON object at the document root'] };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { content, diagnostics: [`ERROR: invalid JSON: ${detail}`] };
  }
}

function isSafeJsonResult(value: ParsedJsonObject | SafeJsonResult): value is SafeJsonResult {
  return !('value' in value);
}

function validatePath(path: readonly string[]): string | undefined {
  if (path.length === 0) return 'ERROR: named-entry path must contain an entry name';
  if (path.some((segment) => segment.trim().length === 0))
    return 'ERROR: named-entry path segments must not be empty';
  return undefined;
}

function jsonIndent(content: string): number | string | undefined {
  const indentation = content.match(/\r?\n([\t ]+)"/u)?.[1];
  if (!indentation) return undefined;
  return indentation.includes('\t') ? '\t' : indentation.length;
}

function stringifyJson(value: JsonObject, source: string): string {
  const rendered = JSON.stringify(value, null, jsonIndent(source));
  return source.endsWith('\n') ? `${rendered}${lineEnding(source)}` : rendered;
}

function normalizeJsonValue(
  value: unknown,
): { ok: true; value: unknown } | { ok: false; diagnostic: string } {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
      return { ok: false, diagnostic: 'ERROR: named-entry value is not JSON serializable' };
    return { ok: true, value: JSON.parse(serialized) as unknown };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      diagnostic: `ERROR: named-entry value is not JSON serializable: ${detail}`,
    };
  }
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parentForEntry(
  root: JsonObject,
  path: readonly string[],
  createMissing: boolean,
): JsonObject | string {
  let current = root;
  for (const segment of path) {
    const child = current[segment];
    if (child === undefined && createMissing) {
      const created: JsonObject = {};
      current[segment] = created;
      current = created;
      continue;
    }
    if (!isJsonObject(child)) return `ERROR: JSON path segment "${segment}" is not an object`;
    current = child;
  }
  return current;
}

/** Merges a named JSON object entry, leaving malformed input unmodified. */
export function safeJsonMerge(
  content: string,
  path: readonly string[],
  entry: unknown,
): SafeJsonResult {
  const pathError = validatePath(path);
  if (pathError) return { content, diagnostics: [pathError] };

  const parsed = parseJsonObject(content);
  if (isSafeJsonResult(parsed)) return parsed;

  const normalizedEntry = normalizeJsonValue(entry);
  if (!normalizedEntry.ok) return { content, diagnostics: [normalizedEntry.diagnostic] };

  const parent = parentForEntry(parsed.value, path.slice(0, -1), true);
  if (typeof parent === 'string') return { content, diagnostics: [parent] };

  const name = path[path.length - 1]!;
  if (sameJsonValue(parent[name], normalizedEntry.value)) return { content, diagnostics: [] };
  parent[name] = normalizedEntry.value;
  return { content: stringifyJson(parsed.value, content), diagnostics: [] };
}

/** Convenience form for callers that do not need malformed-input diagnostics. */
export function mergeNamedEntry(content: string, path: readonly string[], entry: unknown): string {
  return safeJsonMerge(content, path, entry).content;
}

/** Removes a named JSON object entry, leaving malformed input unmodified. */
export function safeJsonRemove(
  content: string,
  path: readonly string[],
  name: string,
): SafeJsonResult {
  const pathError = validatePath([...path, name]);
  if (pathError) return { content, diagnostics: [pathError] };

  const parsed = parseJsonObject(content);
  if (isSafeJsonResult(parsed)) return parsed;

  const parent = parentForEntry(parsed.value, path, false);
  if (typeof parent === 'string') return { content, diagnostics: [parent] };
  if (!(name in parent)) return { content, diagnostics: [] };

  delete parent[name];
  return { content: stringifyJson(parsed.value, content), diagnostics: [] };
}

/** Convenience form for callers that do not need malformed-input diagnostics. */
export function removeNamedEntry(content: string, path: readonly string[], name: string): string {
  return safeJsonRemove(content, path, name).content;
}
