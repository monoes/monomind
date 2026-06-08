export function analyzeRuntimeCoverage(db, coverage, repoRoot) {
    // Build a map: filePath -> Map<functionName, CoverageMapEntry>
    const fileCoverageMap = new Map();
    for (const scriptCov of coverage.result) {
        let filePath = scriptCov.url;
        // Strip file:// prefix
        if (filePath.startsWith('file://')) {
            filePath = filePath.slice('file://'.length);
        }
        // Resolve relative to repoRoot if provided and path is relative
        if (repoRoot && !filePath.startsWith('/')) {
            filePath = repoRoot.replace(/\/$/, '') + '/' + filePath;
        }
        const fnMap = fileCoverageMap.get(filePath) ?? new Map();
        for (const fn of scriptCov.functions) {
            const covered = fn.ranges.some(r => r.count > 0);
            const callCount = fn.ranges.reduce((max, r) => Math.max(max, r.count), 0);
            const existing = fnMap.get(fn.functionName);
            if (!existing || callCount > existing.callCount) {
                fnMap.set(fn.functionName, { covered, callCount });
            }
        }
        fileCoverageMap.set(filePath, fnMap);
    }
    // Helper: normalize a file path for lookup
    function normalizeForLookup(fp) {
        return fp.replace(/\\/g, '/');
    }
    // Build alternate lookup: basename -> filePath list
    const filePathIndex = new Map();
    for (const fp of fileCoverageMap.keys()) {
        const norm = normalizeForLookup(fp);
        filePathIndex.set(norm, (filePathIndex.get(norm) ?? []).concat(fp));
        // Also store by just the filename for relative matching
        const parts = norm.split('/');
        const base = parts[parts.length - 1];
        if (base && base !== norm) {
            filePathIndex.set(base, (filePathIndex.get(base) ?? []).concat(fp));
        }
    }
    // Compute total call count across all functions for LowTraffic threshold
    let totalCallCount = 0;
    for (const fnMap of fileCoverageMap.values()) {
        for (const entry of fnMap.values()) {
            totalCallCount += entry.callCount;
        }
    }
    const lowTrafficThreshold = totalCallCount * 0.05;
    // Query all Symbol nodes that are Functions/Methods
    const rows = db.prepare(`
    SELECT id, name, file_path, start_line, properties
    FROM nodes
    WHERE label IN ('Function', 'Method')
  `).all();
    const entries = [];
    for (const row of rows) {
        const props = row.properties ? JSON.parse(row.properties) : {};
        const reachabilityRole = props.reachabilityRole ?? '';
        let fnEntry = null;
        if (row.file_path) {
            const normFilePath = normalizeForLookup(row.file_path);
            // Try exact match first
            const exactFnMap = fileCoverageMap.get(normFilePath) ?? fileCoverageMap.get(row.file_path);
            if (exactFnMap) {
                const match = exactFnMap.get(row.name);
                if (match)
                    fnEntry = match;
                // If no exact function name match, aggregate all functions for this file
                if (!fnEntry) {
                    // Best-effort: file is covered if any function is covered
                    let fileCovered = false;
                    let fileMaxCount = 0;
                    for (const e of exactFnMap.values()) {
                        if (e.covered)
                            fileCovered = true;
                        fileMaxCount = Math.max(fileMaxCount, e.callCount);
                    }
                    if (exactFnMap.size > 0) {
                        fnEntry = { covered: fileCovered, callCount: fileMaxCount };
                    }
                }
            }
            else {
                // Try relative path matching
                for (const [covPath, fnMap] of fileCoverageMap.entries()) {
                    if (covPath.endsWith(normFilePath) || normFilePath.endsWith(covPath.replace(/.*\//, ''))) {
                        const match = fnMap.get(row.name);
                        if (match) {
                            fnEntry = match;
                            break;
                        }
                        // Aggregate file-level coverage
                        let fileCovered = false;
                        let fileMaxCount = 0;
                        for (const e of fnMap.values()) {
                            if (e.covered)
                                fileCovered = true;
                            fileMaxCount = Math.max(fileMaxCount, e.callCount);
                        }
                        if (fnMap.size > 0) {
                            fnEntry = { covered: fileCovered, callCount: fileMaxCount };
                            break;
                        }
                    }
                }
            }
        }
        let classification;
        let covered = false;
        let callCount = 0;
        if (!fnEntry) {
            classification = 'CoverageUnavailable';
        }
        else {
            covered = fnEntry.covered;
            callCount = fnEntry.callCount;
            if (!covered && reachabilityRole === 'unreachable') {
                classification = 'SafeToDelete';
            }
            else if (covered && reachabilityRole === 'unreachable') {
                classification = 'ReviewRequired';
            }
            else if (covered && callCount < lowTrafficThreshold) {
                classification = 'LowTraffic';
            }
            else if (covered) {
                classification = 'Active';
            }
            else {
                // not covered, not unreachable — treat as unavailable
                classification = 'CoverageUnavailable';
            }
        }
        entries.push({
            nodeId: row.id,
            name: row.name,
            filePath: row.file_path,
            startLine: row.start_line,
            covered,
            callCount,
            classification,
        });
    }
    // Aggregate counts
    let safeToDelete = 0;
    let reviewRequired = 0;
    let active = 0;
    let coverageUnavailable = 0;
    const blastRadiusSet = new Set();
    for (const entry of entries) {
        switch (entry.classification) {
            case 'SafeToDelete':
                safeToDelete++;
                break;
            case 'ReviewRequired':
                reviewRequired++;
                break;
            case 'Active':
                active++;
                break;
            case 'CoverageUnavailable':
                coverageUnavailable++;
                break;
        }
        // BlastRadius: Active nodes with reachabilityRole === 'runtime'
        if (entry.classification === 'Active' && entry.filePath) {
            const nodeProps = entries.find(e => e.nodeId === entry.nodeId);
            // Re-query to get reachabilityRole for blast radius check
            const nodeRow = db.prepare(`SELECT properties FROM nodes WHERE id = ?`).get(entry.nodeId);
            if (nodeRow) {
                const p = nodeRow.properties ? JSON.parse(nodeRow.properties) : {};
                if (p.reachabilityRole === 'runtime') {
                    blastRadiusSet.add(entry.filePath);
                }
            }
        }
    }
    return {
        entries,
        safeToDelete,
        reviewRequired,
        active,
        coverageUnavailable,
        blastRadius: Array.from(blastRadiusSet),
    };
}
//# sourceMappingURL=runtime.js.map