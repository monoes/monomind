import type { MonographNode, NodeLabel } from '../types.js';
import type { MonographDb } from '../storage/db.js';

// ── Node property search options ───────────────────────────────────────────────

export interface NodeSearchOptions {
  /** Filter by node label (e.g. 'Function', 'Class'). */
  label?: NodeLabel;
  /** Filter by programming language (case-insensitive). */
  language?: string;
  /** Filter by file extension, e.g. '.ts', 'ts' (leading dot optional). */
  fileExtension?: string;
  /** Filter by file path substring (case-insensitive). */
  filePath?: string;
  /** Only return exported nodes. */
  isExported?: boolean;
  /** Only return nodes inside this community. */
  communityId?: number;
  /** Maximum number of results (default: no limit). */
  limit?: number;
}

// ── Row → node mapper (mirrors subgraph.ts) ───────────────────────────────────

function rowToNode(r: {
  id: string;
  label: string;
  name: string;
  norm_label?: string;
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  community_id: number | null;
  is_exported: number;
  language: string | null;
  properties: string | null;
}): MonographNode {
  return {
    id: r.id,
    label: r.label as NodeLabel,
    name: r.name,
    normLabel: r.norm_label ?? r.name.toLowerCase(),
    filePath: r.file_path ?? undefined,
    startLine: r.start_line ?? undefined,
    endLine: r.end_line ?? undefined,
    communityId: r.community_id ?? undefined,
    isExported: r.is_exported === 1,
    language: r.language ?? undefined,
    properties: r.properties ? (JSON.parse(r.properties) as Record<string, unknown>) : undefined,
  };
}

// ── DB-backed search ───────────────────────────────────────────────────────────

/**
 * Search nodes by structured property criteria.
 * All supplied criteria are combined with AND.
 */
export function searchNodesByProperty(
  db: MonographDb,
  options: NodeSearchOptions = {},
): MonographNode[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.label) {
    conditions.push('label = ?');
    params.push(options.label);
  }

  if (options.language) {
    conditions.push('LOWER(language) = LOWER(?)');
    params.push(options.language);
  }

  if (options.fileExtension !== undefined) {
    // Normalise: ensure leading dot
    const ext = options.fileExtension.startsWith('.')
      ? options.fileExtension
      : `.${options.fileExtension}`;
    conditions.push("file_path LIKE ?");
    params.push(`%${ext}`);
  }

  if (options.filePath !== undefined) {
    conditions.push("LOWER(file_path) LIKE LOWER(?)");
    params.push(`%${options.filePath}%`);
  }

  if (options.isExported !== undefined) {
    conditions.push('is_exported = ?');
    params.push(options.isExported ? 1 : 0);
  }

  if (options.communityId !== undefined) {
    conditions.push('community_id = ?');
    params.push(options.communityId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = options.limit !== undefined ? `LIMIT ${Number(options.limit)}` : '';
  const sql = `SELECT id, label, name, norm_label, file_path, start_line, end_line,
                      community_id, is_exported, language, properties
               FROM nodes ${where} ${limitClause}`;

  const rows = db.prepare(sql).all(...params) as Parameters<typeof rowToNode>[0][];
  return rows.map(rowToNode);
}

// ── In-memory search ───────────────────────────────────────────────────────────

/**
 * Filter an already-loaded array of nodes in memory.
 */
export function searchNodesInMemory(
  nodes: MonographNode[],
  options: NodeSearchOptions = {},
): MonographNode[] {
  let result = nodes;

  if (options.label) {
    result = result.filter(n => n.label === options.label);
  }

  if (options.language) {
    const lang = options.language.toLowerCase();
    result = result.filter(n => n.language?.toLowerCase() === lang);
  }

  if (options.fileExtension !== undefined) {
    const ext = options.fileExtension.startsWith('.')
      ? options.fileExtension.toLowerCase()
      : `.${options.fileExtension.toLowerCase()}`;
    result = result.filter(n => n.filePath?.toLowerCase().endsWith(ext));
  }

  if (options.filePath !== undefined) {
    const fp = options.filePath.toLowerCase();
    result = result.filter(n => n.filePath?.toLowerCase().includes(fp));
  }

  if (options.isExported !== undefined) {
    result = result.filter(n => n.isExported === options.isExported);
  }

  if (options.communityId !== undefined) {
    result = result.filter(n => n.communityId === options.communityId);
  }

  if (options.limit !== undefined) {
    result = result.slice(0, options.limit);
  }

  return result;
}
