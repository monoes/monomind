import { dirname, resolve, basename } from 'path';
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
 * Resolve a relative module specifier to an absolute file path (without extension).
 * Returns null when `sourceFilePath` is unavailable or the specifier is non-relative.
 */
function resolveSpecifierPath(
  sourceFilePath: string | undefined | null,
  moduleSpecifier: string,
): string | null {
  if (!sourceFilePath) return null;
  if (!moduleSpecifier.startsWith('.')) return null;
  const dir = dirname(sourceFilePath);
  const resolved = resolve(dir, moduleSpecifier);
  // Strip extension so we can match .ts, .js, .tsx, .mjs, etc.
  return resolved.replace(/\.[^./\\]+$/, '');
}

/**
 * Return true when a candidate file path matches the resolved specifier path.
 *
 * Handles:
 * - Exact basename-without-extension match (resolvedPath is a bare module path)
 * - Index file: `resolvedPath/index` matches `candidatePath` ending in `/index.<ext>`
 */
function specifierMatchesFilePath(
  resolvedPath: string,
  candidateFilePath: string,
): boolean {
  // Strip extension from candidate for comparison
  const candidateBase = candidateFilePath.replace(/\.[^./\\]+$/, '');
  if (candidateBase === resolvedPath) return true;
  // Handle implicit /index
  if (candidateBase === resolvedPath + '/index') return true;
  return false;
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

  // Build id→node map for path-based filtering and name→nodes index
  const nodeById = new Map<string, MonographNode>(nodes.map(n => [n.id, n]));
  const sourceNode = nodeById.get(sourceFileId);

  // Build a name→node[] index restricted to exported nodes
  const nameIndex = new Map<string, MonographNode[]>();
  for (const node of nodes) {
    if (!node.isExported) continue;
    const existing = nameIndex.get(node.name) ?? [];
    existing.push(node);
    nameIndex.set(node.name, existing);
    // Also index by normLabel if different
    if (node.normLabel && node.normLabel !== node.name) {
      const byNorm = nameIndex.get(node.normLabel) ?? [];
      byNorm.push(node);
      nameIndex.set(node.normLabel, byNorm);
    }
  }

  const synthesizedEdges: MonographEdge[] = [];

  for (const binding of bindings) {
    // Resolve the module specifier to an absolute path (extension-stripped)
    const resolvedPath = resolveSpecifierPath(sourceNode?.filePath, binding.moduleSpecifier);

    // Basename of the specifier for fallback matching
    const specBase = basename(binding.moduleSpecifier).replace(/\.[^.]+$/, '').toLowerCase();

    const accesses = extractWildcardMemberAccesses(source, binding.alias);

    for (const access of accesses) {
      const candidateNodes: MonographNode[] =
        nameIndex.get(access.member) ?? nameIndex.get(access.member.toLowerCase()) ?? [];

      // Filter candidates to only those belonging to the target module
      let filtered: MonographNode[];
      if (resolvedPath !== null) {
        // Strong filter: match by resolved absolute path
        filtered = candidateNodes.filter(
          n => n.filePath != null && specifierMatchesFilePath(resolvedPath, n.filePath),
        );
      } else {
        // Fallback: match by basename (mirrors cross-file.ts resolution)
        filtered = candidateNodes.filter(
          n => n.filePath != null &&
            basename(n.filePath).replace(/\.[^.]+$/, '').toLowerCase() === specBase,
        );
      }

      // If still no match with basename fallback, skip — no cross-module edge
      if (filtered.length === 0) continue;

      for (const target of filtered) {
        const edgeId = makeId(sourceFileId, target.id, 'wildcard', access.member);
        if (existingEdgeIds.has(edgeId)) continue;

        synthesizedEdges.push({
          id: edgeId,
          sourceId: sourceFileId,
          targetId: target.id,
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
