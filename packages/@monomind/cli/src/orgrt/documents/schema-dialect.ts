// orgrt/documents/schema-dialect.ts
//
// The `org-schema-v1` document schema dialect (org sections spec 6.2): a small JSON Schema subset, draft 2020-12
// semantics, that fails closed. A keyword outside it is refused when a contract loads, never ignored, because a
// rule that is silently skipped would let a malformed document through and still count it as validated. Pure: the
// validator is its own (no converter), so there is no gap between what is declared and what is enforced. The one
// file read, `loadSchemaRef`, lives in schema-ref.ts.
import { type DocProblem, throwIfProblems, type ValueProblem } from './errors.js';
import { deepEqual, isJsonValue, isObj, type JsonObject, member, typeOf } from './json.js';

export const SCHEMA_DIALECT = 'org-schema-v1';
export const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
export const MAX_SCHEMA_BYTES = 256 * 1024;
export const MAX_SCHEMA_DEPTH = 32;

const SCHEMA_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
const VALIDATION = new Set([
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
]);
const ANNOTATIONS = new Set(['$schema', 'title', 'description', 'examples']);

const REMEDY: Record<string, string> = {
  $ref: 'inline the schema; only the whole contract schema may be a {"$ref": "path.json"} file, nested references are unsupported',
  $defs: 'inline the definition where it is used',
  definitions: 'inline the definition where it is used',
  $id: 'remove it; identifiers are not used',
  $anchor: 'remove it; references are unsupported',
  $dynamicRef: 'recursive schemas are unsupported',
  $comment: 'use description',
  minProperties: 'rejected in v1 (not enforceable here); list the keys under required',
  maxProperties: 'rejected in v1; use additionalProperties: false with explicit properties',
  uniqueItems: 'rejected in v1; check uniqueness with a contract check or in the consumer',
  pattern: 'use enum, const, or minLength/maxLength',
  format: 'use enum, const, or minLength/maxLength',
  multipleOf: 'use type integer, minimum and maximum',
  exclusiveMinimum: 'use minimum',
  exclusiveMaximum: 'use maximum',
  oneOf: 'combinators are unsupported; use enum or one schema',
  anyOf: 'combinators are unsupported; use enum or one schema',
  allOf: 'combinators are unsupported; merge the schemas',
  not: 'negation is unsupported',
  if: 'conditionals are unsupported',
  // biome-ignore lint/suspicious/noThenProperty: `then` is a JSON Schema keyword refused by name
  then: 'conditionals are unsupported',
  else: 'conditionals are unsupported',
  patternProperties: 'declare each property under properties',
  propertyNames: 'declare each property under properties',
  prefixItems: 'tuples are unsupported; items takes one schema',
  contains: 'unsupported',
  dependentRequired: 'unsupported',
  dependentSchemas: 'unsupported',
  unevaluatedProperties: 'use additionalProperties',
  unevaluatedItems: 'unsupported',
  default: 'remove it; defaults are not applied',
  readOnly: 'remove it',
  writeOnly: 'remove it',
  deprecated: 'remove it',
};

const nonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function walk(s: unknown, path: string, depth: number, out: DocProblem[]): void {
  if (depth > MAX_SCHEMA_DEPTH) {
    out.push({
      code: 'SCHEMA_TOO_DEEP',
      path,
      message: `nested more than ${MAX_SCHEMA_DEPTH} levels`,
      remedy: 'flatten the schema',
    });
    return;
  }
  if (!isObj(s)) {
    out.push({
      code: 'SCHEMA_NOT_OBJECT',
      path,
      message: 'a schema must be an object',
      remedy:
        typeof s === 'boolean'
          ? 'boolean schemas are unsupported; use {} or additionalProperties'
          : undefined,
    });
    return;
  }
  const bad = (code: DocProblem['code'], at: string, message: string, remedy?: string) =>
    out.push({ code, path: at, message, remedy });
  for (const [k, v] of Object.entries(s)) {
    const at = member(path, k);
    if (!VALIDATION.has(k) && !ANNOTATIONS.has(k)) {
      bad(
        'SCHEMA_UNSUPPORTED_KEYWORD',
        at,
        `keyword not supported by ${SCHEMA_DIALECT}`,
        REMEDY[k] ?? `use only the ${SCHEMA_DIALECT} keywords`,
      );
      continue;
    }
    switch (k) {
      case 'type':
        if (typeof v !== 'string')
          bad(
            'SCHEMA_INVALID_KEYWORD_VALUE',
            at,
            'type must be one string',
            'type lists are unsupported',
          );
        else if (!SCHEMA_TYPES.includes(v))
          bad(
            'SCHEMA_UNKNOWN_TYPE',
            at,
            `unknown type "${v}"`,
            `one of ${SCHEMA_TYPES.join(', ')}`,
          );
        break;
      case 'enum':
        if (!Array.isArray(v) || v.length === 0)
          bad('SCHEMA_INVALID_KEYWORD_VALUE', at, 'enum must be a non-empty list');
        else if (!isJsonValue(v)) bad('SCHEMA_NOT_JSON', at, 'enum holds a value that is not JSON');
        break;
      case 'const':
        if (!isJsonValue(v)) bad('SCHEMA_NOT_JSON', at, 'const is not a JSON value');
        break;
      case 'examples':
        if (!Array.isArray(v)) bad('SCHEMA_INVALID_KEYWORD_VALUE', at, 'examples must be a list');
        else if (!isJsonValue(v))
          bad('SCHEMA_NOT_JSON', at, 'examples holds a value that is not JSON');
        break;
      case 'properties':
        if (!isObj(v)) bad('SCHEMA_INVALID_KEYWORD_VALUE', at, 'properties must be an object');
        else
          for (const [name, sub] of Object.entries(v)) walk(sub, member(at, name), depth + 1, out);
        break;
      case 'required':
        if (!Array.isArray(v) || v.some((r) => typeof r !== 'string'))
          bad('SCHEMA_INVALID_KEYWORD_VALUE', at, 'required must be a list of strings');
        else if (new Set(v).size !== v.length)
          bad('SCHEMA_INVALID_KEYWORD_VALUE', at, 'required lists a name twice');
        break;
      case 'additionalProperties':
        if (typeof v !== 'boolean') walk(v, at, depth + 1, out);
        break;
      case 'items':
        if (Array.isArray(v))
          bad(
            'SCHEMA_INVALID_KEYWORD_VALUE',
            at,
            'items must be one schema',
            'tuple form is unsupported',
          );
        else walk(v, at, depth + 1, out);
        break;
      case 'minLength':
      case 'maxLength':
      case 'minItems':
      case 'maxItems':
        if (!nonNegInt(v))
          bad('SCHEMA_INVALID_KEYWORD_VALUE', at, `${k} must be a non-negative integer`);
        break;
      case 'minimum':
      case 'maximum':
        if (typeof v !== 'number' || !Number.isFinite(v))
          bad('SCHEMA_INVALID_KEYWORD_VALUE', at, `${k} must be a finite number`);
        break;
      case '$schema':
        if (v !== JSON_SCHEMA_2020_12)
          bad(
            'SCHEMA_INVALID_KEYWORD_VALUE',
            at,
            `$schema must be ${JSON_SCHEMA_2020_12}`,
            'the dialect has 2020-12 semantics',
          );
        break;
      default: // title, description
        if (typeof v !== 'string') bad('SCHEMA_INVALID_KEYWORD_VALUE', at, `${k} must be a string`);
    }
  }
}

/** Every reason the schema is outside the dialect (all of them, not the first); empty when it is supported. */
export function validateSchema(schema: unknown): DocProblem[] {
  const out: DocProblem[] = [];
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(schema) ?? '', 'utf8');
  } catch {
    return [
      {
        code: 'SCHEMA_NOT_JSON',
        path: '$',
        message: 'the schema is not JSON data (cycle or too deep)',
      },
    ];
  }
  if (bytes > MAX_SCHEMA_BYTES)
    return [
      {
        code: 'SCHEMA_TOO_LARGE',
        path: '$',
        message: `${bytes} bytes exceeds the ${MAX_SCHEMA_BYTES} byte limit`,
        remedy: 'shorten the schema',
      },
    ];
  walk(schema, '$', 1, out);
  return out;
}

/** Throws a DocError (code of the first problem, all problems listed) when the schema is outside the dialect. */
export function assertSupportedSchema(schema: unknown): void {
  throwIfProblems(validateSchema(schema));
}

const vp = (code: ValueProblem['code'], path: string, message: string): ValueProblem => ({
  code,
  path,
  message,
});
const points = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

function check(schema: JsonObject, value: unknown, path: string, out: ValueProblem[]): void {
  const t = schema.type as string | undefined;
  const actual = typeOf(value);
  if (t) {
    const ok =
      t === 'integer'
        ? Number.isInteger(value)
        : t === 'number'
          ? actual === 'number'
          : t === actual;
    if (!ok) {
      out.push(vp('VALUE_TYPE', path, `expected ${t}, got ${actual}`));
      return;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(e, value)))
    out.push(
      vp('VALUE_ENUM', path, `not one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`),
    );
  if (Object.hasOwn(schema, 'const') && !deepEqual(schema.const, value))
    out.push(vp('VALUE_CONST', path, `not equal to ${JSON.stringify(schema.const)}`));
  if (typeof value === 'string') {
    const n = points(value);
    if (typeof schema.minLength === 'number' && n < schema.minLength)
      out.push(vp('VALUE_TOO_SHORT', path, `shorter than ${schema.minLength} characters`));
    if (typeof schema.maxLength === 'number' && n > schema.maxLength)
      out.push(vp('VALUE_TOO_LONG', path, `longer than ${schema.maxLength} characters`));
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      out.push(vp('VALUE_BELOW_MINIMUM', path, `below ${schema.minimum}`));
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      out.push(vp('VALUE_ABOVE_MAXIMUM', path, `above ${schema.maximum}`));
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems)
      out.push(vp('VALUE_TOO_FEW_ITEMS', path, `fewer than ${schema.minItems} items`));
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
      out.push(vp('VALUE_TOO_MANY_ITEMS', path, `more than ${schema.maxItems} items`));
    if (isObj(schema.items))
      value.forEach((item, i) => check(schema.items as JsonObject, item, `${path}[${i}]`, out));
  }
  if (isObj(value)) {
    const props = isObj(schema.properties) ? schema.properties : {};
    for (const r of (schema.required as string[] | undefined) ?? [])
      if (!Object.hasOwn(value, r)) out.push(vp('VALUE_REQUIRED', member(path, r), 'required'));
    for (const [k, v] of Object.entries(value)) {
      if (Object.hasOwn(props, k)) check(props[k] as JsonObject, v, member(path, k), out);
      else if (schema.additionalProperties === false)
        out.push(vp('VALUE_NOT_ALLOWED', member(path, k), 'not allowed'));
      else if (isObj(schema.additionalProperties))
        check(schema.additionalProperties, v, member(path, k), out);
    }
  }
}

/**
 * The problems a value has against a supported schema; empty when it conforms. The schema must already have
 * passed validateSchema (this does not re-check it). A value that is not JSON data is one VALUE_NOT_JSON problem.
 */
export function validateValue(schema: JsonObject, value: unknown): ValueProblem[] {
  if (!isJsonValue(value)) return [vp('VALUE_NOT_JSON', '$', 'not a JSON value')];
  const out: ValueProblem[] = [];
  check(schema, value, '$', out);
  return out;
}

/** validateValue as `path: message` lines (the prototype's checkAgainstSchema output). */
export const checkAgainstSchema = (schema: JsonObject, value: unknown): string[] =>
  validateValue(schema, value).map((p) => `${p.path}: ${p.message}`);
