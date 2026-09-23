/**
 * SKILL.md frontmatter allow-list. Platforms read execution config from the
 * frontmatter (`hooks`, `allowed-tools`, `model`, `context`, `agent`, …), so
 * staging rewrites it to the keys below before the package is hashed, and
 * projection re-checks the stored bytes with `frontmatterViolations`.
 */
import { parseFrontmatter } from '../orgrt/skill-library.js';

/** The only top-level frontmatter keys a catalog SKILL.md may carry. */
export const ALLOWED_FRONTMATTER_KEYS = [
  'name',
  'description',
  'tags',
  'tools',
  'license',
] as const;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const LIST_ITEM_RE = /^[A-Za-z0-9_.:/-]+$/;
const PLAIN_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const ALLOWED: readonly string[] = ALLOWED_FRONTMATTER_KEYS;

/**
 * Problems that keep `text` from being a canonical catalog SKILL.md: no
 * frontmatter, a key outside the allow-list, any line that is not a
 * single-line `key: value` (indented, flow-mapping, anchor, alias, tag or
 * block-scalar forms, or a value holding a U+2028/U+2029), or a `---`
 * anywhere in a line — Claude Code ends the frontmatter at the first `---`,
 * even mid-value, and would read the rest as body. Staging refuses what
 * `sanitizeFrontmatter` produces unless this is empty.
 */
export function frontmatterViolations(text: string): string[] {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return ['SKILL.md has no frontmatter'];
  const out: string[] = [];
  m[1].split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    if (line.includes('---')) return void out.push(`frontmatter line ${i + 1} contains "---"`);
    const kv = /^([A-Za-z_][\w-]*):(?: (.*))?$/.exec(line);
    if (!kv) out.push(`frontmatter line ${i + 1} is not a single-line key: value`);
    else if (!ALLOWED.includes(kv[1])) out.push(`frontmatter key "${kv[1]}" is not allowed`);
    else if (/^[{&*!|>]/.test(kv[2] ?? ''))
      out.push(`frontmatter key "${kv[1]}" has a non-scalar value`);
  });
  return out;
}

/**
 * Rewrites the frontmatter of `text` to the allow-listed keys, one line each
 * (strings JSON-quoted, lists as JSON arrays of plain tokens), keeping the
 * body byte-for-byte. `removed` names the dropped keys. Text without
 * frontmatter is returned unchanged (inspection then refuses it).
 */
export function sanitizeFrontmatter(text: string): { text: string; removed: string[] } {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { text, removed: [] };
  const { data, body } = parseFrontmatter(text);
  const topLevel = m[1].split(/\r?\n/).filter((l) => /^[^\s#]/.test(l));
  const keys = topLevel.map((l) => l.split(':')[0].trim().slice(0, 40));
  const removed = [...new Set(keys.filter((k) => !ALLOWED.includes(k)))];
  const q = JSON.stringify;
  const str = (v: string | string[]) => (Array.isArray(v) ? v.join(' ') : v);
  const list = (v: string | string[]) =>
    (Array.isArray(v) ? v : v.split(/[,\s]+/)).filter((s) => LIST_ITEM_RE.test(s));
  const lines: string[] = [];
  for (const key of ALLOWED_FRONTMATTER_KEYS) {
    const v = data[key];
    if (v === undefined) continue;
    if (key === 'tags' || key === 'tools') lines.push(`${key}: ${q(list(v))}`);
    else if (key === 'name' && typeof v === 'string' && PLAIN_NAME_RE.test(v))
      lines.push(`name: ${v}`);
    else lines.push(`${key}: ${q(str(v))}`);
  }
  return { text: ['---', ...lines, '---', ''].join('\n') + body, removed };
}
