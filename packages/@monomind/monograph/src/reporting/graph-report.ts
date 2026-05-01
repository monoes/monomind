import { writeFileSync } from 'fs';
import { join } from 'path';
import type { MonographDb } from '../storage/db.js';
import { openDb, closeDb } from '../storage/db.js';
import { checkStaleness } from '../staleness/git-staleness.js';

export interface GraphReportResult {
  markdown: string;
  path: string;
  stats: {
    nodeCount: number;
    edgeCount: number;
    communityCount: number;
  };
}

interface NodeTypeStat {
  label: string;
  count: number;
}

interface EdgeRelationStat {
  relation: string;
  count: number;
}

interface TopDegreeNode {
  id: string;
  name: string;
  label: string;
  degree: number;
}

interface CommunityStat {
  id: number;
  label: string | null;
  memberCount: number;
}

function queryNodesByType(db: MonographDb): NodeTypeStat[] {
  const rows = db.prepare(`
    SELECT label, COUNT(*) as count FROM nodes GROUP BY label ORDER BY count DESC
  `).all() as { label: string; count: number }[];
  return rows;
}

function queryEdgesByRelation(db: MonographDb): EdgeRelationStat[] {
  const rows = db.prepare(`
    SELECT relation, COUNT(*) as count FROM edges GROUP BY relation ORDER BY count DESC
  `).all() as { relation: string; count: number }[];
  return rows;
}

function queryTopNodesByDegree(db: MonographDb, limit = 10): TopDegreeNode[] {
  const rows = db.prepare(`
    SELECT
      n.id,
      n.name,
      n.label,
      (
        SELECT COUNT(*) FROM edges WHERE source_id = n.id
      ) + (
        SELECT COUNT(*) FROM edges WHERE target_id = n.id
      ) AS degree
    FROM nodes n
    ORDER BY degree DESC
    LIMIT ?
  `).all(limit) as TopDegreeNode[];
  return rows;
}

function queryCommunities(db: MonographDb): CommunityStat[] {
  // Get communities from nodes (community_id column)
  const rows = db.prepare(`
    SELECT community_id as id, COUNT(*) as memberCount
    FROM nodes
    WHERE community_id IS NOT NULL
    GROUP BY community_id
    ORDER BY memberCount DESC
  `).all() as { id: number; memberCount: number }[];

  // Try to get labels from communities table
  const labelMap = new Map<number, string | null>();
  try {
    const labels = db.prepare(`SELECT id, label FROM communities`).all() as { id: number; label: string | null }[];
    for (const l of labels) labelMap.set(l.id, l.label);
  } catch {
    // communities table may not have data
  }

  return rows.map(r => ({ id: r.id, label: labelMap.get(r.id) ?? null, memberCount: r.memberCount }));
}

function queryNodeCount(db: MonographDb): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM nodes').get() as { n: number };
  return row.n;
}

function queryEdgeCount(db: MonographDb): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM edges').get() as { n: number };
  return row.n;
}

function buildMarkdown(
  nodeCount: number,
  edgeCount: number,
  nodesByType: NodeTypeStat[],
  edgesByRelation: EdgeRelationStat[],
  topNodes: TopDegreeNode[],
  communities: CommunityStat[],
  staleFiles: string[],
): string {
  const timestamp = new Date().toISOString();
  const lines: string[] = [];

  lines.push(`# Graph Report`);
  lines.push('');
  lines.push(`_Generated: ${timestamp}_`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total nodes | ${nodeCount} |`);
  lines.push(`| Total edges | ${edgeCount} |`);
  lines.push(`| Communities | ${communities.length} |`);
  lines.push('');

  // Nodes by type
  lines.push('## Nodes by Type');
  lines.push('');
  if (nodesByType.length > 0) {
    lines.push('| Label | Count |');
    lines.push('|-------|-------|');
    for (const { label, count } of nodesByType) {
      lines.push(`| ${label} | ${count} |`);
    }
  } else {
    lines.push('_No nodes found._');
  }
  lines.push('');

  // Edges by relation
  lines.push('## Edges by Relation');
  lines.push('');
  if (edgesByRelation.length > 0) {
    lines.push('| Relation | Count |');
    lines.push('|----------|-------|');
    for (const { relation, count } of edgesByRelation) {
      lines.push(`| ${relation} | ${count} |`);
    }
  } else {
    lines.push('_No edges found._');
  }
  lines.push('');

  // Top 10 nodes by degree
  lines.push('## Top Nodes by Degree');
  lines.push('');
  if (topNodes.length > 0) {
    lines.push('| Rank | Name | Type | Degree |');
    lines.push('|------|------|------|--------|');
    topNodes.forEach((node, idx) => {
      lines.push(`| ${idx + 1} | \`${node.name}\` | ${node.label} | ${node.degree} |`);
    });
  } else {
    lines.push('_No nodes found._');
  }
  lines.push('');

  // Communities
  lines.push('## Communities');
  lines.push('');
  if (communities.length > 0) {
    for (const c of communities) {
      const name = c.label ?? `Community ${c.id}`;
      lines.push(`- **${name}** (id: ${c.id}) — ${c.memberCount} members`);
    }
  } else {
    lines.push('_No communities detected._');
  }
  lines.push('');

  // Stale files
  lines.push('## Stale Files');
  lines.push('');
  if (staleFiles.length > 0) {
    for (const f of staleFiles) {
      lines.push(`- \`${f}\``);
    }
  } else {
    lines.push('_No stale files detected._');
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Generates a GRAPH_REPORT.md summarizing the knowledge graph.
 *
 * @param repoPath - Path to the repository root (also used to locate the DB)
 * @param outputPath - Where to write the markdown file (defaults to repoPath/GRAPH_REPORT.md)
 * @param dbPath - Path to the SQLite database (defaults to repoPath/.monograph/graph.db)
 */
export async function generateGraphReport(
  repoPath: string,
  outputPath?: string,
  dbPath?: string,
): Promise<GraphReportResult> {
  const resolvedDbPath = dbPath ?? join(repoPath, '.monograph', 'graph.db');
  const resolvedOutputPath = outputPath ?? join(repoPath, 'GRAPH_REPORT.md');

  const db = openDb(resolvedDbPath);
  try {
    const nodeCount = queryNodeCount(db);
    const edgeCount = queryEdgeCount(db);
    const nodesByType = queryNodesByType(db);
    const edgesByRelation = queryEdgesByRelation(db);
    const topNodes = queryTopNodesByDegree(db, 10);
    const communities = queryCommunities(db);

    // Stale files from git-staleness
    let staleFiles: string[] = [];
    try {
      const stalenessReport = checkStaleness(db, repoPath);
      if (stalenessReport.isStale && stalenessReport.changedSince.length > 0) {
        staleFiles = stalenessReport.changedSince;
      }
    } catch {
      // Staleness check is best-effort
    }

    const markdown = buildMarkdown(
      nodeCount,
      edgeCount,
      nodesByType,
      edgesByRelation,
      topNodes,
      communities,
      staleFiles,
    );

    writeFileSync(resolvedOutputPath, markdown, 'utf8');

    return {
      markdown,
      path: resolvedOutputPath,
      stats: {
        nodeCount,
        edgeCount,
        communityCount: communities.length,
      },
    };
  } finally {
    closeDb(db);
  }
}
