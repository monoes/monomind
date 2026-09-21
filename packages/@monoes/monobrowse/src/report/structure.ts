/**
 * Structural signature of a page, and the diff between two of them (RIG-10).
 *
 * The signature is derived from the accessibility tree we already fetch for
 * the a11y rules, so this costs no extra CDP round-trip. It is deliberately
 * the AX tree and not the DOM: the AX tree is what the page *means* — a
 * className churned by a CSS-in-JS build is invisible to it, while a button
 * losing its label, a heading changing text, or a form field disappearing
 * all show up. That is the signal a "did this deploy change anything real?"
 * diff wants.
 *
 * Everything here is pure, so the tests feed hand-written trees.
 */

import type { AxNode, StructureDiff, StructureNode } from './types.js';

/** Roles that exist only to hold other nodes — spliced out, children kept. */
const TRANSPARENT_ROLES = new Set([
  'none',
  'generic',
  'presentation',
  'inlinetextbox',
  'genericcontainer',
]);

/** Bound on signature size: a 40k-node AX tree must not become a 40k-row diff. */
export const MAX_STRUCTURE_NODES = 1500;
const MAX_DEPTH = 25;
/** Accessible names are compared verbatim, so trim the essays. */
const MAX_NAME_LENGTH = 160;

function strValue(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function normalizeName(raw: string): string | null {
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > MAX_NAME_LENGTH ? `${flat.slice(0, MAX_NAME_LENGTH - 1)}…` : flat;
}

/**
 * Walk the AX tree into a flat, path-addressed signature.
 *
 * Path segments are `role[n]`, n counting siblings of the same role after
 * transparent wrappers are spliced away. Two runs of an unchanged page
 * therefore produce identical paths; an inserted element shifts only its own
 * role's numbering, which the diff's second pass then recovers from.
 */
export function buildStructure(nodes: AxNode[]): StructureNode[] {
  const byId = new Map<string, AxNode>();
  for (const node of nodes) byId.set(String(node.nodeId), node);

  const childIds = (node: AxNode): string[] => (node.childIds ?? []).map(String);

  /** Visible children, with transparent wrappers replaced by their children. */
  const effectiveChildren = (node: AxNode, depth: number): AxNode[] => {
    const out: AxNode[] = [];
    const queue = [...childIds(node)];
    let guard = 0;
    while (queue.length && guard++ < 4000) {
      const child = byId.get(queue.shift() as string);
      if (!child) continue;
      const role = strValue(child.role?.value).toLowerCase();
      if (child.ignored || TRANSPARENT_ROLES.has(role)) {
        if (depth < MAX_DEPTH) queue.unshift(...childIds(child));
        continue;
      }
      out.push(child);
    }
    return out;
  };

  const referenced = new Set<string>();
  for (const node of nodes) for (const id of childIds(node)) referenced.add(id);
  const roots = nodes.filter((n) => !referenced.has(String(n.nodeId)));
  // In a cycle every node has a parent, so there is no unreferenced root and
  // the walk below would visit nothing. Start somewhere rather than silently
  // returning an empty signature that the diff would read as "page is gone".
  if (!roots.length && nodes.length) roots.push(nodes[0]);

  const out: StructureNode[] = [];
  const visited = new Set<string>();
  const counters = new Map<string, Map<string, number>>();

  const walk = (node: AxNode, parentPath: string, depth: number): void => {
    if (out.length >= MAX_STRUCTURE_NODES || depth > MAX_DEPTH) return;
    const id = String(node.nodeId);
    if (visited.has(id)) return; // a malformed tree must not loop us forever
    visited.add(id);

    const role = strValue(node.role?.value).toLowerCase() || 'unknown';
    let siblingsSeen = counters.get(parentPath);
    if (!siblingsSeen) {
      siblingsSeen = new Map<string, number>();
      counters.set(parentPath, siblingsSeen);
    }
    const n = (siblingsSeen.get(role) ?? 0) + 1;
    siblingsSeen.set(role, n);

    const path = `${parentPath}/${role}[${n}]`;
    out.push({ path, role, name: normalizeName(strValue(node.name?.value)), depth });

    for (const child of effectiveChildren(node, depth)) walk(child, path, depth + 1);
  };

  for (const root of roots) {
    const role = strValue(root.role?.value).toLowerCase();
    if (root.ignored || TRANSPARENT_ROLES.has(role)) {
      for (const child of effectiveChildren(root, 0)) walk(child, '', 0);
    } else {
      walk(root, '', 0);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Identity for the second matching pass. Names are whitespace-collapsed to a
 * single line by normalizeName, so a newline is a separator no value carries.
 */
function identityKey(node: StructureNode): string {
  return `${node.role}\n${node.name ?? ''}`;
}

/**
 * Diff two signatures.
 *
 * Two passes, because path alone is too brittle to use on its own: inserting
 * one list item renumbers every later sibling, which a naive path diff would
 * report as "everything below here was replaced".
 *
 *  1. Exact path match — same slot. Same name means unchanged, a different
 *     name means renamed (the useful case: a label that silently changed).
 *  2. Whatever is left is matched on role+name, which recovers elements that
 *     merely moved. Only what survives both passes is genuinely gained/lost.
 */
export function diffStructure(previous: StructureNode[], current: StructureNode[]): StructureDiff {
  const prevByPath = new Map(previous.map((n) => [n.path, n]));
  const currByPath = new Map(current.map((n) => [n.path, n]));

  const renamed: StructureDiff['renamed'] = [];
  const unmatchedPrev: StructureNode[] = [];
  const unmatchedCurr: StructureNode[] = [];
  let unchanged = 0;

  for (const node of current) {
    const before = prevByPath.get(node.path);
    if (!before) {
      unmatchedCurr.push(node);
      continue;
    }
    if (before.role === node.role && before.name === node.name) {
      unchanged++;
    } else if (before.role === node.role) {
      renamed.push({ path: node.path, role: node.role, from: before.name, to: node.name });
    } else {
      // Same slot, different role — that is a replacement, not a rename.
      unmatchedCurr.push(node);
      unmatchedPrev.push(before);
    }
  }
  for (const node of previous) {
    if (!currByPath.has(node.path)) unmatchedPrev.push(node);
  }

  // Pass two: role+name identity, which is what "the same element, elsewhere"
  // actually means to a reader.
  const pool = new Map<string, StructureNode[]>();
  for (const node of unmatchedPrev) {
    const key = identityKey(node);
    const bucket = pool.get(key);
    if (bucket) bucket.push(node);
    else pool.set(key, [node]);
  }

  const moved: StructureDiff['moved'] = [];
  const gained: StructureNode[] = [];
  for (const node of unmatchedCurr) {
    const bucket = pool.get(identityKey(node));
    const match = bucket?.shift();
    if (match) {
      moved.push({ role: node.role, name: node.name, from: match.path, to: node.path });
    } else {
      gained.push(node);
    }
  }
  const lost = [...pool.values()].flat();

  return {
    gained,
    lost,
    renamed,
    moved,
    unchanged,
    changed: gained.length + lost.length + renamed.length,
  };
}

/** One line for a CI log: "3 gained, 1 lost, 2 renamed". */
export function summarizeStructureDiff(diff: StructureDiff): string {
  const parts: string[] = [];
  if (diff.gained.length) parts.push(`${diff.gained.length} gained`);
  if (diff.lost.length) parts.push(`${diff.lost.length} lost`);
  if (diff.renamed.length) parts.push(`${diff.renamed.length} renamed`);
  if (diff.moved.length) parts.push(`${diff.moved.length} moved`);
  return parts.length ? parts.join(', ') : 'structurally identical';
}
