import type { MonographNode, MonographEdge } from '../types.js';
import type { MonographDb } from '../storage/db.js';

// ── Node regex search ──────────────────────────────────────────────────────────

export interface RegexNodeMatch {
  node: MonographNode;
  /** Which field of the node matched. */
  field: 'name' | 'filePath' | 'language' | 'label';
}

/**
 * Search nodes whose name, filePath, language, or label matches the given
 * regular expression.
 *
 * @param db      - The MonographDb instance.
 * @param pattern - A RegExp (or a string that will be compiled to one).
 * @param fields  - Which fields to test; default: ['name', 'filePath'].
 */
export function regexSearchNodes(
  db: MonographDb,
  pattern: RegExp | string,
  fields: Array<'name' | 'filePath' | 'language' | 'label'> = ['name', 'filePath'],
  limit = 200,
): RegexNodeMatch[] {
  const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

  const rows = db.prepare(
    `SELECT id, label, name, norm_label, file_path, start_line, end_line,
            community_id, is_exported, language, properties
     FROM nodes LIMIT ?`,
  ).all(limit) as {
    id: string;
    label: string;
    name: string;
    norm_label: string;
    file_path: string | null;
    start_line: number | null;
    end_line: number | null;
    community_id: number | null;
    is_exported: number;
    language: string | null;
    properties: string | null;
  }[];

  const results: RegexNodeMatch[] = [];

  for (const r of rows) {
    const node: MonographNode = {
      id: r.id,
      label: r.label as MonographNode['label'],
      name: r.name,
      normLabel: r.norm_label,
      filePath: r.file_path ?? undefined,
      startLine: r.start_line ?? undefined,
      endLine: r.end_line ?? undefined,
      communityId: r.community_id ?? undefined,
      isExported: r.is_exported === 1,
      language: r.language ?? undefined,
      properties: r.properties ? (JSON.parse(r.properties) as Record<string, unknown>) : undefined,
    };

    for (const field of fields) {
      const value =
        field === 'name' ? r.name :
        field === 'filePath' ? (r.file_path ?? '') :
        field === 'language' ? (r.language ?? '') :
        r.label;

      if (value && re.test(value)) {
        results.push({ node, field });
        break; // report once per node even if multiple fields match
      }
    }
  }

  return results;
}

// ── Edge regex search ──────────────────────────────────────────────────────────

export interface RegexEdgeMatch {
  edge: MonographEdge;
  /** Which field of the edge matched. */
  field: 'relation' | 'confidence' | 'reason';
}

/**
 * Search edges whose relation, confidence, or reason matches the given
 * regular expression.
 *
 * @param db      - The MonographDb instance.
 * @param pattern - A RegExp (or a string that will be compiled to one).
 * @param fields  - Which fields to test; default: ['relation', 'reason'].
 */
export function regexSearchEdges(
  db: MonographDb,
  pattern: RegExp | string,
  fields: Array<'relation' | 'confidence' | 'reason'> = ['relation', 'reason'],
  limit = 200,
): RegexEdgeMatch[] {
  const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

  const rows = db.prepare(
    `SELECT id, source_id, target_id, relation, confidence, confidence_score, reason
     FROM edges LIMIT ?`,
  ).all(limit) as {
    id: string;
    source_id: string;
    target_id: string;
    relation: string;
    confidence: string;
    confidence_score: number;
    reason: string | null;
  }[];

  const results: RegexEdgeMatch[] = [];

  for (const r of rows) {
    const edge: MonographEdge = {
      id: r.id,
      sourceId: r.source_id,
      targetId: r.target_id,
      relation: r.relation as MonographEdge['relation'],
      confidence: r.confidence as MonographEdge['confidence'],
      confidenceScore: r.confidence_score,
      reason: r.reason ?? undefined,
    };

    for (const field of fields) {
      const value =
        field === 'relation' ? r.relation :
        field === 'confidence' ? r.confidence :
        (r.reason ?? '');

      if (value && re.test(value)) {
        results.push({ edge, field });
        break;
      }
    }
  }

  return results;
}

// ── In-memory variants ─────────────────────────────────────────────────────────

export function regexSearchNodesInMemory(
  nodes: MonographNode[],
  pattern: RegExp | string,
  fields: Array<'name' | 'filePath' | 'language' | 'label'> = ['name', 'filePath'],
): RegexNodeMatch[] {
  const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  const results: RegexNodeMatch[] = [];

  for (const node of nodes) {
    for (const field of fields) {
      const value =
        field === 'name' ? node.name :
        field === 'filePath' ? (node.filePath ?? '') :
        field === 'language' ? (node.language ?? '') :
        node.label;

      if (value && re.test(value)) {
        results.push({ node, field });
        break;
      }
    }
  }

  return results;
}

export function regexSearchEdgesInMemory(
  edges: MonographEdge[],
  pattern: RegExp | string,
  fields: Array<'relation' | 'confidence' | 'reason'> = ['relation', 'reason'],
): RegexEdgeMatch[] {
  const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  const results: RegexEdgeMatch[] = [];

  for (const edge of edges) {
    for (const field of fields) {
      const value =
        field === 'relation' ? edge.relation :
        field === 'confidence' ? edge.confidence :
        (edge.reason ?? '');

      if (value && re.test(value)) {
        results.push({ edge, field });
        break;
      }
    }
  }

  return results;
}

// ── LLM formatters ─────────────────────────────────────────────────────────────

/**
 * Format node regex match results as structured text for LLM consumption.
 */
export function formatRegexNodeMatches(matches: RegexNodeMatch[], pattern: string): string {
  if (matches.length === 0) return `No nodes matching /${pattern}/.`;
  const lines: string[] = [`${matches.length} node(s) matching /${pattern}/:`];
  for (const m of matches) {
    const loc = m.node.filePath
      ? ` ${m.node.filePath}${m.node.startLine != null ? `:${m.node.startLine}` : ''}`
      : '';
    lines.push(`  [${m.field}] ${m.node.label} ${m.node.name}${loc}`);
  }
  return lines.join('\n');
}

/**
 * Format edge regex match results as structured text for LLM consumption.
 */
export function formatRegexEdgeMatches(matches: RegexEdgeMatch[], pattern: string): string {
  if (matches.length === 0) return `No edges matching /${pattern}/.`;
  const lines: string[] = [`${matches.length} edge(s) matching /${pattern}/:`];
  for (const m of matches) {
    lines.push(
      `  [${m.field}] ${m.edge.sourceId} -[${m.edge.relation}]-> ${m.edge.targetId}` +
      (m.edge.reason ? `  // ${m.edge.reason}` : ''),
    );
  }
  return lines.join('\n');
}
