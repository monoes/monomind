// tests/eval/org/pilot/deliverables.ts
//
// Deliverable consistency (parallel-sweep-3 variant v2, harness-only): a contract may declare, per document,
// which files in the producer's workspace each part of the document must equal, and on which fields. The
// store reads those files (read-only, from the harness process) and compares them with what the producer
// sent. Fields not listed (the document-only `evidence`) are ignored on both sides; the files' own extra keys
// are ignored too (the scorer judges the strict shape, not this check).
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export interface Deliverable {
  /** Workspace-relative path of the file the producer writes. */
  file: string;
  /** The part of the document that must equal the file: the element of `array` whose `key` is `value`. */
  select: { array: string; key: string; value: string };
  /** Dotted field paths, `[]` for every element of a list: "module", "answers[].q". */
  compare: string[];
}

type Json = Record<string, any>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Throws on a deliverable that is not well formed or points outside the workspace. */
export function assertDeliverables(list: unknown, where: string): void {
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${where}: a non-empty list`);
  for (const [i, d] of list.entries()) {
    const at = `${where}[${i}]`;
    if (!isObj(d) || typeof d.file !== 'string' || !d.file) throw new Error(`${at}: needs a file`);
    if (isAbsolute(d.file) || relative('/w', resolve('/w', d.file)).startsWith('..'))
      throw new Error(`${at}: file must stay inside the workspace`);
    const s = d.select;
    if (!isObj(s) || !s.array || !s.key || typeof s.value !== 'string')
      throw new Error(`${at}: select needs array, key and value`);
    if (!Array.isArray(d.compare) || d.compare.length === 0)
      throw new Error(`${at}: compare needs at least one field`);
  }
}

type Paths = string[][];
const tokens = (p: string): string[] =>
  p.split('.').flatMap((s) => (s.endsWith('[]') ? [s.slice(0, -2), '[]'] : [s]));

/** A copy of `v` keeping only the listed fields; undefined when nothing is kept. */
function project(v: unknown, paths: Paths): unknown {
  if (paths.length === 0) return undefined;
  if (paths.some((p) => p.length === 0)) return v;
  if (Array.isArray(v)) {
    const rest = paths.filter((p) => p[0] === '[]').map((p) => p.slice(1));
    return rest.length ? v.map((x) => project(x, rest)) : undefined;
  }
  if (isObj(v)) {
    const out: Json = {};
    for (const k of new Set(paths.map((p) => p[0]))) {
      if (k === '[]' || !(k in v)) continue;
      const sub = project(
        v[k],
        paths.filter((p) => p[0] === k).map((p) => p.slice(1)),
      );
      if (sub !== undefined) out[k] = sub;
    }
    return out;
  }
  return v;
}

/** The first place two JSON values differ (object keys in any order, lists in order), or undefined. */
export function firstDifference(
  a: unknown,
  b: unknown,
  path = '$',
): { path: string; file: unknown; doc: unknown } | undefined {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return undefined;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const d = firstDifference(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return undefined;
  }
  return JSON.stringify(a) === JSON.stringify(b) ? undefined : { path, file: a, doc: b };
}

const show = (v: unknown) => {
  const s = v === undefined ? 'nothing' : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
};

export interface Mismatch {
  file: string;
  /** One sentence naming the file and the first differing field. */
  problem: string;
}

/** The deliverables whose file differs from `content`; empty when every one agrees. */
export function deliverableMismatches(
  workspace: string,
  list: Deliverable[],
  content: unknown,
): Mismatch[] {
  const out: Mismatch[] = [];
  const paths = (d: Deliverable): Paths => d.compare.map(tokens);
  for (const d of list) {
    let fileJson: unknown;
    try {
      fileJson = JSON.parse(readFileSync(join(workspace, d.file), 'utf8'));
    } catch (e) {
      const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
      out.push({
        file: d.file,
        problem: `${d.file} ${missing ? 'does not exist' : 'is not valid JSON'}; write it before publishing`,
      });
      continue;
    }
    const arr = isObj(content) ? content[d.select.array] : undefined;
    const part = Array.isArray(arr)
      ? arr.find((e) => isObj(e) && e[d.select.key] === d.select.value)
      : undefined;
    if (part === undefined) {
      out.push({
        file: d.file,
        problem: `the document has no ${d.select.array} entry with ${d.select.key} ${d.select.value} for ${d.file}`,
      });
      continue;
    }
    const diff = firstDifference(project(fileJson, paths(d)), project(part, paths(d)));
    if (diff)
      out.push({
        file: d.file,
        problem: `${d.file} differs from the document's ${d.select.array} entry ${d.select.value} at ${diff.path}: the file has ${show(diff.file)}, the document has ${show(diff.doc)}`,
      });
  }
  return out;
}
