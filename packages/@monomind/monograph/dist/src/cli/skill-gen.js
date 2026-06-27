/**
 * Skill File Generator
 *
 * Generates per-community skill/context files that describe a code community's
 * purpose, top symbols, and relationships. These files help AI agents navigate
 * large codebases by providing curated summaries per architectural boundary.
 */
import fs from 'fs/promises';
import path from 'path';
import { openDb, closeDb } from '../storage/db.js';
// ============================================================================
// MAIN EXPORT
// ============================================================================
/**
 * Generate per-community skill files from the Monograph knowledge graph.
 *
 * @param repoPath - Absolute path to the repository root
 * @param outputDir - Output directory for skill files (default: .monomind/skills/)
 * @returns Metadata about the generated files
 */
export async function generateSkillFiles(repoPath, outputDir) {
    const dbPath = path.join(repoPath, '.monomind', 'monograph.db');
    const skillsDir = outputDir ?? path.join(repoPath, '.monomind', 'skills');
    const db = openDb(dbPath);
    let communities;
    try {
        communities = queryCommunities(db);
    }
    finally {
        closeDb(db);
    }
    if (communities.length === 0) {
        return { filesWritten: [], communityCount: 0 };
    }
    await fs.mkdir(skillsDir, { recursive: true });
    const filesWritten = [];
    for (const community of communities) {
        const db2 = openDb(dbPath);
        let members;
        let crossConnections;
        try {
            members = queryMembers(db2, community.community_id);
            crossConnections = queryCrossConnections(db2, community.community_id);
        }
        finally {
            closeDb(db2);
        }
        const content = renderSkillMarkdown(community, members, crossConnections, repoPath);
        const kebab = toKebabName(community.label || `community-${community.community_id}`);
        const filePath = path.join(skillsDir, `${kebab}.md`);
        await fs.writeFile(filePath, content, 'utf-8');
        filesWritten.push(filePath);
    }
    return { filesWritten, communityCount: communities.length };
}
// ============================================================================
// DB QUERIES
// ============================================================================
function queryCommunities(db) {
    // Try label-based community detection first (community_id column on nodes)
    try {
        const rows = db.prepare(`
      SELECT community_id, label AS label, COUNT(*) AS member_count
      FROM nodes
      WHERE community_id IS NOT NULL
        AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
      GROUP BY community_id
      HAVING member_count >= 2
      ORDER BY member_count DESC
      LIMIT 20
    `).all();
        if (rows.length > 0) {
            // Derive a community label from the most common folder in file paths,
            // falling back to the most common node label, then a generic name.
            return rows.map((r) => ({
                community_id: r.community_id,
                label: deriveCommunityLabel(db, r.community_id) || r.label || `Community ${r.community_id}`,
            }));
        }
    }
    catch {
        // community_id column may not exist in older DBs
    }
    // Fallback: try querying explicit Community nodes
    try {
        const rows = db.prepare(`
      SELECT id AS community_id, name AS label
      FROM nodes
      WHERE label = 'Community'
      ORDER BY name
      LIMIT 20
    `).all();
        return rows;
    }
    catch {
        return [];
    }
}
function deriveCommunityLabel(db, communityId) {
    // Use the most common folder name from member file paths as the label
    try {
        const rows = db.prepare(`
      SELECT file_path
      FROM nodes
      WHERE community_id = ?
        AND file_path IS NOT NULL
        AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
    `).all(communityId);
        const folderCounts = new Map();
        for (const row of rows) {
            const parts = row.file_path.replace(/\\/g, '/').split('/').filter(Boolean);
            if (parts.length >= 2) {
                const folder = parts[parts.length - 2];
                const lower = folder.toLowerCase();
                if (!['src', 'lib', 'core', 'utils', 'common', 'shared', 'helpers', 'dist'].includes(lower)) {
                    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
                }
            }
        }
        let best = '';
        let bestCount = 0;
        for (const [folder, count] of folderCounts) {
            if (count > bestCount) {
                bestCount = count;
                best = folder;
            }
        }
        if (best) {
            return best.charAt(0).toUpperCase() + best.slice(1);
        }
    }
    catch {
        // ignore
    }
    return '';
}
function queryMembers(db, communityId) {
    try {
        return db.prepare(`
      SELECT id, label, name, file_path, start_line, is_exported
      FROM nodes
      WHERE community_id = ?
        AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
      ORDER BY
        CASE WHEN is_exported = 1 THEN 0 ELSE 1 END,
        label,
        name
      LIMIT 50
    `).all(communityId);
    }
    catch {
        return [];
    }
}
function queryCrossConnections(db, communityId) {
    try {
        return db.prepare(`
      SELECT n2.community_id AS target_community, n2.name AS target_name, COUNT(*) AS count
      FROM edges e
      JOIN nodes n1 ON n1.id = e.source_id
      JOIN nodes n2 ON n2.id = e.target_id
      WHERE n1.community_id = ?
        AND (n2.community_id IS NULL OR n2.community_id != ?)
        AND e.relation = 'CALLS'
      GROUP BY n2.community_id
      ORDER BY count DESC
      LIMIT 8
    `).all(communityId, communityId);
    }
    catch {
        return [];
    }
}
// ============================================================================
// MARKDOWN RENDERING
// ============================================================================
function renderSkillMarkdown(community, members, crossConnections, repoPath) {
    const label = community.label;
    const lines = [];
    // Frontmatter
    lines.push('---');
    lines.push(`name: ${toKebabName(label)}`);
    lines.push(`description: "Skill for the ${label} community. ${members.length} symbols."`);
    lines.push(`type: Code Community`);
    lines.push(`tags: [monograph, code-community]`);
    lines.push(`timestamp: ${new Date().toISOString()}`);
    lines.push('---');
    lines.push('');
    // Title
    lines.push(`# ${label}`);
    lines.push('');
    lines.push(`${members.length} symbols | Community ${community.community_id}`);
    lines.push('');
    // Key Files
    const fileMap = buildFileMap(members, repoPath);
    if (fileMap.size > 0) {
        lines.push('## Key Files');
        lines.push('');
        lines.push('| File | Symbols |');
        lines.push('|------|---------|');
        const sorted = [...fileMap.entries()].sort((a, b) => b[1].length - a[1].length);
        for (const [relPath, symbols] of sorted.slice(0, 10)) {
            const sym = symbols.slice(0, 5).join(', ');
            const extra = symbols.length > 5 ? ` (+${symbols.length - 5})` : '';
            lines.push(`| \`${relPath}\` | ${sym}${extra} |`);
        }
        lines.push('');
    }
    // Key Symbols
    if (members.length > 0) {
        lines.push('## Key Symbols');
        lines.push('');
        lines.push('| Symbol | Type | File | Line |');
        lines.push('|--------|------|------|------|');
        for (const m of members.slice(0, 20)) {
            const filePath = m.file_path
                ? toRelativePath(m.file_path, repoPath)
                : '';
            lines.push(`| \`${m.name}\` | ${m.label} | \`${filePath}\` | ${m.start_line ?? ''} |`);
        }
        lines.push('');
    }
    // Connected Areas
    if (crossConnections.length > 0) {
        lines.push('## Connected Areas');
        lines.push('');
        lines.push('| Community | Call Count |');
        lines.push('|-----------|-----------|');
        for (const c of crossConnections) {
            const target = c.target_community != null
                ? `Community ${c.target_community}`
                : 'External';
            lines.push(`| ${target} | ${c.count} calls |`);
        }
        lines.push('');
    }
    // How to Explore
    const firstSymbol = members[0]?.name ?? label;
    lines.push('## How to Explore');
    lines.push('');
    lines.push(`1. \`monograph_context({name: "${firstSymbol}"})\` — see callers and callees`);
    lines.push(`2. \`monograph_query({query: "${label.toLowerCase()}"})\` — find related symbols`);
    lines.push('3. Read key files listed above for implementation details');
    lines.push('');
    return lines.join('\n');
}
// ============================================================================
// UTILITY HELPERS
// ============================================================================
function buildFileMap(members, repoPath) {
    const map = new Map();
    for (const m of members) {
        if (!m.file_path)
            continue;
        const rel = toRelativePath(m.file_path, repoPath);
        const arr = map.get(rel);
        if (arr) {
            arr.push(m.name);
        }
        else {
            map.set(rel, [m.name]);
        }
    }
    return map;
}
function toRelativePath(filePath, repoPath) {
    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedRepo = repoPath.replace(/\\/g, '/');
    if (normalizedFile.startsWith(normalizedRepo)) {
        return normalizedFile.slice(normalizedRepo.length).replace(/^\//, '');
    }
    return normalizedFile.replace(/^\//, '');
}
function toKebabName(label) {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'skill';
}
//# sourceMappingURL=skill-gen.js.map