const MAX_NODES = 200;
/**
 * Sanitize a string for use as a Mermaid node label (inside quotes).
 * Strips characters that break Mermaid syntax.
 */
function sanitizeLabel(s) {
    return s
        .replace(/["<>&{}()[\]|]/g, '')
        .substring(0, 40)
        .trim();
}
/**
 * Make a Mermaid-safe node id from an arbitrary string.
 */
function safeId(id) {
    return id.replace(/[^a-zA-Z0-9_]/g, '_');
}
/**
 * Converts a knowledge graph to Mermaid flowchart syntax.
 *
 * - Nodes are grouped into subgraphs by communityId when present.
 * - Edges use `-->` for EXTRACTED confidence and `-.->` for INFERRED/AMBIGUOUS.
 * - Edge labels show the relation type.
 * - Diagram is capped at 200 nodes to avoid extremely large output.
 */
export function toMermaid(nodes, edges) {
    const capped = nodes.slice(0, MAX_NODES);
    const cappedIds = new Set(capped.map(n => n.id));
    const lines = ['graph TD'];
    // Group by community
    const communities = new Map();
    for (const n of capped) {
        const key = n.communityId;
        const group = communities.get(key) ?? [];
        group.push(n);
        communities.set(key, group);
    }
    const hasCommunities = communities.has(undefined)
        ? communities.size > 1
        : communities.size > 0;
    if (hasCommunities && !communities.has(undefined)) {
        // All nodes have communityId — use subgraphs
        for (const [communityId, members] of communities) {
            lines.push(`  subgraph community_${communityId}["Community ${communityId}"]`);
            for (const n of members) {
                const nid = safeId(n.id);
                const label = sanitizeLabel(n.name);
                lines.push(`    ${nid}["${label}<br/>${n.label}"]`);
            }
            lines.push('  end');
        }
    }
    else if (hasCommunities) {
        // Mix of nodes with and without communityId
        // Emit subgraphs for communities, then ungrouped
        for (const [communityId, members] of communities) {
            if (communityId === undefined)
                continue;
            lines.push(`  subgraph community_${communityId}["Community ${communityId}"]`);
            for (const n of members) {
                const nid = safeId(n.id);
                const label = sanitizeLabel(n.name);
                lines.push(`    ${nid}["${label}<br/>${n.label}"]`);
            }
            lines.push('  end');
        }
        // ungrouped nodes
        for (const n of communities.get(undefined) ?? []) {
            const nid = safeId(n.id);
            const label = sanitizeLabel(n.name);
            lines.push(`  ${nid}["${label}<br/>${n.label}"]`);
        }
    }
    else {
        // No communities — flat layout
        for (const n of capped) {
            const nid = safeId(n.id);
            const label = sanitizeLabel(n.name);
            lines.push(`  ${nid}["${label}<br/>${n.label}"]`);
        }
    }
    // Edges — only between nodes in the capped set
    for (const e of edges) {
        if (!cappedIds.has(e.sourceId) || !cappedIds.has(e.targetId))
            continue;
        const src = safeId(e.sourceId);
        const tgt = safeId(e.targetId);
        const arrow = e.confidence === 'EXTRACTED' ? '-->' : '-..->';
        const label = sanitizeLabel(e.relation);
        lines.push(`  ${src} ${arrow}|${label}| ${tgt}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=mermaid.js.map