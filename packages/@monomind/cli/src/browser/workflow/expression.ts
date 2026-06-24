import type { Item } from './types.js';

const TEMPLATE_RE = /\{\{([^}]+)\}\}/g;
const cache = new Map<string, RegExpMatchArray[]>();

function extractTemplates(template: string): RegExpMatchArray[] {
  if (cache.has(template)) return cache.get(template)!;
  const matches = [...template.matchAll(new RegExp(TEMPLATE_RE.source, 'g'))];
  cache.set(template, matches);
  return matches;
}

export function resolveExpression(
  template: string,
  item: Item,
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
): string {
  const matches = extractTemplates(template);
  if (matches.length === 0) return template;

  let result = template;
  for (const match of matches) {
    const expr = match[1].trim();
    const value = resolveToken(expr, item, nodeOutputs, params);
    result = result.replace(match[0], String(value));
  }
  return result;
}

function resolveToken(
  expr: string,
  item: Item,
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
): unknown {
  if (expr.startsWith('$json.')) {
    const key = expr.slice(6);
    if (!(key in item.data)) throw new Error(`Unresolved: $json.${key} not found in item data`);
    return item.data[key];
  }
  if (expr.startsWith('$env.')) {
    const key = expr.slice(5);
    const val = process.env[key];
    if (val === undefined) throw new Error(`Unresolved: $env.${key} not set`);
    return val;
  }
  if (expr.startsWith('params.')) {
    const key = expr.slice(7);
    if (!(key in params)) throw new Error(`Unresolved: params.${key} not provided`);
    return params[key];
  }
  if (expr.startsWith('$node.')) {
    const parts = expr.slice(6).split('.');
    const nodeId = parts[0];
    const field = parts.slice(1).join('.');
    const items = nodeOutputs[nodeId];
    if (!items || items.length === 0) throw new Error(`Unresolved: $node.${nodeId} has no output`);
    const val = items[0].data[field];
    if (val === undefined) throw new Error(`Unresolved: $node.${nodeId}.${field} not found`);
    return val;
  }
  // Named ref (from find step) — caller resolves these at execution time
  return `{{${expr}}}`;
}

export function resolveConfig(
  config: Record<string, unknown>,
  item: Item,
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    result[k] = typeof v === 'string' ? resolveExpression(v, item, nodeOutputs, params) : v;
  }
  return result;
}
