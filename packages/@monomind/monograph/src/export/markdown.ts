import { relative } from 'path';
import type { MonographDb } from '../storage/db.js';

export interface MarkdownReportOptions {
  groupByOwner?: boolean;
  repoRoot?: string;
  title?: string;
}

function relPath(filePath: string, repoRoot?: string): string {
  if (!repoRoot) return filePath;
  return relative(repoRoot, filePath);
}

function backtick(p: string): string {
  return `\`${p}\``;
}

interface FileRow {
  name: string;
  file_path: string;
  owner?: string | null;
  line?: number;
  in_degree?: number;
}

interface DupeRow {
  src_path: string;
  target_path: string;
  owner?: string | null;
}

interface ViolationRow {
  file_path: string;
  line: number;
  rule: string;
  owner?: string | null;
}

function getOwner(row: { owner?: string | null }): string {
  return row.owner?.trim() || 'Unowned';
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

/**
 * Generate a human-readable Markdown report from the monograph graph DB.
 */
export function exportMarkdown(db: MonographDb, options?: MarkdownReportOptions): string {
  const { groupByOwner = false, repoRoot, title = 'Monograph Report' } = options ?? {};
  const sections: string[] = [];

  sections.push(`## ${title}`);
  sections.push('');

  // ── Health Score ───────────────────────────────────────────────────────────
  const healthRow = db.prepare(`
    SELECT json_extract(properties, '$.healthScore') AS score,
           json_extract(properties, '$.healthGrade') AS grade
    FROM nodes
    WHERE json_extract(properties, '$.healthScore') IS NOT NULL
    LIMIT 1
  `).get() as { score: number; grade: string } | undefined;

  if (healthRow) {
    sections.push('### Health Score');
    sections.push('');
    const gradeStr = healthRow.grade ? ` (Grade: **${healthRow.grade}**)` : '';
    sections.push(`Score: **${healthRow.score}**${gradeStr}`);
    sections.push('');
  }

  // ── Unreachable files ──────────────────────────────────────────────────────
  const unreachable = db.prepare(`
    SELECT name, file_path,
           json_extract(properties, '$.owner') AS owner
    FROM nodes
    WHERE label = 'File'
    AND (
      json_extract(properties, '$.reachabilityRole') = 'unreachable'
      OR properties LIKE '%"unreachable"%'
    )
    AND file_path IS NOT NULL
    ORDER BY file_path
  `).all() as FileRow[];

  if (unreachable.length > 0) {
    if (groupByOwner) {
      const byOwner = groupBy(unreachable, getOwner);
      for (const [owner, rows] of byOwner) {
        sections.push(`### Unreachable Files — ${owner} (${rows.length})`);
        sections.push('');
        for (const row of rows) {
          sections.push(`- ${backtick(relPath(row.file_path, repoRoot))}`);
        }
        sections.push('');
      }
    } else {
      sections.push(`### Unreachable Files (${unreachable.length})`);
      sections.push('');
      for (const row of unreachable) {
        sections.push(`- ${backtick(relPath(row.file_path, repoRoot))}`);
      }
      sections.push('');
    }
  }

  // ── God nodes ──────────────────────────────────────────────────────────────
  const totalNodes = (db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE label = 'File'`).get() as { c: number }).c;
  const top10pct = Math.max(1, Math.floor(totalNodes * 0.1));
  const godNodes = db.prepare(`
    SELECT n.name, n.file_path,
           COALESCE(n.start_line, 1) AS line,
           json_extract(n.properties, '$.owner') AS owner,
           COUNT(e.id) AS in_degree
    FROM nodes n
    LEFT JOIN edges e ON e.target_id = n.id
    WHERE n.file_path IS NOT NULL AND n.label = 'File'
    GROUP BY n.id
    ORDER BY in_degree DESC
    LIMIT ?
  `).all(top10pct) as FileRow[];

  const filteredGodNodes = godNodes.filter(r => (r.in_degree ?? 0) > 0);
  if (filteredGodNodes.length > 0) {
    if (groupByOwner) {
      const byOwner = groupBy(filteredGodNodes, getOwner);
      for (const [owner, rows] of byOwner) {
        sections.push(`### God Nodes — ${owner} (${rows.length})`);
        sections.push('');
        sections.push('| File | Fan-in |');
        sections.push('|------|--------|');
        for (const row of rows) {
          sections.push(`| ${backtick(relPath(row.file_path, repoRoot))} | ${row.in_degree} |`);
        }
        sections.push('');
      }
    } else {
      sections.push(`### God Nodes (${filteredGodNodes.length})`);
      sections.push('');
      sections.push('| File | Fan-in |');
      sections.push('|------|--------|');
      for (const row of filteredGodNodes) {
        sections.push(`| ${backtick(relPath(row.file_path, repoRoot))} | ${row.in_degree} |`);
      }
      sections.push('');
    }
  }

  // ── Duplicate files ────────────────────────────────────────────────────────
  const dupes = db.prepare(`
    SELECT n1.file_path AS src_path,
           n2.file_path AS target_path,
           json_extract(n1.properties, '$.owner') AS owner
    FROM edges e
    JOIN nodes n1 ON n1.id = e.source_id
    JOIN nodes n2 ON n2.id = e.target_id
    WHERE e.relation = 'STRUCTURALLY_SIMILAR'
    AND n1.file_path IS NOT NULL AND n2.file_path IS NOT NULL
    ORDER BY n1.file_path
  `).all() as DupeRow[];

  if (dupes.length > 0) {
    if (groupByOwner) {
      const byOwner = groupBy(dupes, getOwner);
      for (const [owner, rows] of byOwner) {
        sections.push(`### Duplicate Files — ${owner} (${rows.length})`);
        sections.push('');
        for (const row of rows) {
          sections.push(`- ${backtick(relPath(row.src_path, repoRoot))} ↔ ${backtick(relPath(row.target_path, repoRoot))}`);
        }
        sections.push('');
      }
    } else {
      sections.push(`### Duplicate Files (${dupes.length})`);
      sections.push('');
      for (const row of dupes) {
        sections.push(`- ${backtick(relPath(row.src_path, repoRoot))} ↔ ${backtick(relPath(row.target_path, repoRoot))}`);
      }
      sections.push('');
    }
  }

  // ── Boundary violations ───────────────────────────────────────────────────
  const violations = db.prepare(`
    SELECT file_path, COALESCE(start_line, 1) AS line,
           json_extract(properties, '$.boundaryViolation') AS rule,
           json_extract(properties, '$.owner') AS owner
    FROM nodes
    WHERE file_path IS NOT NULL
    AND json_extract(properties, '$.boundaryViolation') IS NOT NULL
    ORDER BY file_path
  `).all() as ViolationRow[];

  if (violations.length > 0) {
    if (groupByOwner) {
      const byOwner = groupBy(violations, getOwner);
      for (const [owner, rows] of byOwner) {
        sections.push(`### Boundary Violations — ${owner} (${rows.length})`);
        sections.push('');
        for (const row of rows) {
          sections.push(`- ${backtick(relPath(row.file_path, repoRoot))}:${row.line} — ${row.rule}`);
        }
        sections.push('');
      }
    } else {
      sections.push(`### Boundary Violations (${violations.length})`);
      sections.push('');
      for (const row of violations) {
        sections.push(`- ${backtick(relPath(row.file_path, repoRoot))}:${row.line} — ${row.rule}`);
      }
      sections.push('');
    }
  }

  // ── Suggestions (top 3 from DB if available) ──────────────────────────────
  let suggestionRows: { suggestion: string }[] = [];
  try {
    suggestionRows = db.prepare(`
      SELECT json_extract(properties, '$.suggestion') AS suggestion
      FROM nodes
      WHERE json_extract(properties, '$.suggestion') IS NOT NULL
      LIMIT 3
    `).all() as { suggestion: string }[];
  } catch {
    // table or column not present — skip
  }

  if (suggestionRows.length > 0) {
    sections.push('### Suggestions');
    sections.push('');
    for (const row of suggestionRows) {
      sections.push(`- ${row.suggestion}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

// ── Round 10: health + duplication Markdown exports ───────────────────────────

export interface MarkdownHealthFinding {
  filePath: string;
  functionName: string;
  startLine: number;
  cyclomatic: number;
  cognitive: number;
  crapScore: number;
  severity: string;
}

export interface MarkdownDuplicationGroup {
  groupId: number;
  instances: Array<{ filePath: string; startLine: number; endLine: number }>;
  duplicatedLines: number;
}

export function exportHealthMarkdown(findings: MarkdownHealthFinding[], title = 'Health Report'): string {
  const lines = [`# ${title}`, '', `Found ${findings.length} complex function(s).`, ''];
  if (findings.length === 0) return lines.join('\n');
  lines.push('| File | Function | Line | Cyclomatic | Cognitive | CRAP | Severity |');
  lines.push('|------|----------|------|------------|-----------|------|----------|');
  for (const f of findings) {
    const file = f.filePath.split('/').slice(-2).join('/');
    lines.push(`| ${file} | \`${f.functionName}\` | ${f.startLine} | ${f.cyclomatic} | ${f.cognitive} | ${f.crapScore.toFixed(1)} | ${f.severity} |`);
  }
  return lines.join('\n');
}

export function exportDuplicationMarkdown(groups: MarkdownDuplicationGroup[], title = 'Duplication Report'): string {
  const lines = [`# ${title}`, '', `Found ${groups.length} clone group(s).`, ''];
  for (const g of groups) {
    lines.push(`## Group ${g.groupId} — ${g.duplicatedLines} lines`);
    for (const inst of g.instances) {
      const file = inst.filePath.split('/').slice(-2).join('/');
      lines.push(`- \`${file}\` lines ${inst.startLine}–${inst.endLine}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
