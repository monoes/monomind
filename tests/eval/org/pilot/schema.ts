// tests/eval/org/pilot/schema.ts
//
// The pilot's document schema dialect (org sections spec 9.2, harness-only): a
// small JSON-Schema subset that fails closed. A keyword outside it is refused
// when a contract loads, never ignored, because a check that silently skips a
// rule would let a malformed hand-off through and still count it as validated.
const KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'title',
  'description',
]);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

const typeOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? 'number' : typeof v;

/** Throws on a keyword the dialect does not support, naming its path. */
export function assertSupportedSchema(schema: unknown, path = '$'): void {
  if (!isObj(schema)) throw new Error(`${path}: a schema must be an object`);
  for (const [k, v] of Object.entries(schema)) {
    if (!KEYWORDS.has(k))
      throw new Error(`${path}.${k}: keyword not supported by the pilot dialect`);
    if (k === 'additionalProperties' && typeof v !== 'boolean')
      throw new Error(`${path}.additionalProperties: only true or false is supported`);
    if (k === 'properties') {
      if (!isObj(v)) throw new Error(`${path}.properties: must be an object`);
      for (const [name, sub] of Object.entries(v))
        assertSupportedSchema(sub, `${path}.properties.${name}`);
    }
    if (k === 'items') assertSupportedSchema(v, `${path}.items`);
  }
}

/** The problems a value has against a schema; empty when it conforms. */
export function checkAgainstSchema(schema: Json, value: unknown, path = '$'): string[] {
  const problems: string[] = [];
  const t = schema.type as string | undefined;
  const actual = typeOf(value);
  if (t) {
    const ok = t === 'integer' ? Number.isInteger(value) : t === actual;
    if (!ok) return [`${path}: expected ${t}, got ${actual}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value))
    problems.push(`${path}: not one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength)
      problems.push(`${path}: shorter than ${schema.minLength} characters`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
      problems.push(`${path}: longer than ${schema.maxLength} characters`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      problems.push(`${path}: below ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      problems.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems)
      problems.push(`${path}: fewer than ${schema.minItems} items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
      problems.push(`${path}: more than ${schema.maxItems} items`);
    if (isObj(schema.items))
      value.forEach((item, i) =>
        problems.push(...checkAgainstSchema(schema.items as Json, item, `${path}[${i}]`)),
      );
  }
  if (isObj(value)) {
    const props = isObj(schema.properties) ? schema.properties : {};
    for (const r of (schema.required as string[] | undefined) ?? [])
      if (!(r in value)) problems.push(`${path}.${r}: required`);
    for (const [k, v] of Object.entries(value)) {
      if (k in props) problems.push(...checkAgainstSchema(props[k] as Json, v, `${path}.${k}`));
      else if (schema.additionalProperties === false) problems.push(`${path}.${k}: not allowed`);
    }
  }
  return problems;
}
