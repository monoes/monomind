// Core transform node handlers — ported from monoagent internal/workflow/schemas/core.*.json
// Handles: aggregate, sort, limit, switch, merge, remove_duplicates, code, wait, split_in_batches, stop_error, compare_datasets
// Note: core.set, core.filter, and core.if are handled inline in engine.ts
import type { NodeHandler, Item } from '../engine/index.js';

function getStr(config: Record<string, unknown>, key: string, fallback = ''): string {
  return String(config[key] ?? fallback);
}

function getNum(config: Record<string, unknown>, key: string, fallback: number): number {
  const v = Number(config[key]);
  return isNaN(v) ? fallback : v;
}

function getField(item: Item, field: string): unknown {
  const parts = field.split('.');
  let val: unknown = item.data;
  for (const p of parts) {
    if (val === null || val === undefined || typeof val !== 'object') return undefined;
    val = (val as Record<string, unknown>)[p];
  }
  return val;
}

// ── core.aggregate ────────────────────────────────────────────────────────────
const aggregate: NodeHandler = async (items, config) => {
  const op = getStr(config, 'operation', 'count');
  const field = getStr(config, 'field');
  const groupBy = getStr(config, 'group_by');

  function compute(group: Item[]): unknown {
    if (op === 'count') return group.length;
    if (op === 'collect') return group.map(i => i.data);
    const nums = group.map(i => Number(getField(i, field))).filter(n => !isNaN(n));
    if (op === 'sum') return nums.reduce((a, b) => a + b, 0);
    if (op === 'avg') return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    if (op === 'min') return nums.length ? Math.min(...nums) : null;
    if (op === 'max') return nums.length ? Math.max(...nums) : null;
    return null;
  }

  if (groupBy) {
    const groups = new Map<unknown, Item[]>();
    for (const item of items) {
      const key = getField(item, groupBy);
      const g = groups.get(key) ?? [];
      g.push(item);
      groups.set(key, g);
    }
    return Array.from(groups.entries()).map(([key, g]) => ({
      data: { [groupBy]: key, [op === 'collect' ? 'items' : field || op]: compute(g) },
    }));
  }

  return [{ data: { [op === 'collect' ? 'items' : field || op]: compute(items) } }];
};

// ── core.sort ─────────────────────────────────────────────────────────────────
const sort: NodeHandler = async (items, config) => {
  const field = getStr(config, 'field', '');
  const dir = getStr(config, 'direction', 'asc');
  return [...items].sort((a, b) => {
    const av = getField(a, field);
    const bv = getField(b, field);
    let cmp = 0;
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv;
    } else {
      cmp = String(av ?? '').localeCompare(String(bv ?? ''));
    }
    return dir === 'desc' ? -cmp : cmp;
  });
};

// ── core.limit ────────────────────────────────────────────────────────────────
const limit: NodeHandler = async (items, config) => {
  const max = getNum(config, 'max_items', 10);
  return items.slice(0, max);
};

// ── core.switch ───────────────────────────────────────────────────────────────
// Tags each item with __switchHandle so collectInputs can route to the right handle.
const switchNode: NodeHandler = async (items, config) => {
  const fieldExpr = getStr(config, 'field');
  const cases = Array.isArray(config['cases']) ? (config['cases'] as string[]) : [];
  const fallthrough = config['fallthrough'] !== false;

  const result: Item[] = [];
  for (const item of items) {
    const val = String(fieldExpr);
    const matched = cases.includes(val) ? val : (fallthrough ? 'default' : null);
    if (matched !== null) result.push({ ...item, data: { ...item.data, __switchHandle: matched } });
  }
  return result;
};

// ── core.merge ────────────────────────────────────────────────────────────────
const merge: NodeHandler = async (items, config) => {
  const mode = getStr(config, 'mode', 'append');

  if (mode === 'append') return items;

  if (mode === 'merge_by_key') {
    const keyField = getStr(config, 'key_field', 'id');
    const merged = new Map<unknown, Record<string, unknown>>();
    for (const item of items) {
      const key = getField(item, keyField);
      const existing = merged.get(key) ?? {};
      merged.set(key, { ...existing, ...item.data });
    }
    return Array.from(merged.values()).map(data => ({ data }));
  }

  if (mode === 'zip') {
    // Pair items from first half and second half (best-effort without source tracking)
    const half = Math.ceil(items.length / 2);
    const a = items.slice(0, half);
    const b = items.slice(half);
    return a.map((item, i) => ({ data: { ...item.data, ...(b[i]?.data ?? {}) } }));
  }

  return items;
};

// ── core.remove_duplicates ────────────────────────────────────────────────────
const removeDuplicates: NodeHandler = async (items, config) => {
  const field = getStr(config, 'field', 'id');
  const seen = new Set<unknown>();
  return items.filter(item => {
    const val = getField(item, field);
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
};

// ── core.code ────────────────────────────────────────────────────────────────
// Runs user-provided JavaScript. $input.all() returns all input items.
const code: NodeHandler = async (items, config) => {
  const src = getStr(config, 'code', '');
  if (!src.trim()) return items;

  const $input = {
    all: () => items,
    first: () => items[0] ?? { data: {} },
    item: items[0] ?? { data: {} },
  };

  // Run in a Function so `return` works at top level
  const fn = new Function('$input', 'items', `"use strict";\n${src}`);
  const result = await Promise.resolve(fn($input, items));
  if (Array.isArray(result)) {
    return result.map(r => (r && typeof r === 'object' && 'data' in r) ? r as Item : { data: r as Record<string, unknown> });
  }
  if (result && typeof result === 'object') return [{ data: result as Record<string, unknown> }];
  return items;
};

// ── core.wait ─────────────────────────────────────────────────────────────────
const wait: NodeHandler = async (items, config) => {
  const ms = getNum(config, 'duration', 5) * 1000;
  await new Promise(res => setTimeout(res, Math.min(ms, 3_600_000)));
  return items;
};

// ── core.split_in_batches ─────────────────────────────────────────────────────
// Splits items into batches and outputs them with __batchIndex / __batchTotal metadata.
const splitInBatches: NodeHandler = async (items, config) => {
  const batchSize = Math.max(1, getNum(config, 'batch_size', 10));
  const output: Item[] = [];
  const total = Math.ceil(items.length / batchSize);
  for (let i = 0; i < items.length; i += batchSize) {
    const batchIndex = Math.floor(i / batchSize);
    for (const item of items.slice(i, i + batchSize)) {
      output.push({ ...item, data: { ...item.data, __batchIndex: batchIndex, __batchTotal: total, __batchSize: batchSize } });
    }
  }
  return output;
};

// ── core.stop_error ───────────────────────────────────────────────────────────
const stopError: NodeHandler = async (_items, config) => {
  const msg = getStr(config, 'message', 'Playbook stopped by stop_error node');
  throw new Error(msg);
};

// ── core.compare_datasets ─────────────────────────────────────────────────────
// Compares the first half of items (dataset A) with the second half (dataset B).
// Because the engine merges all predecessor outputs, dataset A is expected to come
// from the first predecessor edge and dataset B from the second. We split 50/50
// as a best-effort heuristic when source tags are unavailable.
const compareDatasets: NodeHandler = async (items, config) => {
  const keyField = getStr(config, 'key_field', 'id');
  const output = getStr(config, 'output', 'new_items');

  // Split into A (first predecessor) and B (second predecessor) by __datasetSource tag if present,
  // otherwise use 50/50 split.
  const aItems = items.filter(i => i.data['__datasetSource'] === 'a');
  const bItems = items.filter(i => i.data['__datasetSource'] === 'b');
  const useTagged = aItems.length > 0 || bItems.length > 0;
  const setA = useTagged ? aItems : items.slice(0, Math.ceil(items.length / 2));
  const setB = useTagged ? bItems : items.slice(Math.ceil(items.length / 2));

  const aMap = new Map<unknown, Record<string, unknown>>();
  const bMap = new Map<unknown, Record<string, unknown>>();
  for (const i of setA) aMap.set(getField(i, keyField), i.data);
  for (const i of setB) bMap.set(getField(i, keyField), i.data);

  if (output === 'new_items') {
    return Array.from(bMap.entries())
      .filter(([k]) => !aMap.has(k))
      .map(([, data]) => ({ data }));
  }
  if (output === 'removed_items') {
    return Array.from(aMap.entries())
      .filter(([k]) => !bMap.has(k))
      .map(([, data]) => ({ data }));
  }
  if (output === 'changed_items') {
    return Array.from(bMap.entries())
      .filter(([k, data]) => {
        const prev = aMap.get(k);
        return prev && JSON.stringify(prev) !== JSON.stringify(data);
      })
      .map(([, data]) => ({ data }));
  }
  // all_differences
  const results: Item[] = [];
  for (const [k, data] of bMap) {
    if (!aMap.has(k)) results.push({ data: { ...data, __change: 'added' } });
    else if (JSON.stringify(aMap.get(k)) !== JSON.stringify(data)) results.push({ data: { ...data, __change: 'changed' } });
  }
  for (const [k, data] of aMap) {
    if (!bMap.has(k)) results.push({ data: { ...data, __change: 'removed' } });
  }
  return results;
};

export function register(handlers: Map<string, NodeHandler>): void {
  handlers.set('core.aggregate', aggregate);
  handlers.set('core.sort', sort);
  handlers.set('core.limit', limit);
  handlers.set('core.switch', switchNode);
  handlers.set('core.merge', merge);
  handlers.set('core.remove_duplicates', removeDuplicates);
  handlers.set('core.code', code);
  handlers.set('core.wait', wait);
  handlers.set('core.split_in_batches', splitInBatches);
  handlers.set('core.stop_error', stopError);
  handlers.set('core.compare_datasets', compareDatasets);
}
