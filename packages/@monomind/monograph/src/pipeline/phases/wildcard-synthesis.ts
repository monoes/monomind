import type { MonographNode, MonographEdge } from '../../types.js';
import { makeId, CONFIDENCE_SCORE } from '../../types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WildcardBinding {
  /** The namespace alias, e.g. `X` in `import * as X from './module'` */
  alias: string;
  /** The module specifier, e.g. `./module` */
  moduleSpecifier: string;
}

export interface WildcardMemberAccess {
  alias: string;
  member: string;
  line: number;
}

export interface WildcardSynthesisResult {
  /** New edges synthesized from wildcard member accesses */
  synthesizedEdges: MonographEdge[];
}

// ── Regex patterns ────────────────────────────────────────────────────────────

/** Matches: import * as X from './path' or import * as X from "../path" */
const WILDCARD_IMPORT_RE = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Extracts all wildcard import bindings from a TypeScript/JavaScript source file.
 *
 * @param source - Raw source code content
 * @returns Array of wildcard bindings found in the source
 */
export function extractWildcardBindings(source: string): WildcardBinding[] {
  const results: WildcardBinding[] = [];
  WILDCARD_IMPORT_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = WILDCARD_IMPORT_RE.exec(source)) !== null) {
    results.push({ alias: match[1], moduleSpecifier: match[2] });
  }

  return results;
}

/**
 * Extracts all member accesses for a given namespace alias from source code.
 * e.g. for alias `ns`, detects `ns.foo`, `ns.bar`, etc.
 *
 * @param source - Raw source code content
 * @param alias - The namespace alias to scan for
 * @returns Array of member accesses with line numbers
 */
export function extractWildcardMemberAccesses(
  source: string,
  alias: string,
): WildcardMemberAccess[] {
  const results: WildcardMemberAccess[] = [];
  const memberRe = new RegExp(`\\b${alias}\\.(\\w+)`, 'g');
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    memberRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = memberRe.exec(line)) !== null) {
      const member = m[1];
      if (!seen.has(member)) {
        seen.add(member);
        results.push({ alias, member, line: i + 1 });
      }
    }
  }

  return results;
}

/**
 * Synthesizes direct symbol edges from wildcard namespace member accesses.
 *
 * Given source code that has `import * as X from './module'` and uses `X.foo`,
 * this function creates IMPORTS edges from the source file node to the `foo`
 * export node in `./module`.
 *
 * @param sourceFileId - The node ID of the file containing the wildcard import
 * @param source - Raw source code of the file
 * @param nodes - All known nodes in the graph
 * @param edges - All known edges (used to avoid duplicates)
 * @returns Synthesized edges that directly link callers to target exports
 */
export function synthesizeWildcardImports(
  sourceFileId: string,
  source: string,
  nodes: MonographNode[],
  edges: MonographEdge[],
): WildcardSynthesisResult {
  const bindings = extractWildcardBindings(source);
  if (bindings.length === 0) return { synthesizedEdges: [] };

  // Build an index of existing edge IDs to avoid duplicates
  const existingEdgeIds = new Set(edges.map(e => e.id));

  // Build a name→nodeId index for fast lookup
  const nameIndex = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.isExported) continue;
    const existing = nameIndex.get(node.name) ?? [];
    existing.push(node.id);
    nameIndex.set(node.name, existing);
    // Also index by normLabel if different
    if (node.normLabel && node.normLabel !== node.name) {
      const byNorm = nameIndex.get(node.normLabel) ?? [];
      byNorm.push(node.id);
      nameIndex.set(node.normLabel, byNorm);
    }
  }

  const synthesizedEdges: MonographEdge[] = [];

  for (const binding of bindings) {
    const accesses = extractWildcardMemberAccesses(source, binding.alias);

    for (const access of accesses) {
      // Skip the import line itself (alias declaration)
      const targetCandidates =
        nameIndex.get(access.member) ?? nameIndex.get(access.member.toLowerCase()) ?? [];

      for (const targetId of targetCandidates) {
        const edgeId = makeId(sourceFileId, targetId, 'wildcard', access.member);
        if (existingEdgeIds.has(edgeId)) continue;

        synthesizedEdges.push({
          id: edgeId,
          sourceId: sourceFileId,
          targetId,
          relation: 'IMPORTS',
          confidence: 'INFERRED',
          confidenceScore: CONFIDENCE_SCORE.INFERRED,
        });

        existingEdgeIds.add(edgeId);
      }
    }
  }

  return { synthesizedEdges };
}
