// orgrt/documents/schema-ref.ts
//
// The outer schema loader (spec 6.2): a contract schema is authored inline or as `{ "$ref": "path.json" }`, a
// file inside the project. This is separate from the dialect, which has no references at all. The path is
// resolved with symlinks followed, must land inside the real project root, and must be a regular file within the
// size bound; the loaded bytes are snapshotted (parsed value plus byte count and sha-256) so a later edit of the
// file cannot change a contract that already pinned it. Read-only: nothing is written.
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { type DocProblem, throwIfProblems } from './errors.js';
import { isObj, type JsonObject } from './json.js';
import { assertSupportedSchema, MAX_SCHEMA_BYTES } from './schema-dialect.js';

export interface SchemaSnapshot {
  schema: JsonObject;
  /** Where it came from; null for an inline schema. `path` is relative to the real project root. */
  source: { path: string; bytes: number; sha256: string } | null;
}

const fail = (code: DocProblem['code'], message: string, remedy?: string): never =>
  throwIfProblems([{ code, path: '$ref', message, remedy }]) as never;

/** Loads `ref` (a path under `projectRoot`), checks it against the dialect and returns the snapshot. */
export function loadSchemaRef(projectRoot: string, ref: unknown): SchemaSnapshot {
  if (typeof ref !== 'string' || !ref)
    return fail('SCHEMA_REF_INVALID', '$ref must be a path string');
  if (ref.includes('\0')) return fail('SCHEMA_REF_INVALID', 'the path holds a NUL byte');
  if (ref.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(ref))
    return fail(
      'SCHEMA_REF_INVALID',
      `"${ref}" is not a project file path`,
      'use a path like schemas/findings.json',
    );
  if (!ref.endsWith('.json')) return fail('SCHEMA_REF_INVALID', `"${ref}" is not a .json file`);
  let realRoot: string;
  let real: string;
  try {
    realRoot = realpathSync(projectRoot);
  } catch {
    return fail('SCHEMA_REF_UNREADABLE', 'the project root cannot be resolved');
  }
  try {
    real = realpathSync(isAbsolute(ref) ? ref : resolve(realRoot, ref));
  } catch {
    return fail('SCHEMA_REF_UNREADABLE', `"${ref}" does not exist`);
  }
  const rel = relative(realRoot, real);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    return fail(
      'SCHEMA_REF_ESCAPE',
      `"${ref}" resolves outside the project`,
      'keep schema files inside the project, symlinks included',
    );
  let text: string;
  let bytes = 0;
  let sha256 = '';
  const fd = openSync(real, 'r');
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return fail('SCHEMA_REF_UNREADABLE', `"${ref}" is not a regular file`);
    if (st.size > MAX_SCHEMA_BYTES)
      return fail(
        'SCHEMA_TOO_LARGE',
        `${st.size} bytes exceeds the ${MAX_SCHEMA_BYTES} byte limit`,
      );
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) {
      const r = readSync(fd, buf, n, st.size - n, n);
      if (r === 0) break;
      n += r;
    }
    text = buf.subarray(0, n).toString('utf8');
    bytes = n;
    sha256 = createHash('sha256').update(buf.subarray(0, n)).digest('hex');
  } finally {
    closeSync(fd);
  }
  let schema: unknown;
  try {
    schema = JSON.parse(text);
  } catch {
    return fail('SCHEMA_REF_NOT_JSON', `"${ref}" is not valid JSON`);
  }
  assertSupportedSchema(schema);
  return {
    schema: schema as JsonObject,
    source: { path: rel.split(sep).join('/'), bytes, sha256 },
  };
}

/** An inline schema (checked against the dialect) or a `{ "$ref": "path.json" }` file load. */
export function resolveSchemaSource(input: unknown, projectRoot: string): SchemaSnapshot {
  if (isObj(input) && Object.hasOwn(input, '$ref')) {
    if (Object.keys(input).length !== 1)
      return fail(
        'SCHEMA_REF_INVALID',
        'a $ref schema holds no other keyword',
        'put the keywords in the referenced file',
      );
    return loadSchemaRef(projectRoot, input.$ref);
  }
  assertSupportedSchema(input);
  return { schema: input as JsonObject, source: null };
}
