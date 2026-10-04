// orgrt/documents/canonical.ts
//
// Canonical JSON for hashing a contract (org sections spec 6.2, contract revision). The form is RFC 8785
// (JSON Canonicalization Scheme) over the value space the dialects use: object keys sorted by UTF-16 code unit,
// no whitespace, strings and numbers serialized exactly as ECMAScript JSON.stringify does (which is what JCS
// specifies), `-0` as `0`. Text is NOT Unicode-normalized: the same characters spelled with different code
// points hash differently, as in JCS. Values with no JSON form are refused, never coerced: undefined, NaN,
// Infinity, bigint, functions, symbols, class instances (Date, Map, ...), cycles, and `undefined` inside an
// array. An object member whose value is undefined is treated as absent, as JSON.stringify does.
import { DocError } from './errors.js';
import { isPlainObject, MAX_JSON_DEPTH } from './json.js';

const refuse = (path: string, message: string): never => {
  throw new DocError([{ code: 'CANONICAL_UNSUPPORTED_VALUE', path, message }]);
};

function emit(v: unknown, path: string, depth: number): string {
  if (depth > MAX_JSON_DEPTH) return refuse(path, 'nested too deeply (or a cycle)');
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return JSON.stringify(v);
    case 'number':
      return Number.isFinite(v) ? JSON.stringify(v) : refuse(path, `${v} has no JSON form`);
    case 'object':
      break;
    default:
      return refuse(path, `a ${typeof v} has no JSON form`);
  }
  if (Array.isArray(v)) {
    const items: string[] = [];
    for (let i = 0; i < v.length; i++) {
      if (!(i in v) || v[i] === undefined)
        refuse(`${path}[${i}]`, 'undefined in a list has no JSON form');
      items.push(emit(v[i], `${path}[${i}]`, depth + 1));
    }
    return `[${items.join(',')}]`;
  }
  if (!isPlainObject(v))
    return refuse(path, 'only plain objects, lists and scalars have a JSON form');
  const parts: string[] = [];
  for (const k of Object.keys(v).sort()) {
    if (v[k] === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${emit(v[k], `${path}.${k}`, depth + 1)}`);
  }
  return `{${parts.join(',')}}`;
}

/** The canonical JSON text of `value`; throws a DocError (CANONICAL_UNSUPPORTED_VALUE) for a non-JSON value. */
export const canonicalJson = (value: unknown): string => emit(value, '$', 0);
