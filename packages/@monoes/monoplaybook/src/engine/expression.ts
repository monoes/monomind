import type { Item } from './types.js';

const TEMPLATE_PATTERN = '\\{\\{([^}]+)\\}\\}';

/** Env var names matching this pattern are blocked from $env expressions to prevent secret exfiltration. */
const ENV_DENYLIST = /(_KEY|_TOKEN|_SECRET|_PASSWORD|_JWT|_API_KEY|_PRIVATE_KEY|_PASS|_PWD|_CERT|_PEM|_CREDENTIAL|_CREDENTIALS|_AUTH)$/i;
type ParsedTemplate = RegExpMatchArray[];
const cache = new Map<string, ParsedTemplate>();

function extractTemplates(template: string): ParsedTemplate {
  if (cache.has(template)) return cache.get(template)!;
  // LRU eviction: drop the oldest entry rather than clearing all at once (thundering-herd).
  if (cache.size >= 500) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const matches = [...template.matchAll(new RegExp(TEMPLATE_PATTERN, 'g'))];
  cache.set(template, matches);
  return matches;
}

export function resolveExpression(
  template: string,
  item: Item,
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
  allowEnvAccess?: boolean,
): string {
  const matches = extractTemplates(template);
  if (matches.length === 0) return template;

  let result = template;
  for (const match of matches) {
    const expr = match[1].trim();
    const value = resolveToken(expr, item, nodeOutputs, params, allowEnvAccess);
    result = result.split(match[0]).join(String(value));
  }
  return result;
}

function resolveToken(
  expr: string,
  item: Item,
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
  allowEnvAccess?: boolean,
): unknown {
  if (expr.startsWith('$json.')) {
    const path = expr.slice(6).split('.');
    // Walk nested path: $json.user.name resolves into { user: { name: ... } }
    let val: unknown = item.data;
    for (const segment of path) {
      if (val === null || val === undefined || typeof val !== 'object') {
        throw new Error(`Unresolved: $json.${path.join('.')} — "${segment}" is not an object`);
      }
      val = (val as Record<string, unknown>)[segment];
    }
    if (val === undefined) throw new Error(`Unresolved: $json.${path.join('.')} not found in item data`);
    return val;
  }
  if (expr.startsWith('$env.')) {
    const key = expr.slice(5);
    if (!allowEnvAccess && ENV_DENYLIST.test(key)) {
      throw new Error(
        `Blocked: env var "${key}" matches secret pattern. Set allowEnvAccess: true in playbook config to override.`,
      );
    }
    const val = process.env[key];
    if (val === undefined) throw new Error(`Unresolved: $env.${key} not set`);
    return val;
  }
  if (expr.startsWith('params.')) {
    const key = expr.slice(7);
    if (!(key in params)) throw new Error(`Unresolved: params.${key} not provided`);
    return params[key];
  }
  if (expr.startsWith('$node.') || expr.startsWith('$node["')) {
    let nodeId: string;
    let field: string;
    if (expr.startsWith('$node["')) {
      // $node["NodeId"].field
      const bracketEnd = expr.indexOf('"].');
      if (bracketEnd === -1) throw new Error(`Unresolved: malformed $node bracket expression: ${expr}`);
      nodeId = expr.slice(7, bracketEnd);       // slice off '$node["'
      field = expr.slice(bracketEnd + 3);       // slice off '"].'
    } else {
      // $node.NodeId.field
      const parts = expr.slice(6).split('.');
      nodeId = parts[0];
      field = parts.slice(1).join('.');
    }
    const items = nodeOutputs[nodeId];
    if (!items || items.length === 0) throw new Error(`Unresolved: $node.${nodeId} has no output`);
    const val = items[0].data[field];
    if (val === undefined) throw new Error(`Unresolved: $node.${nodeId}.${field} not found`);
    return val;
  }
  if (expr.startsWith('fn:')) {
    return resolveFnCall(expr.slice(3), item, nodeOutputs, params, allowEnvAccess);
  }
  // Named ref (e.g. {{box}} from a find step) — action executor resolves these using its element handle map
  return `{{${expr}}}`;
}

// ---------------------------------------------------------------------------
// Function call registry
// ---------------------------------------------------------------------------

type FnArg = string | number | boolean | unknown[] | null;

/** Parse `funcname(arg1, arg2, ...)` into [name, rawArgsString]. */
function parseFnCall(call: string): { name: string; rawArgs: string } {
  const parenStart = call.indexOf('(');
  if (parenStart === -1) {
    // No parens — treat whole string as name with no args
    return { name: call.trim(), rawArgs: '' };
  }
  const name = call.slice(0, parenStart).trim();
  if (!call.endsWith(')')) throw new Error(`fn:${call} — missing closing parenthesis`);
  const rawArgs = call.slice(parenStart + 1, -1);
  return { name, rawArgs };
}

/**
 * Split a raw args string by top-level commas (respects nested parentheses and quotes).
 * e.g. "upper($json.name), foo(a,b)" → ["upper($json.name)", "foo(a,b)"]
 */
function splitArgs(rawArgs: string): string[] {
  if (!rawArgs.trim()) return [];
  const args: string[] = [];
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let current = '';
  for (let i = 0; i < rawArgs.length; i++) {
    const ch = rawArgs[i];
    if (ch === "'" && !inDoubleQuote) { inSingleQuote = !inSingleQuote; current += ch; continue; }
    if (ch === '"' && !inSingleQuote) { inDoubleQuote = !inDoubleQuote; current += ch; continue; }
    if (!inSingleQuote && !inDoubleQuote) {
      if (ch === '(') { depth++; current += ch; continue; }
      if (ch === ')') { depth--; current += ch; continue; }
      if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/** Strip surrounding single or double quotes from a string literal arg. */
function unquote(s: string): string {
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Resolve a single argument token. If it looks like a known expression prefix
 * (`$json.`, `$env.`, `params.`, `$node.`, `fn:`) recurse via resolveToken;
 * otherwise treat as a string literal (stripping quotes).
 */
function resolveArg(
  arg: string,
  item: Item,
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
  allowEnvAccess: boolean | undefined,
): FnArg {
  const trimmed = arg.trim();
  if (
    trimmed.startsWith('$json.') ||
    trimmed.startsWith('$env.') ||
    trimmed.startsWith('params.') ||
    trimmed.startsWith('$node.') ||
    trimmed.startsWith('$node["') ||
    trimmed.startsWith('fn:')
  ) {
    return resolveToken(trimmed, item, nodeOutputs, params, allowEnvAccess) as FnArg;
  }
  // Numeric literal?
  if (!isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed);
  return unquote(trimmed);
}

function isTruthy(v: FnArg): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '' && v !== 'false' && v !== '0';
  if (v === null || v === undefined) return false;
  return true;
}

function resolveFnCall(
  call: string,
  item: Item,
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
  allowEnvAccess: boolean | undefined,
): unknown {
  const { name, rawArgs } = parseFnCall(call);
  const rawArgList = splitArgs(rawArgs);
  const args = rawArgList.map((a) => resolveArg(a, item, nodeOutputs, params, allowEnvAccess));

  function str(idx: number, label = `arg${idx + 1}`): string {
    const v = args[idx];
    if (v === undefined || v === null) throw new Error(`fn:${name} — ${label} is required`);
    return String(v);
  }
  function num(idx: number, label = `arg${idx + 1}`): number {
    const v = args[idx];
    const n = Number(v);
    if (isNaN(n)) throw new Error(`fn:${name} — ${label} must be numeric, got "${v}"`);
    return n;
  }

  switch (name) {
    // ---- String ----
    case 'upper': return str(0).toUpperCase();
    case 'lower': return str(0).toLowerCase();
    case 'trim':  return str(0).trim();
    case 'len':   return str(0).length;
    case 'split': {
      const s = str(0, 'string');
      const sep = args.length > 1 ? String(args[1]) : ',';
      return s.split(sep);
    }
    case 'join': {
      const arr = args[0];
      if (!Array.isArray(arr)) throw new Error(`fn:join — arg1 must be an array`);
      const sep = args.length > 1 ? String(args[1]) : ',';
      return arr.join(sep);
    }
    case 'replace': {
      const s = str(0, 'string');
      const from = str(1, 'from');
      const to = str(2, 'to');
      return s.split(from).join(to);
    }

    // ---- Number ----
    case 'add':     return num(0) + num(1);
    case 'sub':     return num(0) - num(1);
    case 'mul':     return num(0) * num(1);
    case 'div': {
      const divisor = num(1);
      if (divisor === 0) throw new Error(`fn:div — division by zero`);
      return num(0) / divisor;
    }
    case 'toInt':   return parseInt(str(0), 10);
    case 'toFloat': return parseFloat(str(0));

    // ---- Type ----
    case 'toBool': {
      const v = args[0];
      return isTruthy(v as FnArg);
    }
    case 'default': {
      const v = args[0];
      const fallback = args[1];
      return (v === null || v === undefined || v === '') ? fallback : v;
    }
    case 'json': {
      const v = args[0];
      return JSON.stringify(v);
    }
    case 'parse': {
      try { return JSON.parse(str(0)); }
      catch { throw new Error(`fn:parse — invalid JSON: ${str(0)}`); }
    }

    // ---- Date ----
    case 'now': return new Date().toISOString();
    case 'formatDate': {
      const ts = str(0, 'timestamp');
      const fmt = args.length > 1 ? str(1, 'format') : 'YYYY-MM-DD';
      const d = new Date(ts);
      if (isNaN(d.getTime())) throw new Error(`fn:formatDate — invalid timestamp: ${ts}`);
      return fmt
        .replace('YYYY', String(d.getUTCFullYear()))
        .replace('MM',   String(d.getUTCMonth() + 1).padStart(2, '0'))
        .replace('DD',   String(d.getUTCDate()).padStart(2, '0'))
        .replace('HH',   String(d.getUTCHours()).padStart(2, '0'))
        .replace('mm',   String(d.getUTCMinutes()).padStart(2, '0'))
        .replace('ss',   String(d.getUTCSeconds()).padStart(2, '0'));
    }

    // ---- Logic ----
    case 'if': {
      const cond = isTruthy(args[0] as FnArg);
      return cond ? args[1] : args[2];
    }
    case 'not': return !isTruthy(args[0] as FnArg);
    case 'eq':  return String(args[0]) === String(args[1]);
    case 'gt':  return num(0) > num(1);
    case 'lt':  return num(0) < num(1);

    default:
      throw new Error(`fn:${name} — unknown function`);
  }
}

// Note: only resolves top-level string values. Nested objects/arrays are passed through unchanged.
export function resolveConfig(
  config: Record<string, unknown>,
  item: Item,
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
  allowEnvAccess?: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    result[k] = typeof v === 'string' ? resolveExpression(v, item, nodeOutputs, params, allowEnvAccess) : v;
  }
  return result;
}
