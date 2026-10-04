// packages/@monomind/cli/src/orgrt/documents/guidance-schema.ts
//
// A short, readable summary of a contract schema for the role text (plan P3.12): the field names and kinds a
// producer must write, nothing more. The full schema stays one org_doc_list call away. Pure: a function of the
// schema only, bounded in size, deterministic.
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const MAX_ENUM_SHOWN = 4;

function count(s: Record<string, unknown>): string {
  const lo = s.minItems;
  const hi = s.maxItems;
  if (typeof lo === 'number' && lo === hi) return ` x${lo}`;
  if (typeof lo === 'number' && typeof hi === 'number') return ` x${lo}-${hi}`;
  if (typeof lo === 'number') return ` x${lo}+`;
  if (typeof hi === 'number') return ` up to x${hi}`;
  return '';
}

function render(s: unknown, depth: number): string {
  if (!isObj(s)) return 'any';
  if (Array.isArray(s.enum))
    return s.enum.length <= MAX_ENUM_SHOWN
      ? s.enum.map((v) => JSON.stringify(v)).join('|')
      : `one of ${s.enum.length} fixed values`;
  if ('const' in s) return JSON.stringify(s.const);
  if (s.type === 'array')
    return depth <= 0 ? '[...]' : `[${render(s.items, depth - 1)}]${count(s)}`;
  if (s.type === 'object') {
    const props = isObj(s.properties) ? s.properties : {};
    if (!Object.keys(props).length) return 'object';
    if (depth <= 0) return '{...}';
    const required = new Set(Array.isArray(s.required) ? s.required : []);
    const fields = Object.entries(props).map(
      ([k, v]) => `${k}${required.has(k) ? '' : '?'}: ${render(v, depth - 1)}`,
    );
    return `{${fields.join(', ')}}`;
  }
  return typeof s.type === 'string' ? s.type : 'any';
}

/** The summary, as deep as fits in `cap` characters (the top level alone when nothing deeper fits). */
export function schemaSummary(schema: unknown, cap = 360): string {
  for (let depth = 5; depth >= 1; depth--) {
    const out = render(schema, depth);
    if (out.length <= cap) return out;
  }
  return `${render(schema, 1).slice(0, cap - 3)}...`;
}
