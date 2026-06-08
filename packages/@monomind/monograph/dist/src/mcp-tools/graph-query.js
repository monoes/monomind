function rowToNode(row) {
    return {
        id: row['id'],
        label: row['label'],
        name: row['name'],
        normLabel: row['norm_label'] ?? '',
        filePath: row['file_path'],
        startLine: row['start_line'],
        endLine: row['end_line'],
        communityId: row['community_id'],
        isExported: row['is_exported'] === 1,
        language: row['language'],
        properties: row['properties'] ? JSON.parse(row['properties']) : undefined,
    };
}
function estimateTokens(nodes) {
    return nodes.reduce((acc, n) => acc + n.name.length + (n.filePath?.length ?? 0) + 20, 0);
}
export function queryGraph(db, input) {
    const mode = input.mode ?? 'bfs';
    const tokenBudget = input.tokenBudget ?? 2000;
    const maxDepth = input.depth ?? 3;
    // Find seed nodes matching the query
    const seedRows = db.prepare(`SELECT * FROM nodes WHERE name LIKE ? OR label LIKE ? LIMIT 20`).all(`%${input.query}%`, `%${input.query}%`);
    const seeds = seedRows.map(rowToNode);
    const visited = new Map();
    const result = [];
    let tokenEstimate = 0;
    let truncated = false;
    for (const seed of seeds) {
        visited.set(seed.id, seed);
        result.push(seed);
        tokenEstimate += estimateTokens([seed]);
        if (tokenEstimate > tokenBudget) {
            truncated = true;
            break;
        }
    }
    if (!truncated) {
        // BFS or DFS expansion
        const frontier = seeds.map(s => ({ id: s.id, depth: 0 }));
        const edgeStmt = db.prepare(`SELECT n.* FROM nodes n JOIN edges e ON n.id = e.target_id WHERE e.source_id = ? LIMIT 20`);
        if (mode === 'bfs') {
            while (frontier.length > 0 && !truncated) {
                const { id, depth } = frontier.shift();
                if (depth >= maxDepth)
                    continue;
                const neighbors = edgeStmt.all(id);
                for (const row of neighbors) {
                    const node = rowToNode(row);
                    if (visited.has(node.id))
                        continue;
                    visited.set(node.id, node);
                    result.push(node);
                    tokenEstimate += estimateTokens([node]);
                    if (tokenEstimate > tokenBudget) {
                        truncated = true;
                        break;
                    }
                    frontier.push({ id: node.id, depth: depth + 1 });
                }
            }
        }
        else {
            // DFS: use stack
            const stack = [...frontier].reverse();
            while (stack.length > 0 && !truncated) {
                const { id, depth } = stack.pop();
                if (depth >= maxDepth)
                    continue;
                const neighbors = edgeStmt.all(id);
                for (let i = neighbors.length - 1; i >= 0; i--) {
                    const node = rowToNode(neighbors[i]);
                    if (visited.has(node.id))
                        continue;
                    visited.set(node.id, node);
                    result.push(node);
                    tokenEstimate += estimateTokens([node]);
                    if (tokenEstimate > tokenBudget) {
                        truncated = true;
                        break;
                    }
                    stack.push({ id: node.id, depth: depth + 1 });
                }
            }
        }
    }
    return { nodes: result, mode, truncated, tokenEstimate };
}
//# sourceMappingURL=graph-query.js.map