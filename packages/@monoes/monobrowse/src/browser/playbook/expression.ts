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
    const key = expr.slice(6);
    if (!(key in item.data)) throw new Error(`Unresolved: $json.${key} not found in item data`);
    return item.data[key];
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
  // Named ref (e.g. {{box}} from a find step) — action executor resolves these using its element handle map
  return `{{${expr}}}`;
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
