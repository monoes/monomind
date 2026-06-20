/**
 * Classify every File node's reachability role.
 *
 * Entry point detection:
 * - Test entry points: files matching test patterns (*.test.*, *.spec.*, __tests__/*)
 * - Runtime entry points: files with no incoming IMPORTS edges (potential roots)
 * - Support files: *.config.*, scripts/*, tools/* etc.
 *
 * BFS propagation (forward — follows what files import):
 * - From test entry points: mark reachable files as 'test'
 * - From runtime entry points: mark reachable files as 'runtime'
 * - Files reachable from both: 'runtime' wins over 'test'
 * - Nodes reachable from neither: marked 'unreachable'
 * - Config/support files (*.config.*, scripts/*): marked 'support'
 */
export function classifyReachability(db, _projectDir) {
    const TEST_PATTERNS = [
        /\.test\.[tj]sx?$/,
        /\.spec\.[tj]sx?$/,
        /__tests__\//,
        /\/test\//,
        /\/tests\//,
    ];
    const SUPPORT_PATTERNS = [
        /\.config\.[tj]sx?$/,
        /\/scripts\//,
        /\/tools\//,
        /jest\.config/,
        /vitest\.config/,
        /webpack\.config/,
        /vite\.config/,
    ];
    const allFileNodes = db.prepare(`SELECT id, file_path, properties FROM nodes WHERE label = 'File' AND file_path IS NOT NULL`).all();
    const roleMap = new Map();
    const testEntryIds = new Set();
    const runtimeEntryIds = new Set();
    // Initial classification by path pattern
    for (const node of allFileNodes) {
        const fp = node.file_path;
        if (TEST_PATTERNS.some(p => p.test(fp))) {
            testEntryIds.add(node.id);
            roleMap.set(node.id, 'test');
        }
        else if (SUPPORT_PATTERNS.some(p => p.test(fp))) {
            roleMap.set(node.id, 'support');
        }
    }
    // Files with no incoming IMPORTS edges are potential runtime roots
    const noIncoming = db.prepare(`
    SELECT n.id FROM nodes n
    WHERE n.label = 'File'
    AND NOT EXISTS (
      SELECT 1 FROM edges e WHERE e.target_id = n.id AND e.relation = 'IMPORTS'
    )
  `).all();
    for (const { id } of noIncoming) {
        if (!roleMap.has(id)) {
            runtimeEntryIds.add(id);
            roleMap.set(id, 'runtime');
        }
    }
    // ── Preload forward adjacency map for BFS (one query vs N per BFS node) ────────
    const forwardEdges = new Map();
    const fwdRows = db.prepare(`SELECT source_id, target_id FROM edges WHERE relation IN ('IMPORTS', 'RE_EXPORTS')`).all();
    for (const row of fwdRows) {
        let targets = forwardEdges.get(row.source_id);
        if (!targets) {
            targets = [];
            forwardEdges.set(row.source_id, targets);
        }
        targets.push(row.target_id);
    }
    // ── BFS from entry points — uses preloaded adjacency (no per-node DB query) ──
    const bfs = (startIds, role) => {
        const queue = Array.from(startIds);
        const visited = new Set(startIds);
        while (queue.length > 0) {
            const nodeId = queue.shift();
            // O(1) adjacency lookup instead of per-node DB query
            const targets = forwardEdges.get(nodeId);
            if (!targets)
                continue;
            for (const target_id of targets) {
                if (!visited.has(target_id)) {
                    visited.add(target_id);
                    // Set role only if not already set to a higher-priority role
                    // Priority: runtime > test > support > unreachable
                    const existing = roleMap.get(target_id);
                    if (!existing || existing === 'unreachable' || (role === 'runtime' && existing === 'test')) {
                        roleMap.set(target_id, role);
                    }
                    queue.push(target_id);
                }
            }
        }
    };
    // Test BFS first, then runtime (runtime wins on overlap)
    bfs(testEntryIds, 'test');
    bfs(runtimeEntryIds, 'runtime');
    // ── Persist roles and count — batch UPDATE in transaction ────────────────────
    const updateStmt = db.prepare(`UPDATE nodes SET properties = ? WHERE id = ?`);
    const persistAll = db.transaction(() => {
        let runtime = 0, test = 0, support = 0, unreachable = 0;
        for (const node of allFileNodes) {
            const role = roleMap.get(node.id) ?? 'unreachable';
            let props = {};
            try {
                if (node.properties)
                    props = JSON.parse(node.properties);
            }
            catch { /* ignore parse errors */ }
            props.reachabilityRole = role;
            updateStmt.run(JSON.stringify(props), node.id);
            if (role === 'runtime')
                runtime++;
            else if (role === 'test')
                test++;
            else if (role === 'support')
                support++;
            else
                unreachable++;
        }
        return { runtime, test, support, unreachable };
    });
    return persistAll();
}
/**
 * Get File nodes filtered by reachability role.
 */
export function getNodesByReachabilityRole(db, role, limit = 100) {
    const rows = db.prepare(`
    SELECT id, name, file_path
    FROM nodes
    WHERE label = 'File'
    AND json_extract(properties, '$.reachabilityRole') = ?
    LIMIT ?
  `).all(role, limit);
    return rows.map(r => ({ id: r.id, name: r.name, filePath: r.file_path }));
}
//# sourceMappingURL=reachability.js.map