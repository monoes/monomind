/** Safe, format-neutral primitives for Monomind-managed configuration content. */

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
  const suffix = '\\s*(?:-->)?[^\\S\\r\\n]*(?:\\r?\\n|$)';
  return new RegExp(
    `^[\\t ]*${commentPrefix}monomind:start\\s+${escapedMarker}${suffix}[\\s\\S]*?^[\\t ]*${commentPrefix}monomind:end\\s+${escapedMarker}${suffix}`,
    'gm',
  );
}

function lineEnding(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

type MarkerComment = '#' | '//';

function managedBlock(
  marker: string,
  content: string,
  eol: '\n' | '\r\n',
  comment: MarkerComment,
): string {
  const body = content.replace(/\r\n|\r|\n/g, eol).replace(new RegExp(`(?:${eol})+$`), '');
  const start = `${comment} monomind:start ${marker}`;
  const end = `${comment} monomind:end ${marker}`;
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

/** Removes exactly one artifact/platform block, leaving all other content unchanged. */
export function removeManagedBlock(content: string, artifact: string, platform: string): string {
  return removeManagedMarker(content, `${artifact}:${platform}`);
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
): SafeJsonResult {
  const renderedEnd = frontmatterEnd(rendered);
  const name = skillName(rendered);
  if (renderedEnd === undefined || !name)
    return { content: existing, diagnostics: ['ERROR: rendered skill has invalid frontmatter'] };
  if (!existing) {
    const header = rendered.slice(0, renderedEnd);
    const body = rendered.slice(renderedEnd).replace(/^\n/, '');
    return { content: `${header}${mergeManagedBlock('', marker, body)}`, diagnostics: [] };
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
  return { content: `${header}${mergeManagedBlock(body, marker, renderedBody)}`, diagnostics: [] };
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
