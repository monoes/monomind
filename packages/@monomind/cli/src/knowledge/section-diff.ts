/**
 * Semantic diff between two versions of a captured page (RCL-08).
 *
 * A character diff of a re-captured page is noise: the byline date moved, an
 * ad slot re-rendered, the markdown re-wrapped. What a watcher actually wants
 * to be told is WHICH SECTIONS changed and roughly how much — "Pricing gained
 * a paragraph, Changelog got three new entries, everything else is the same".
 *
 * So the unit here is the markdown section (heading + body), keyed by its
 * full heading path, and the measure is words and sentences rather than
 * characters. Sentences are also what gives a change its sample line: the
 * first sentence that is in the new version and was not in the old one is the
 * most useful single thing to print.
 *
 * No dependency, no LLM: heading paths and sentence sets are enough to say
 * what moved.
 *
 * @module v1/cli/knowledge/section-diff
 */

export interface Section {
  /** Full heading path, e.g. `Pricing > Enterprise`. `(intro)` for text
   *  before the first heading. */
  key: string;
  heading: string;
  level: number;
  body: string;
}

export interface SectionChange {
  key: string;
  addedWords: number;
  removedWords: number;
  /** First sentence present in the new version and absent from the old. */
  sample?: string;
}

export interface SectionDiff {
  added: string[];
  removed: string[];
  changed: SectionChange[];
  unchanged: number;
  /** One line, ready to print or to put in a notification. */
  summary: string;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const INTRO_KEY = '(intro)';

/** Split markdown into sections keyed by heading path. Duplicate paths get a
 *  `#2` suffix so two "Notes" sections never collapse into one. */
export function splitSections(text: string): Section[] {
  const lines = String(text ?? '').split('\n');
  const stack: string[] = [];
  const sections: Section[] = [];
  const seen = new Map<string, number>();
  let current: Section = { key: INTRO_KEY, heading: INTRO_KEY, level: 0, body: '' };
  const buffer: string[] = [];

  const flush = () => {
    current.body = buffer.join('\n').trim();
    buffer.length = 0;
    if (current.key !== INTRO_KEY || current.body) sections.push(current);
  };

  let inFence = false;
  for (const line of lines) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING_RE.exec(line);
    if (!m) {
      buffer.push(line);
      continue;
    }
    flush();
    const level = m[1].length;
    const heading = m[2].trim();
    stack.length = Math.max(0, level - 1);
    stack[level - 1] = heading;
    let key = stack.filter(Boolean).join(' > ');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) key = `${key} #${n}`;
    current = { key, heading, level, body: '' };
  }
  flush();
  return sections;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Multiset difference: how many words the new body has that the old did not
 *  (and vice versa), so re-ordering a paragraph does not read as a rewrite. */
function wordDelta(oldBody: string, newBody: string): { added: number; removed: number } {
  const counts = new Map<string, number>();
  for (const w of words(oldBody)) counts.set(w, (counts.get(w) ?? 0) + 1);
  let added = 0;
  for (const w of words(newBody)) {
    const have = counts.get(w) ?? 0;
    if (have > 0) counts.set(w, have - 1);
    else added++;
  }
  let removed = 0;
  for (const n of counts.values()) removed += n;
  return { added, removed };
}

const SAMPLE_MAX = 160;

function firstNewSentence(oldBody: string, newBody: string): string | undefined {
  const before = new Set(sentences(oldBody));
  for (const s of sentences(newBody)) {
    if (before.has(s)) continue;
    return s.length > SAMPLE_MAX ? `${s.slice(0, SAMPLE_MAX - 1)}…` : s;
  }
  return undefined;
}

const SUMMARY_SECTIONS = 3;

function renderSummary(diff: Omit<SectionDiff, 'summary'>): string {
  const parts: string[] = [];
  if (diff.changed.length) parts.push(`${diff.changed.length} section(s) changed`);
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
  if (!parts.length) return 'text changed, but no section did — formatting only';
  const detail = [
    ...diff.changed
      .slice(0, SUMMARY_SECTIONS)
      .map((c) => `${c.key} (+${c.addedWords}/-${c.removedWords} words)`),
    ...diff.added.slice(0, SUMMARY_SECTIONS).map((k) => `+${k}`),
    ...diff.removed.slice(0, SUMMARY_SECTIONS).map((k) => `-${k}`),
  ];
  return detail.length ? `${parts.join(', ')} — ${detail.join('; ')}` : parts.join(', ');
}

/** What changed between two versions of the same page. */
export function diffSections(oldText: string, newText: string): SectionDiff {
  const before = new Map(splitSections(oldText).map((s) => [s.key, s]));
  const after = new Map(splitSections(newText).map((s) => [s.key, s]));

  const added: string[] = [];
  const changed: SectionChange[] = [];
  let unchanged = 0;

  for (const [key, section] of after) {
    const previous = before.get(key);
    if (!previous) {
      added.push(key);
      continue;
    }
    if (previous.body.replace(/\s+/g, ' ').trim() === section.body.replace(/\s+/g, ' ').trim()) {
      unchanged++;
      continue;
    }
    const delta = wordDelta(previous.body, section.body);
    changed.push({
      key,
      addedWords: delta.added,
      removedWords: delta.removed,
      ...(firstNewSentence(previous.body, section.body)
        ? { sample: firstNewSentence(previous.body, section.body) }
        : {}),
    });
  }
  const removed = [...before.keys()].filter((k) => !after.has(k));

  const diff = { added, removed, changed, unchanged };
  return { ...diff, summary: renderSummary(diff) };
}
