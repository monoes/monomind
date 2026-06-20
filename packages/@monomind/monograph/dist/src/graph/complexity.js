/**
 * Compute CRAP score for a function.
 * Formula: CC² × (1 - coverage)³ + CC
 * where coverage is a 0-1 fraction (0 = no tests, 1 = fully covered).
 */
export function computeCrapScore(cc, coverage) {
    const cov = Math.max(0, Math.min(1, coverage));
    return cc * cc * Math.pow(1 - cov, 3) + cc;
}
function percentile(arr, p) {
    if (arr.length === 0)
        return 0;
    const idx = Math.floor((p / 100) * (arr.length - 1));
    return arr[idx];
}
/**
 * Compute cyclomatic and cognitive complexity for all Function/Method nodes
 * in the knowledge graph. Uses graph degree as a proxy for decision points
 * since AST is not available at this layer.
 *
 * - Cyclomatic complexity proxy: outgoing CALLS × 0.5 + outgoing ACCESSES × 0.2 + 1
 * - Cognitive complexity proxy: (endLine - startLine) / 10, capped at 20
 * - LOC: endLine - startLine + 1 (or 1 if missing)
 * - CRAP: computed with coverage = 0 (worst-case, no test data available)
 *
 * Batches all SQL work to avoid N+1 queries (2 GROUP BY queries replace 2×N individual queries).
 */
export function computeComplexity(db) {
    // Fetch all function/method nodes in one query
    const rows = db.prepare(`
    SELECT id, name, file_path, start_line, end_line, properties
    FROM nodes
    WHERE label IN ('Function', 'Method')
  `).all();
    if (rows.length === 0) {
        return { functions: [], p50cc: 0, p90cc: 0, p95cc: 0, highComplexityCount: 0, criticalCount: 0 };
    }
    // ── Batch edge counts: 2 GROUP BY queries replace 2×N individual queries ─
    const callsMap = new Map();
    for (const { source_id, c } of db.prepare(`
    SELECT source_id, COUNT(*) as c FROM edges WHERE relation = 'CALLS' GROUP BY source_id
  `).all()) {
        callsMap.set(source_id, c);
    }
    const accessesMap = new Map();
    for (const { source_id, c } of db.prepare(`
    SELECT source_id, COUNT(*) as c FROM edges WHERE relation = 'ACCESSES' GROUP BY source_id
  `).all()) {
        accessesMap.set(source_id, c);
    }
    // ── Compute metrics for each function ────────────────────────────────────
    const functions = [];
    const propUpdates = [];
    for (const row of rows) {
        const props = row.properties ? JSON.parse(row.properties) : {};
        const callsCount = callsMap.get(row.id) ?? 0;
        const accessesCount = accessesMap.get(row.id) ?? 0;
        const cyclomaticComplexity = Math.round(callsCount * 0.5 + accessesCount * 0.2 + 1);
        const lineSpan = (row.start_line != null && row.end_line != null)
            ? row.end_line - row.start_line
            : 0;
        const cognitiveComplexity = Math.min(Math.round(lineSpan / 10), 20);
        const linesOfCode = (row.start_line != null && row.end_line != null)
            ? row.end_line - row.start_line + 1
            : 1;
        const paramCount = typeof props.paramCount === 'number' ? props.paramCount : 0;
        const crapScore = computeCrapScore(cyclomaticComplexity, 0);
        // Stage property update — batched in a single transaction below
        propUpdates.push({
            id: row.id,
            props: JSON.stringify({ ...props, cyclomaticComplexity, cognitiveComplexity, crapScore }),
        });
        functions.push({
            nodeId: row.id,
            name: row.name,
            filePath: row.file_path,
            startLine: row.start_line,
            endLine: row.end_line,
            cyclomaticComplexity,
            cognitiveComplexity,
            linesOfCode,
            paramCount,
            crapScore,
        });
    }
    // ── Batch UPDATE all property writes in one transaction ───────────────────
    const updateStmt = db.prepare('UPDATE nodes SET properties = ? WHERE id = ?');
    db.transaction((updates) => {
        for (const { id, props } of updates)
            updateStmt.run(props, id);
    })(propUpdates);
    // ── Compute percentiles ───────────────────────────────────────────────────
    const ccValues = functions.map(f => f.cyclomaticComplexity).sort((a, b) => a - b);
    return {
        functions,
        p50cc: percentile(ccValues, 50),
        p90cc: percentile(ccValues, 90),
        p95cc: percentile(ccValues, 95),
        highComplexityCount: functions.filter(f => f.cyclomaticComplexity > 10).length,
        criticalCount: functions.filter(f => f.cyclomaticComplexity > 20).length,
    };
}
/**
 * Format a ComplexityReport as structured text with file:line hints for LLM navigation.
 *
 * @param report - ComplexityReport from computeComplexity()
 * @param topN - number of worst offenders to list (default 10)
 * @returns structured text suitable for LLM consumption
 */
export function formatComplexity(report, topN = 10) {
    const { functions, p50cc, p90cc, p95cc, highComplexityCount, criticalCount } = report;
    if (functions.length === 0) {
        return 'complexity: no Function/Method nodes found in graph\n';
    }
    const lines = [
        `complexity: ${functions.length} functions analysed`,
        `  p50_cc: ${p50cc}  p90_cc: ${p90cc}  p95_cc: ${p95cc}`,
        `  high(cc>10): ${highComplexityCount}  critical(cc>20): ${criticalCount}`,
        '',
    ];
    // Sort by crapScore descending (worst first)
    const worst = [...functions]
        .sort((a, b) => b.crapScore - a.crapScore)
        .slice(0, topN);
    if (worst.length > 0) {
        lines.push(`top_${topN}_worst_crap:`);
        for (const fn of worst) {
            const loc = fn.filePath
                ? `${fn.filePath}:${fn.startLine ?? 1}`
                : `<unknown>:1`;
            lines.push(`  - ${fn.name}`);
            lines.push(`    file: ${loc}`);
            lines.push(`    cc: ${fn.cyclomaticComplexity}  crap: ${fn.crapScore.toFixed(1)}  loc: ${fn.linesOfCode}`);
        }
        lines.push('');
    }
    const critical = functions.filter(f => f.cyclomaticComplexity > 20);
    if (critical.length > 0) {
        lines.push(`critical_functions(cc>20): ${critical.length}`);
        for (const fn of critical.slice(0, 5)) {
            const loc = fn.filePath ? `${fn.filePath}:${fn.startLine ?? 1}` : `<unknown>:1`;
            lines.push(`  - ${fn.name}  file: ${loc}  cc: ${fn.cyclomaticComplexity}`);
        }
        if (critical.length > 5)
            lines.push(`  ... and ${critical.length - 5} more`);
        lines.push('');
    }
    return lines.join('\n');
}
//# sourceMappingURL=complexity.js.map