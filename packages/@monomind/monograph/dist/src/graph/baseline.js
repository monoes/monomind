import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
function fingerprintFinding(type, ...parts) {
    return createHash('sha256').update([type, ...parts].join('::')).digest('hex').slice(0, 16);
}
/**
 * Save the current set of findings as a baseline JSON file.
 * @param baselinePath - path to write (e.g. .monomind/baseline.json)
 * @param findings - current findings to persist
 * @param projectPath - repo path for identification
 */
export function saveBaseline(baselinePath, findings, projectPath) {
    const data = {
        version: 1,
        savedAt: new Date().toISOString(),
        projectPath,
        findings,
    };
    writeFileSync(baselinePath, JSON.stringify(data, null, 2), 'utf-8');
}
/**
 * Load an existing baseline file.
 */
export function loadBaseline(baselinePath) {
    if (!existsSync(baselinePath))
        return null;
    try {
        return JSON.parse(readFileSync(baselinePath, 'utf-8'));
    }
    catch {
        return null;
    }
}
/**
 * Compare a list of current findings against a baseline.
 * Returns each finding annotated with introduced:true/false.
 */
export function compareWithBaseline(currentFindings, baseline) {
    if (!baseline) {
        // No baseline — all findings are "introduced"
        return currentFindings.map(f => ({ ...f, introduced: true }));
    }
    // Primary: match by fingerprint (for baselines that have it)
    const baselineFingerprints = new Set(baseline.findings
        .filter(f => f.fingerprint)
        .map(f => f.fingerprint));
    // Fallback: match by key (for old baselines without fingerprint)
    const baselineKeys = new Set(baseline.findings.map(f => f.key));
    return currentFindings.map(f => {
        if (f.fingerprint && baselineFingerprints.size > 0) {
            return { ...f, introduced: !baselineFingerprints.has(f.fingerprint) };
        }
        return { ...f, introduced: !baselineKeys.has(f.key) };
    });
}
/**
 * Extract findings from the database to build a baseline.
 * Collects: isolated nodes (no edges), nodes with only INFERRED edges,
 * god nodes (degree > 50).
 */
export function extractFindingsFromDb(db, projectPath) {
    const findings = [];
    // Isolated nodes (no incoming or outgoing edges)
    const isolated = db.prepare(`
    SELECT n.id, n.name, n.file_path, n.label
    FROM nodes n
    WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)
    AND n.label IN ('Function', 'Class', 'Method', 'Interface', 'Variable', 'Module', 'File')
    LIMIT 500
  `).all();
    for (const n of isolated) {
        findings.push({
            key: `isolated:${n.file_path ?? n.id}:${n.name}`,
            type: 'isolated_node',
            nodeId: n.id,
            nodeName: n.name,
            filePath: n.file_path,
            savedAt: new Date().toISOString(),
            fingerprint: fingerprintFinding('isolated_node', n.file_path ?? '', n.id),
        });
    }
    // God nodes (degree > 50)
    const gods = db.prepare(`
    SELECT n.id, n.name, n.file_path,
           COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) as degree
    FROM nodes n
    LEFT JOIN edges e1 ON e1.source_id = n.id
    LEFT JOIN edges e2 ON e2.target_id = n.id
    GROUP BY n.id
    HAVING degree > 50
    ORDER BY degree DESC
    LIMIT 100
  `).all();
    for (const n of gods) {
        findings.push({
            key: `god_node:${n.file_path ?? n.id}:${n.name}`,
            type: 'god_node',
            nodeId: n.id,
            nodeName: n.name,
            filePath: n.file_path,
            savedAt: new Date().toISOString(),
            fingerprint: fingerprintFinding('god_node', n.file_path ?? '', n.id),
        });
    }
    // Surprise edges: non-EXTRACTED confidence (cross-community low-confidence edges)
    const surprises = db.prepare(`
    SELECT DISTINCT e.id as edge_id, e.source_id, e.target_id, e.confidence,
           n.name as src_name, n.file_path as src_file
    FROM edges e
    JOIN nodes n ON n.id = e.source_id
    WHERE e.confidence != 'EXTRACTED'
    LIMIT 200
  `).all();
    for (const e of surprises) {
        findings.push({
            key: `surprise:${e.source_id}:${e.target_id}`,
            type: 'surprise',
            nodeId: e.source_id,
            nodeName: e.src_name,
            filePath: e.src_file,
            savedAt: new Date().toISOString(),
            fingerprint: fingerprintFinding('surprise', e.source_id, e.target_id),
        });
    }
    // Bridge nodes: nodes whose edges span more than one community_id
    const bridges = db.prepare(`
    SELECT n.id, n.name, n.file_path
    FROM nodes n
    WHERE n.community_id IS NOT NULL
    AND (
      SELECT COUNT(DISTINCT n_tgt.community_id)
      FROM edges e_out
      JOIN nodes n_tgt ON n_tgt.id = e_out.target_id
      WHERE e_out.source_id = n.id AND n_tgt.community_id != n.community_id
    ) +
    (
      SELECT COUNT(DISTINCT n_src.community_id)
      FROM edges e_in
      JOIN nodes n_src ON n_src.id = e_in.source_id
      WHERE e_in.target_id = n.id AND n_src.community_id != n.community_id
    ) >= 2
    LIMIT 100
  `).all();
    for (const n of bridges) {
        findings.push({
            key: `bridge_node:${n.file_path ?? n.id}:${n.name}`,
            type: 'bridge_node',
            nodeId: n.id,
            nodeName: n.name,
            filePath: n.file_path,
            savedAt: new Date().toISOString(),
            fingerprint: fingerprintFinding('bridge_node', n.file_path ?? '', n.id),
        });
    }
    // Unreachable exports: exported nodes with no incoming edges
    const unreachableExports = db.prepare(`
    SELECT n.id, n.name, n.file_path
    FROM nodes n
    WHERE n.is_exported = 1
    AND n.label IN ('Function', 'Class', 'Method', 'Interface', 'Variable')
    AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.target_id = n.id)
    LIMIT 300
  `).all();
    for (const n of unreachableExports) {
        findings.push({
            key: `unreachable_export:${n.file_path ?? n.id}:${n.name}`,
            type: 'unreachable_export',
            nodeId: n.id,
            nodeName: n.name,
            filePath: n.file_path,
            savedAt: new Date().toISOString(),
            fingerprint: fingerprintFinding('unreachable_export', n.file_path ?? '', n.id),
        });
    }
    // Ambiguous edges: edges with AMBIGUOUS confidence
    const ambiguousEdges = db.prepare(`
    SELECT DISTINCT e.id as edge_id, e.source_id, e.target_id,
           n.name as src_name, n.file_path as src_file
    FROM edges e
    JOIN nodes n ON n.id = e.source_id
    WHERE e.confidence = 'AMBIGUOUS'
    LIMIT 200
  `).all();
    for (const e of ambiguousEdges) {
        findings.push({
            key: `ambiguous_edge:${e.source_id}:${e.target_id}`,
            type: 'ambiguous_edge',
            nodeId: e.source_id,
            nodeName: e.src_name,
            filePath: e.src_file,
            savedAt: new Date().toISOString(),
            fingerprint: fingerprintFinding('ambiguous_edge', e.source_id, e.target_id),
        });
    }
    return findings;
}
/**
 * Default baseline path relative to a project directory.
 * If a name is provided, the file is saved as `baseline-{name}.json`.
 */
export function defaultBaselinePath(projectDir, name) {
    const filename = name ? `baseline-${name}.json` : 'baseline.json';
    return join(projectDir, '.monomind', filename);
}
/**
 * Domain-aware polarity for each metric.
 * true  = higher value is better (improving)
 * false = lower value is better (improving)
 */
const METRIC_HIGHER_IS_BETTER = {
    nodeCount: true,
    edgeCount: false, // neutral; treated as stable unless large change
    communityCount: true,
    godNodeCount: false,
    surpriseCount: false,
    hotspotCount: false,
    unreachableNodeCount: false,
};
function trendDirection(metric, delta) {
    if (delta === 0)
        return { direction: 'stable', symbol: '→' };
    // edgeCount is neutral — always stable regardless of direction
    if (metric === 'edgeCount')
        return { direction: 'stable', symbol: '→' };
    const higherIsBetter = METRIC_HIGHER_IS_BETTER[metric] ?? true;
    if (delta > 0) {
        return higherIsBetter
            ? { direction: 'improving', symbol: '↑' }
            : { direction: 'declining', symbol: '↑' };
    }
    // delta < 0
    return higherIsBetter
        ? { direction: 'declining', symbol: '↓' }
        : { direction: 'improving', symbol: '↓' };
}
/**
 * Compute a trend report by comparing two BaselineData snapshots.
 * Each baseline must carry BaselineVitals fields (nodeCount, edgeCount, …).
 */
export function computeTrend(before, after) {
    const metricKeys = [
        'nodeCount',
        'edgeCount',
        'communityCount',
        'godNodeCount',
        'surpriseCount',
        'hotspotCount',
        'unreachableNodeCount',
    ];
    const metrics = [];
    for (const key of metricKeys) {
        const prev = before[key] ?? 0;
        const curr = after[key] ?? 0;
        const delta = curr - prev;
        const { direction, symbol } = trendDirection(key, delta);
        metrics.push({ metric: key, previous: prev, current: curr, delta, direction, symbol });
    }
    // Overall direction: majority vote (improving/declining/stable)
    const counts = { improving: 0, declining: 0, stable: 0 };
    for (const m of metrics)
        counts[m.direction]++;
    let overallDirection = 'stable';
    if (counts.improving > counts.declining && counts.improving > counts.stable) {
        overallDirection = 'improving';
    }
    else if (counts.declining > counts.improving && counts.declining > counts.stable) {
        overallDirection = 'declining';
    }
    return { metrics, overallDirection };
}
//# sourceMappingURL=baseline.js.map