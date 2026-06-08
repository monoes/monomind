import { writeFileSync } from 'fs';
import { join } from 'path';
import { openDb, closeDb } from '../storage/db.js';
import { checkStaleness } from '../staleness/git-staleness.js';
function queryNodesByType(db) {
    const rows = db.prepare(`
    SELECT label, COUNT(*) as count FROM nodes GROUP BY label ORDER BY count DESC
  `).all();
    return rows;
}
function queryEdgesByRelation(db) {
    const rows = db.prepare(`
    SELECT relation, COUNT(*) as count FROM edges GROUP BY relation ORDER BY count DESC
  `).all();
    return rows;
}
function queryTopNodesByDegree(db, limit = 10) {
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
  `).all(limit);
    return rows;
}
function queryConfidenceBreakdown(db) {
    const rows = db.prepare(`
    SELECT confidence, COUNT(*) as count FROM edges GROUP BY confidence ORDER BY count DESC
  `).all();
    return rows;
}
function buildKnowledgeGapSection(db) {
    // Isolated nodes: nodes with no edges (excluding File/Folder structural nodes)
    const isolated = db.prepare(`
    SELECT n.id, n.name, n.label FROM nodes n
    WHERE n.label NOT IN ('File','Folder')
    AND n.id NOT IN (SELECT source_id FROM edges)
    AND n.id NOT IN (SELECT target_id FROM edges)
    LIMIT 20
  `).all();
    // Thin communities: community_id groups with fewer than 3 members
    const thin = db.prepare(`
    SELECT community_id, COUNT(*) as cnt FROM nodes
    WHERE community_id IS NOT NULL
    GROUP BY community_id
    HAVING cnt < 3
    LIMIT 10
  `).all();
    if (isolated.length === 0 && thin.length === 0)
        return '';
    const lines = ['## Knowledge Gaps\n'];
    if (isolated.length > 0) {
        lines.push(`### Isolated Nodes (${isolated.length})\n`);
        lines.push('Nodes with no edges — may indicate dead code or missing imports:\n');
        for (const n of isolated.slice(0, 10)) {
            lines.push(`- **${n.label}** \`${n.name}\``);
        }
        lines.push('');
    }
    if (thin.length > 0) {
        lines.push(`### Thin Communities (${thin.length})\n`);
        lines.push('Communities with fewer than 3 members — may need merging:\n');
        for (const t of thin) {
            lines.push(`- Community ${t.community_id}: ${t.cnt} member${t.cnt === 1 ? '' : 's'}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
function buildConfidenceAuditSection(db) {
    const rows = queryConfidenceBreakdown(db);
    if (rows.length === 0)
        return '';
    const total = rows.reduce((s, r) => s + r.count, 0);
    const lines = ['## Confidence Audit\n'];
    lines.push('| Confidence | Count | Percentage |');
    lines.push('|-----------|-------|------------|');
    for (const r of rows) {
        const pct = total > 0 ? ((r.count / total) * 100).toFixed(1) : '0.0';
        lines.push(`| ${r.confidence} | ${r.count} | ${pct}% |`);
    }
    lines.push('');
    return lines.join('\n');
}
function queryCommunities(db) {
    // Get communities from nodes (community_id column)
    const rows = db.prepare(`
    SELECT community_id as id, COUNT(*) as memberCount
    FROM nodes
    WHERE community_id IS NOT NULL
    GROUP BY community_id
    ORDER BY memberCount DESC
  `).all();
    // Try to get labels from communities table
    const labelMap = new Map();
    try {
        const labels = db.prepare(`SELECT id, label FROM communities`).all();
        for (const l of labels)
            labelMap.set(l.id, l.label);
    }
    catch {
        // communities table may not have data
    }
    return rows.map(r => ({ id: r.id, label: labelMap.get(r.id) ?? null, memberCount: r.memberCount }));
}
function queryNodeCount(db) {
    const row = db.prepare('SELECT COUNT(*) as n FROM nodes').get();
    return row.n;
}
function queryEdgeCount(db) {
    const row = db.prepare('SELECT COUNT(*) as n FROM edges').get();
    return row.n;
}
function buildMarkdown(nodeCount, edgeCount, nodesByType, edgesByRelation, topNodes, communities, staleFiles, confidenceSection = '') {
    const timestamp = new Date().toISOString();
    const lines = [];
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
    }
    else {
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
    }
    else {
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
    }
    else {
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
    }
    else {
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
    }
    else {
        lines.push('_No stale files detected._');
    }
    lines.push('');
    if (confidenceSection) {
        lines.push(confidenceSection);
    }
    return lines.join('\n');
}
export function buildMarkdownWithQuestions(nodeCount, edgeCount, nodesByType, edgesByRelation, topNodes, communities, staleFiles, questions, confidenceSection = '') {
    let md = buildMarkdown(nodeCount, edgeCount, nodesByType, edgesByRelation, topNodes, communities, staleFiles, confidenceSection);
    if (questions.length === 0)
        return md;
    const capped = questions.slice(0, 20);
    const lines = ['## Suggested Questions', ''];
    for (const q of capped) {
        if (q.type === 'bridge_node') {
            lines.push(`- **bridge_node**: \`${q.node.name}\` bridges community ${q.commA} and ${q.commB}`);
        }
        else if (q.type === 'ambiguous_edge') {
            lines.push(`- **ambiguous_edge**: \`${q.edge.sourceId}\` → \`${q.edge.targetId}\` — ${q.reason}`);
        }
        else if (q.type === 'verify_inferred') {
            lines.push(`- **verify_inferred**: \`${q.edge.sourceId}\` → \`${q.edge.targetId}\` (inferred from ${q.inferredFrom})`);
        }
        else if (q.type === 'isolated_nodes') {
            const names = q.nodes.map(n => `\`${n.name}\``).join(', ');
            lines.push(`- **isolated_nodes**: ${names} — ${q.reason}`);
        }
        else if (q.type === 'low_cohesion') {
            lines.push(`- **low_cohesion**: community ${q.community.id} (cohesion: ${q.community.cohesionScore.toFixed(2)})`);
        }
    }
    lines.push('');
    md = md + '\n' + lines.join('\n');
    return md;
}
/**
 * Generates a graph report synchronously from an existing DB instance.
 * Writes the markdown to outputPath/GRAPH_REPORT.md and returns the result.
 */
export function generateGraphReportFromDb(db, outputPath) {
    const resolvedOutputPath = join(outputPath, 'GRAPH_REPORT.md');
    const nodeCount = queryNodeCount(db);
    const edgeCount = queryEdgeCount(db);
    const nodesByType = queryNodesByType(db);
    const edgesByRelation = queryEdgesByRelation(db);
    const topNodes = queryTopNodesByDegree(db, 10);
    const communities = queryCommunities(db);
    const confidenceSection = buildConfidenceAuditSection(db);
    const gapSection = buildKnowledgeGapSection(db);
    const markdown = buildMarkdownWithQuestions(nodeCount, edgeCount, nodesByType, edgesByRelation, topNodes, communities, [], [], confidenceSection) + (gapSection ? '\n' + gapSection : '');
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
}
export function generateGraphReport(dbOrRepoPath, outputPath, dbPath, questions = []) {
    // Sync overload: first arg is a DB instance
    if (typeof dbOrRepoPath !== 'string') {
        const db = dbOrRepoPath;
        return generateGraphReportFromDb(db, outputPath ?? '/tmp');
    }
    // Async overload: first arg is a repo path string
    const repoPath = dbOrRepoPath;
    const resolvedDbPath = dbPath ?? join(repoPath, '.monograph', 'graph.db');
    const resolvedOutputPath = outputPath ?? join(repoPath, 'GRAPH_REPORT.md');
    return (async () => {
        const db = openDb(resolvedDbPath);
        try {
            const nodeCount = queryNodeCount(db);
            const edgeCount = queryEdgeCount(db);
            const nodesByType = queryNodesByType(db);
            const edgesByRelation = queryEdgesByRelation(db);
            const topNodes = queryTopNodesByDegree(db, 10);
            const communities = queryCommunities(db);
            // Stale files from git-staleness
            let staleFiles = [];
            try {
                const stalenessReport = checkStaleness(db, repoPath);
                if (stalenessReport.isStale && stalenessReport.changedSince.length > 0) {
                    staleFiles = stalenessReport.changedSince;
                }
            }
            catch {
                // Staleness check is best-effort
            }
            const confidenceSection = buildConfidenceAuditSection(db);
            const gapSection = buildKnowledgeGapSection(db);
            const markdown = buildMarkdownWithQuestions(nodeCount, edgeCount, nodesByType, edgesByRelation, topNodes, communities, staleFiles, questions, confidenceSection) + (gapSection ? '\n' + gapSection : '');
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
        }
        finally {
            closeDb(db);
        }
    })();
}
//# sourceMappingURL=graph-report.js.map