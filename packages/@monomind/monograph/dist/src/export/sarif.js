import { createHash } from 'crypto';
import { relative } from 'path';
const SARIF_RULES = [
    {
        id: 'monograph/god-node',
        name: 'GodNode',
        shortDescription: { text: 'High-centrality node (god node) exceeds fan-in threshold' },
        fullDescription: { text: 'A file or module has an unusually high number of incoming dependencies, making it a central point of coupling. Consider splitting this module into smaller, more focused units.' },
        helpUri: 'https://github.com/nokhodian/monomind/blob/main/docs/rules/god-node.md',
    },
    {
        id: 'monograph/unreachable-file',
        name: 'UnreachableFile',
        shortDescription: { text: 'File node unreachable from any entry point' },
        fullDescription: { text: 'A file is not reachable from any known entry point. It may be dead code that can be safely removed.' },
        helpUri: 'https://github.com/nokhodian/monomind/blob/main/docs/rules/unreachable-file.md',
    },
    {
        id: 'monograph/circular-import',
        name: 'CircularImport',
        shortDescription: { text: 'Circular import detected' },
        fullDescription: { text: 'A circular import chain was detected between files. Circular imports can cause initialization order issues and make the codebase harder to understand.' },
        helpUri: 'https://github.com/nokhodian/monomind/blob/main/docs/rules/circular-import.md',
    },
    {
        id: 'monograph/bridge-node',
        name: 'BridgeNode',
        shortDescription: { text: 'Bridge node — high cross-community coupling' },
        fullDescription: { text: 'A file acts as a bridge between multiple community clusters, creating high cross-community coupling. This may indicate architectural boundaries are not being respected.' },
        helpUri: 'https://github.com/nokhodian/monomind/blob/main/docs/rules/bridge-node.md',
    },
    {
        id: 'monograph/hotspot',
        name: 'Hotspot',
        shortDescription: { text: 'File is both frequently changed and highly connected' },
        fullDescription: { text: 'A file is both a churn hotspot (frequently modified) and highly connected in the dependency graph. Changes here have wide blast radius and high risk of regression.' },
        helpUri: 'https://github.com/nokhodian/monomind/blob/main/docs/rules/hotspot.md',
    },
];
// Map ruleId to SARIF level
const RULE_LEVELS = {
    'monograph/god-node': 'warning',
    'monograph/unreachable-file': 'note',
    'monograph/circular-import': 'error',
    'monograph/bridge-node': 'warning',
    'monograph/hotspot': 'warning',
};
function fingerprint(ruleId, filePath) {
    return createHash('sha256').update(`${ruleId}:${filePath}`).digest('hex');
}
function toFileUri(repoRoot, filePath) {
    const rel = relative(repoRoot, filePath);
    return `file:///${rel.replace(/\\/g, '/')}`;
}
function makeResult(ruleId, message, filePath, startLine, repoRoot) {
    const result = {
        ruleId,
        level: RULE_LEVELS[ruleId] ?? 'warning',
        message: { text: message },
        locations: [
            {
                physicalLocation: {
                    artifactLocation: { uri: toFileUri(repoRoot, filePath) },
                    ...(startLine != null ? { region: { startLine } } : {}),
                },
            },
        ],
        fingerprints: { 'monograph/v1': fingerprint(ruleId, filePath) },
    };
    return result;
}
export function exportSarif(db, repoRoot) {
    const results = [];
    // ── God nodes (top 10% by fan-in) ────────────────────────────────────────────
    const totalNodes = db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE label = 'File'`).get().c;
    const top10pct = Math.max(1, Math.floor(totalNodes * 0.1));
    const godNodes = db.prepare(`
    SELECT n.id, n.name, n.file_path, n.start_line,
           COUNT(e.id) AS in_degree
    FROM nodes n
    LEFT JOIN edges e ON e.target_id = n.id
    WHERE n.file_path IS NOT NULL AND n.label = 'File'
    GROUP BY n.id
    ORDER BY in_degree DESC
    LIMIT ?
  `).all(top10pct);
    for (const row of godNodes) {
        if (row.in_degree === 0)
            continue;
        results.push(makeResult('monograph/god-node', `God node: "${row.name}" has ${row.in_degree} incoming dependencies (fan-in).`, row.file_path, row.start_line, repoRoot));
    }
    // ── Unreachable files ─────────────────────────────────────────────────────────
    const unreachable = db.prepare(`
    SELECT id, name, file_path FROM nodes
    WHERE label = 'File'
    AND (
      json_extract(properties, '$.reachabilityRole') = 'unreachable'
      OR properties LIKE '%"unreachable"%'
    )
    AND file_path IS NOT NULL
  `).all();
    for (const row of unreachable) {
        results.push(makeResult('monograph/unreachable-file', `Unreachable file: "${row.name}" is not reachable from any entry point.`, row.file_path, null, repoRoot));
    }
    // ── Hotspots (churnScore > 0.5) ───────────────────────────────────────────────
    const hotspots = db.prepare(`
    SELECT id, name, file_path, start_line
    FROM nodes
    WHERE file_path IS NOT NULL
    AND json_extract(properties, '$.churnScore') > 0.5
  `).all();
    for (const row of hotspots) {
        results.push(makeResult('monograph/hotspot', `Hotspot: "${row.name}" has high churn score (>0.5) and is highly connected.`, row.file_path, row.start_line, repoRoot));
    }
    return {
        $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
        version: '2.1.0',
        runs: [
            {
                tool: {
                    driver: {
                        name: 'monograph',
                        version: '1.1.0',
                        rules: SARIF_RULES,
                    },
                },
                results,
            },
        ],
    };
}
export function exportHealthSarif(findings, root) {
    const rules = [
        { id: 'complexity/cyclomatic', name: 'High Cyclomatic Complexity', shortDescription: { text: 'Function exceeds cyclomatic complexity threshold' }, fullDescription: { text: 'Cyclomatic complexity indicates the number of linearly independent paths through a function.' } },
        { id: 'complexity/cognitive', name: 'High Cognitive Complexity', shortDescription: { text: 'Function exceeds cognitive complexity threshold' }, fullDescription: { text: 'Cognitive complexity measures how difficult a function is to understand.' } },
        { id: 'complexity/crap', name: 'High CRAP Score', shortDescription: { text: 'Function has a high CRAP score due to complexity and low coverage' }, fullDescription: { text: 'CRAP = cyclomatic^2 * (1 - coverage/100)^3 + cyclomatic' } },
    ];
    const results = findings.map(f => ({
        ruleId: f.ruleId,
        message: { text: f.message },
        level: f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'note',
        locations: [{
                physicalLocation: {
                    artifactLocation: { uri: root ? f.filePath.replace(root, '').replace(/^\//, '') : f.filePath },
                    region: { startLine: f.startLine, endLine: f.endLine },
                },
            }],
    }));
    return {
        $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
        version: '2.1.0',
        runs: [{ tool: { driver: { name: 'monograph-health', version: '1.0.0', rules } }, results }],
    };
}
//# sourceMappingURL=sarif.js.map