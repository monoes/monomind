export function computeRefactoringTargets(db) {
    // Query all File nodes with degree counts and properties
    const rows = db.prepare(`
    SELECT
      n.id,
      n.file_path,
      n.properties,
      COUNT(DISTINCT e_in.id) as in_degree,
      COUNT(DISTINCT e_out.id) as out_degree
    FROM nodes n
    LEFT JOIN edges e_in ON e_in.target_id = n.id
    LEFT JOIN edges e_out ON e_out.source_id = n.id
    WHERE n.label = 'File' AND n.file_path IS NOT NULL
    GROUP BY n.id
  `).all();
    if (rows.length === 0) {
        return { targets: [], totalAnalyzed: 0 };
    }
    // Compute fan-ins for percentile calculation
    const fanIns = rows.map(r => r.in_degree).sort((a, b) => a - b);
    const p95Index = Math.floor(fanIns.length * 0.95);
    const p95FanIn = fanIns[p95Index] ?? fanIns[fanIns.length - 1] ?? 1;
    const maxInDegree = rows.reduce((m, r) => r.in_degree > m ? r.in_degree : m, 1);
    const maxOutDegree = rows.reduce((m, r) => r.out_degree > m ? r.out_degree : m, 1);
    const targets = [];
    for (const row of rows) {
        const props = row.properties ? JSON.parse(row.properties) : {};
        const reachabilityRole = props.reachabilityRole ?? '';
        const churnScore = typeof props.churnScore === 'number' ? props.churnScore : 0;
        // Component scores
        const density = p95FanIn > 0 ? row.in_degree / p95FanIn : 1.0;
        const hotspot_boost = Math.min(1.0, churnScore);
        const dead_code = reachabilityRole === 'unreachable' ? 1.0 : 0;
        const fan_in_norm = row.in_degree / maxInDegree;
        const fan_out_norm = row.out_degree / maxOutDegree;
        // Priority formula
        const priorityScore = Math.min(100, density * 30 +
            hotspot_boost * 25 +
            dead_code * 20 +
            fan_in_norm * 15 +
            fan_out_norm * 10);
        // Evidence strings
        const evidence = [];
        if (dead_code === 1.0)
            evidence.push('unreachable');
        if (density > 0.8)
            evidence.push(`fan-in: ${row.in_degree} (p95)`);
        if (hotspot_boost > 0.5)
            evidence.push(`churn score: ${churnScore.toFixed(2)}`);
        if (fan_in_norm > 0.7)
            evidence.push(`fan-in: ${row.in_degree} (high)`);
        if (fan_out_norm > 0.8)
            evidence.push(`fan-out: ${row.out_degree} (high)`);
        // Category selection
        let category;
        if (dead_code === 1.0) {
            category = 'RemoveDeadCode';
        }
        else if (density > 0.8 && hotspot_boost > 0.5) {
            category = 'UrgentChurnComplexity';
        }
        else if (fan_in_norm > 0.7) {
            category = 'SplitHighImpact';
        }
        else if (fan_out_norm > 0.8) {
            category = 'ExtractDependencies';
        }
        else {
            category = 'ExtractComplexFunctions';
        }
        // Count factors above threshold for confidence
        let factorCount = 0;
        if (dead_code === 1.0)
            factorCount++;
        if (density > 0.8)
            factorCount++;
        if (hotspot_boost > 0.5)
            factorCount++;
        if (fan_in_norm > 0.7)
            factorCount++;
        if (fan_out_norm > 0.8)
            factorCount++;
        const confidence = factorCount > 2 ? 'High' : factorCount === 2 ? 'Medium' : 'Low';
        // Effort
        let effort;
        let effortWeight;
        if (priorityScore < 33) {
            effort = 'Low';
            effortWeight = 1;
        }
        else if (priorityScore < 66) {
            effort = 'Medium';
            effortWeight = 2;
        }
        else {
            effort = 'High';
            effortWeight = 3;
        }
        const efficiency = effortWeight > 0 ? priorityScore / effortWeight : priorityScore;
        targets.push({
            nodeId: row.id,
            filePath: row.file_path,
            priorityScore,
            efficiency,
            category,
            effort,
            confidence,
            evidence,
        });
    }
    // Sort by efficiency descending, return top 50
    const sorted = targets
        .sort((a, b) => b.efficiency - a.efficiency)
        .slice(0, 50);
    return {
        targets: sorted,
        totalAnalyzed: rows.length,
    };
}
export const PRIORITY_RULE_WEIGHTS = {
    densityWeight: 30,
    hotspotWeight: 25,
    deadCodeWeight: 20,
    fanInWeight: 15,
    fanOutWeight: 10,
};
/** Normalize a raw metric value against a threshold to a 0-1 score. */
export function normalizeMetric(value, threshold) {
    if (threshold <= 0)
        return 0;
    return Math.min(value / threshold, 1);
}
/** Compute a 0-100 composite priority score for a refactoring target. */
export function computeTargetPriority(factors) {
    const { densityWeight, hotspotWeight, deadCodeWeight, fanInWeight, fanOutWeight } = PRIORITY_RULE_WEIGHTS;
    const fanIn = normalizeMetric(factors.fanInRaw, factors.fanInThreshold);
    const fanOut = normalizeMetric(factors.fanOutRaw, factors.fanOutThreshold);
    return Math.min(100, Math.round(factors.densityScore * densityWeight +
        factors.hotspotScore * hotspotWeight +
        factors.deadCodeScore * deadCodeWeight +
        fanIn * fanInWeight +
        fanOut * fanOutWeight));
}
/** Apply named priority rules in priority order, returning the first match's score or null. */
export function tryMatchPriorityRules(rules, factors) {
    for (const rule of [...rules].sort((a, b) => b.weight - a.weight)) {
        const score = rule.evaluate(factors);
        if (score !== null)
            return { rule, score };
    }
    return null;
}
//# sourceMappingURL=targets.js.map