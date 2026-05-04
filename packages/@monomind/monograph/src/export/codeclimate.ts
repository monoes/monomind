import { relative } from 'path';
import type { MonographDb } from '../storage/db.js';

export interface CodeClimateIssue {
  type: 'issue';
  check_name: string;
  description: string;
  categories: string[];
  fingerprint: string;
  severity: 'blocker' | 'critical' | 'major' | 'minor' | 'info';
  location: {
    path: string;
    lines: { begin: number; end?: number };
  };
}

/** FNV-1a 32-bit hash → 8 lowercase hex chars. */
function fnv1a32(str: string): string {
  let h = 2166136261;
  for (const b of Buffer.from(str)) {
    h ^= b;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Normalize Next.js dynamic route segments. */
function normalizePath(p: string): string {
  return p.replace(/\[([^\]]+)\]/g, '%5B$1%5D');
}

function relativePath(filePath: string, repoRoot?: string): string {
  if (!repoRoot) return filePath;
  return relative(repoRoot, filePath);
}

function makeIssue(
  checkName: string,
  description: string,
  categories: string[],
  severity: CodeClimateIssue['severity'],
  filePath: string,
  line: number,
  repoRoot?: string,
): CodeClimateIssue {
  const relPath = normalizePath(relativePath(filePath, repoRoot));
  const fingerprint = fnv1a32(`${checkName}:${relPath}:${line}`);
  return {
    type: 'issue',
    check_name: checkName,
    description,
    categories,
    fingerprint,
    severity,
    location: {
      path: relPath,
      lines: { begin: line },
    },
  };
}

/**
 * Export CodeClimate-compatible issue list from the monograph DB.
 * Returns a JSON-serialisable array of issues.
 */
export function exportCodeClimate(db: MonographDb, repoRoot?: string): CodeClimateIssue[] {
  const issues: CodeClimateIssue[] = [];

  // ── God nodes (top 10% by fan-in) ─────────────────────────────────────────
  const totalNodes = (db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE label = 'File'`).get() as { c: number }).c;
  const top10pct = Math.max(1, Math.floor(totalNodes * 0.1));
  const godNodes = db.prepare(`
    SELECT n.id, n.name, n.file_path, COALESCE(n.start_line, 1) AS line,
           COUNT(e.id) AS in_degree
    FROM nodes n
    LEFT JOIN edges e ON e.target_id = n.id
    WHERE n.file_path IS NOT NULL AND n.label = 'File'
    GROUP BY n.id
    ORDER BY in_degree DESC
    LIMIT ?
  `).all(top10pct) as { id: string; name: string; file_path: string; line: number; in_degree: number }[];

  for (const row of godNodes) {
    if (row.in_degree === 0) continue;
    issues.push(makeIssue(
      'monograph/god-node',
      `God node: "${row.name}" has ${row.in_degree} incoming dependencies.`,
      ['Complexity'],
      'major',
      row.file_path,
      row.line ?? 1,
      repoRoot,
    ));
  }

  // ── Unreachable files ──────────────────────────────────────────────────────
  const unreachable = db.prepare(`
    SELECT id, name, file_path FROM nodes
    WHERE label = 'File'
    AND (
      json_extract(properties, '$.reachabilityRole') = 'unreachable'
      OR properties LIKE '%"unreachable"%'
    )
    AND file_path IS NOT NULL
  `).all() as { id: string; name: string; file_path: string }[];

  for (const row of unreachable) {
    issues.push(makeIssue(
      'monograph/unreachable-file',
      `Unreachable file: "${row.name}" is not reachable from any entry point.`,
      ['Duplication'],
      'minor',
      row.file_path,
      1,
      repoRoot,
    ));
  }

  // ── Structural duplicates (STRUCTURALLY_SIMILAR edges) ───────────────────
  const dupes = db.prepare(`
    SELECT e.id, n1.name AS src_name, n1.file_path AS src_path,
           COALESCE(n1.start_line, 1) AS src_line
    FROM edges e
    JOIN nodes n1 ON n1.id = e.source_id
    JOIN nodes n2 ON n2.id = e.target_id
    WHERE e.relation = 'STRUCTURALLY_SIMILAR'
    AND n1.file_path IS NOT NULL
  `).all() as { id: string; src_name: string; src_path: string; src_line: number }[];

  for (const row of dupes) {
    issues.push(makeIssue(
      'monograph/duplicate',
      `Duplicate: "${row.src_name}" is structurally similar to another file.`,
      ['Duplication'],
      'minor',
      row.src_path,
      row.src_line ?? 1,
      repoRoot,
    ));
  }

  return issues;
}

// ── Round 10: health + duplication CodeClimate exports ────────────────────────

export interface CodeClimateHealthIssue extends CodeClimateIssue {
  categories: ['Complexity'];
}

export interface CodeClimateDuplicationIssue extends CodeClimateIssue {
  categories: ['Duplication'];
}

export interface HealthFindingInput {
  filePath: string;
  functionName: string;
  startLine: number;
  endLine: number;
  severity: 'major' | 'minor' | 'critical' | 'info';
  crapScore: number;
  cyclomatic: number;
}

export interface DuplicationFindingInput {
  filePath: string;
  startLine: number;
  endLine: number;
  groupId: number;
  duplicatedLines: number;
}

function fingerprint(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export function exportHealthCodeClimate(findings: HealthFindingInput[]): CodeClimateIssue[] {
  return findings.map(f => ({
    type: 'issue',
    check_name: 'complexity',
    description: `${f.functionName}: cyclomatic=${f.cyclomatic}, CRAP=${f.crapScore.toFixed(1)}`,
    categories: ['Complexity'],
    severity: f.severity,
    fingerprint: fingerprint(`${f.filePath}:${f.functionName}:${f.startLine}`),
    location: { path: f.filePath, lines: { begin: f.startLine, end: f.endLine } },
  }));
}

export function exportDuplicationCodeClimate(findings: DuplicationFindingInput[]): CodeClimateIssue[] {
  return findings.map(f => ({
    type: 'issue',
    check_name: 'duplication',
    description: `Code duplication: ${f.duplicatedLines} lines (group ${f.groupId})`,
    categories: ['Duplication'],
    severity: 'minor' as const,
    fingerprint: fingerprint(`${f.filePath}:${f.groupId}:${f.startLine}`),
    location: { path: f.filePath, lines: { begin: f.startLine, end: f.endLine } },
  }));
}
