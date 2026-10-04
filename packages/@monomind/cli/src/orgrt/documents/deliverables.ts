// orgrt/documents/deliverables.ts
//
// Deliverable consistency, the comparison half (org sections spec open item 18a, plan P3.10): a contract's
// `deliverable_files` say which files in the producer's workspace each part of a document must equal, and on
// which fields. This file reads those files read-only and contained (a path that leaves the workspace, a link
// that escapes it, a file that is not a regular file or is over the document size limit is a refusal, never a
// read) and names the first field where a file and the document differ. Fields a compare list does not name
// (document-only `evidence`, the file's own extra keys) are ignored on both sides.
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { MAX_DOCUMENT_BYTES } from './contract.js';
import { isObj, type JsonObject } from './json.js';
import type { DeliverableFile } from './types.js';

export interface Mismatch {
  file: string;
  /** One sentence naming the file and (when both exist) the first differing field. */
  problem: string;
}

type Read = { ok: true; value: unknown } | { ok: false; problem: string };
type Paths = string[][];

/** `answers[].q` -> ['answers', '[]', 'q']. */
const segments = (p: string): string[] =>
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
    const out: JsonObject = {};
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

const show = (v: unknown): string => {
  const s = v === undefined ? 'nothing' : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
};

/** Read and parse one workspace file: contained, regular, bounded (see the file header). */
export function readWorkspaceJson(workspace: string, file: string): Read {
  const no = (why: string): Read => ({ ok: false, problem: `${file} ${why}` });
  let root: string;
  try {
    root = realpathSync(workspace);
  } catch {
    return no('cannot be read: the producer workspace is not available');
  }
  if (!file || file.includes('\0') || isAbsolute(file) || file.split(/[\\/]/).includes('..'))
    return no('is not a path inside your workspace');
  const lexical = resolve(root, file);
  if (relative(root, lexical).startsWith('..')) return no('is not a path inside your workspace');
  let real: string;
  try {
    real = realpathSync(lexical);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT'
      ? no('does not exist; write it before publishing')
      : no('cannot be read');
  }
  if (real !== root && !real.startsWith(root + sep)) return no('resolves outside your workspace');
  let fd: number | undefined;
  try {
    if (!statSync(real).isFile()) return no('is not a regular file');
    fd = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile()) return no('is not a regular file');
    if (st.size > MAX_DOCUMENT_BYTES) return no(`is over the ${MAX_DOCUMENT_BYTES} byte limit`);
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) {
      const r = readSync(fd, buf, n, st.size - n, n);
      if (r === 0) break;
      n += r;
    }
    try {
      return { ok: true, value: JSON.parse(buf.subarray(0, n).toString('utf8')) };
    } catch {
      return no('is not valid JSON; write it before publishing');
    }
  } catch {
    return no('cannot be read');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The deliverables whose file differs from `body` (what the producer sent); empty when every one agrees. */
export function deliverableMismatches(
  workspace: string,
  list: readonly DeliverableFile[],
  body: unknown,
): Mismatch[] {
  const out: Mismatch[] = [];
  for (const d of list) {
    const read = readWorkspaceJson(workspace, d.file);
    if (!read.ok) {
      out.push({ file: d.file, problem: read.problem });
      continue;
    }
    const arr = isObj(body) ? body[d.select.array] : undefined;
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
    const paths = d.compare.map(segments);
    const diff = firstDifference(project(read.value, paths), project(part, paths));
    if (diff)
      out.push({
        file: d.file,
        problem: `${d.file} differs from the document's ${d.select.array} entry ${d.select.value} at ${diff.path}: the file has ${show(diff.file)}, the document has ${show(diff.doc)}`,
      });
  }
  return out;
}
