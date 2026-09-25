/**
 * Merge primitive for the generated instruction files (CLAUDE.md,
 * .agents/shared_instructions.md) that mix monomind's own body with
 * hand-authored project content.
 */

const MARKER_PREFIX = 'monomind-block';

/**
 * How many of the generator's own `## ` headings an unmarked region must
 * carry before it is treated as previously-generated content rather than
 * user prose that happens to share a title.
 */
const MIN_GENERATED_HEADINGS = 3;

function escapeForBlockMarker(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildBlock(marker: string, generated: string): string {
  return `<!-- ${MARKER_PREFIX}:${marker} -->\n${generated.trimEnd()}\n<!-- /${MARKER_PREFIX}:${marker} -->\n`;
}

/** The current delimiter form. */
function currentBlockPattern(marker: string): RegExp {
  const escaped = escapeForBlockMarker(marker);
  return new RegExp(
    `^<!-- ${MARKER_PREFIX}:${escaped} -->\\n[\\s\\S]*?^<!-- /${MARKER_PREFIX}:${escaped} -->\\n?`,
    'm',
  );
}

/**
 * The `# monomind:start <marker>` / `# monomind:end <marker>` delimiter form
 * (also written with `//` or `<!-- -->` comment syntax), so a file carrying
 * the older shape is migrated to the current one rather than gaining a second
 * copy beside it.
 *
 * Anchored to the SAME marker name on purpose: platform-adapters writes its
 * own `monomind:start instructions:claude` block into this very file, and
 * that block belongs to a different, still-live subsystem. Matching by
 * marker name means such blocks are never absorbed, rewritten, or deleted.
 */
function legacyMarkerPattern(marker: string): RegExp {
  const escaped = escapeForBlockMarker(marker);
  const commentPrefix = '(?:(?:#|//)\\s*|<!--\\s*)?';
  const suffix = '[^\\S\\r\\n]*(?:-->)?[^\\S\\r\\n]*(?:\\r?\\n|$)';
  return new RegExp(
    `^[\\t ]*${commentPrefix}monomind:start\\s+${escaped}${suffix}[\\s\\S]*?^[\\t ]*${commentPrefix}monomind:end\\s+${escaped}${suffix}`,
    'm',
  );
}

/** Opens or closes a fenced code block (``` or ~~~). */
function isFence(line: string): boolean {
  return /^\s{0,3}(?:```|~~~)/.test(line);
}

function sectionHeadings(markdown: string): Set<string> {
  const headings = new Set<string>();
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (isFence(line)) inFence = !inFence;
    else if (!inFence && line.startsWith('## ')) headings.add(line.trimEnd());
  }
  return headings;
}

/**
 * Locate a body this generator wrote *before* any delimiters existed, so an
 * upgrade replaces it instead of appending a second complete copy (GH #276).
 *
 * The region is bounded by things only the generator produces, never by
 * guesswork:
 *  - it must open on the generator's own exact title line;
 *  - it ends at the first following line that is a level-1 heading (the next
 *    document section, or a `# monomind:start …` marker owned by another
 *    subsystem) or a `## ` heading this generator never emits — i.e. anything
 *    that is demonstrably not ours terminates the region rather than being
 *    swallowed by it;
 *  - the region must contain at least MIN_GENERATED_HEADINGS of the
 *    generator's own section headings, so a file that merely borrows the
 *    title is left alone.
 *
 * The deliberate failure mode is under-matching: a legacy body interleaved
 * with user sections stops the region early, leaving some stale generated
 * text behind. That is recoverable; deleting hand-authored text is not.
 */
function findLegacyUnmarkedRange(
  lines: readonly string[],
  generated: string,
): { start: number; end: number } | null {
  const title = generated.split('\n')[0]?.trimEnd() ?? '';
  if (!/^# \S/.test(title)) return null;

  const known = sectionHeadings(generated);
  if (known.size < MIN_GENERATED_HEADINGS) return null;

  const start = lines.findIndex((line) => line.trimEnd() === title);
  if (start === -1) return null;

  let end = start + 1;
  let matched = 0;
  let inFence = false;
  for (; end < lines.length; end++) {
    const line = lines[end].trimEnd();
    // Shell comments inside ```bash fences look exactly like `# ` headings —
    // the generated body is full of them, so fences must be skipped or the
    // region stops on the first `# Build` and leaves the rest behind.
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^<!--\s*\/?monomind-block:/.test(line)) break;
    if (/^# /.test(line)) break;
    if (/^## /.test(line)) {
      if (!known.has(line)) break;
      matched++;
    }
  }
  if (inFence) return null; // unbalanced fence — can't tell structure from text
  if (matched < MIN_GENERATED_HEADINGS) return null;

  // Leave trailing blank lines outside the region so the spacing the user had
  // between the body and whatever follows it survives the replacement.
  while (end > start + 1 && lines[end - 1].trim() === '') end--;

  return { start, end };
}

/**
 * Confines generated content to a delimited
 * `<!-- monomind-block:<marker> -->` / `<!-- /monomind-block:<marker> -->`
 * pair within a file that may otherwise hold hand-authored content, so a
 * `--force` refresh only ever touches that one block. In order:
 *
 *  1. An unmarked body left by a pre-delimiter version is replaced in place
 *     (or, when a delimited block already exists elsewhere in the file,
 *     simply removed — that is the shape GH #276 produced, and it heals back
 *     to a single copy).
 *  2. A same-marker block in the current form is refreshed in place.
 *  3. A same-marker block in the older `monomind:start`/`monomind:end` form is
 *     migrated to the current form, in place.
 *  4. Otherwise the block is appended after whatever content already exists
 *     (verbatim, never modified).
 *
 * Every path is idempotent: a second run matches case 2 and rewrites byte-for-
 * byte identical content. Content outside the block is never touched.
 *
 * The delimiter text is deliberately NOT the `monomind:start <name>`
 * convention platform-adapters/merge.ts uses for its own instruction blocks:
 * that text is also matched, none too precisely, by the legacy bare-block
 * migration regexes in platform-adapters/migration.ts, which would treat a
 * newly-introduced `# monomind:start <name>` block as an old-style *bare*
 * block to migrate and could mangle it into an unrelated `instructions:*`
 * block. Distinct delimiter text sidesteps that rather than taking on a
 * dependency on that subsystem.
 */
export function dropLegacyUnmarked(text: string, generated: string): string {
  if (text.length === 0) return text;
  const lines = text.split('\n');
  const range = findLegacyUnmarkedRange(lines, generated);
  if (!range) return text;
  lines.splice(range.start, range.end - range.start);
  while (lines[range.start] === '' && (range.start === 0 || lines[range.start - 1] === '')) {
    lines.splice(range.start, 1);
  }
  return lines.join('\n');
}

/**
 * Swaps an undelimited generated body for `block`, keeping its position in the
 * file, or reports that there is none to swap (`null`) so the caller can fall
 * back to appending. Callers owning a different delimiter form reuse this and
 * `dropLegacyUnmarked` to get the same conservative detection — see
 * platform-adapters/merge.ts for the skill writer (GH #286).
 */
export function replaceLegacyUnmarked(
  text: string,
  generated: string,
  block: string,
): string | null {
  const lines = text.split('\n');
  const range = findLegacyUnmarkedRange(lines, generated);
  if (!range) return null;
  const blockLines = block.split('\n');
  blockLines.pop(); // the block's own trailing newline — not a blank line
  lines.splice(range.start, range.end - range.start, ...blockLines);
  return lines.join('\n');
}

/** The body of the current-form `marker` block in `text`, or null if absent. */
export function readGeneratedBlock(text: string, marker: string): string | null {
  const match = currentBlockPattern(marker).exec(text);
  if (!match) return null;
  return match[0].replace(/\n$/, '').split('\n').slice(1, -1).join('\n');
}

export function mergeGeneratedBlock(existing: string, marker: string, generated: string): string {
  const block = buildBlock(marker, generated);
  if (existing.length === 0) return block;

  // A delimited block already present is the authoritative copy: refresh it in
  // place. The text on either side of it is still swept for an unmarked body
  // left by a pre-delimiter version, which is the shape GH #276 produced — a
  // marked copy appended below an unmarked one. Splitting around the block
  // (rather than scanning the whole file) keeps the sweep from looking inside
  // the block it is about to rewrite.
  const delimited =
    currentBlockPattern(marker).exec(existing) ?? legacyMarkerPattern(marker).exec(existing);
  if (delimited) {
    const head = dropLegacyUnmarked(existing.slice(0, delimited.index), generated);
    const tail = dropLegacyUnmarked(
      existing.slice(delimited.index + delimited[0].length),
      generated,
    );
    return `${head}${block}${tail}`;
  }

  const unmarked = replaceLegacyUnmarked(existing, generated, block);
  if (unmarked !== null) return unmarked;

  const trimmed = existing.replace(/\n+$/, '');
  return `${trimmed}\n\n${block}`;
}
