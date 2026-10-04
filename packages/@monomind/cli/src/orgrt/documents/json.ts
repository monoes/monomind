// orgrt/documents/json.ts
//
// Small JSON helpers shared by the dialects: plain-object test, JSON type names, deep equality, and a bounded
// check that a value is JSON data at all (no undefined, NaN, Infinity, functions, class instances or cycles).
export type JsonObject = { [k: string]: unknown };

export const isObj = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `{...}` or `Object.create(null)`: what JSON.parse produces. Anything else is not plain data. */
export const isPlainObject = (v: unknown): v is JsonObject => {
  if (!isObj(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

export const typeOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

export const MAX_JSON_DEPTH = 256;

/** True when `v` is JSON data: finite numbers, plain objects, arrays, strings, booleans, null; acyclic and bounded. */
export function isJsonValue(v: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) if (!(i in v) || !isJsonValue(v[i], depth + 1)) return false;
    return true;
  }
  if (isPlainObject(v)) return Object.values(v).every((x) => isJsonValue(x, depth + 1));
  return false;
}

/** JSON Schema equality: same type, same members, order of keys irrelevant, order of items relevant. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return (
      ka.length === Object.keys(b).length &&
      ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
    );
  }
  return false;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;
/** `base.name`, or `base["odd name"]` when the name is not identifier-like. */
export const member = (base: string, name: string): string =>
  IDENT.test(name) ? `${base}.${name}` : `${base}[${JSON.stringify(name)}]`;
