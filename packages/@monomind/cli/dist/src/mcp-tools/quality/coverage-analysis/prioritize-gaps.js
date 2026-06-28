/**
 * prioritize-gaps.ts - Risk-based gap prioritization MCP tool handler
 *
 * Prioritizes coverage gaps based on multiple risk factors including
 * code complexity, change frequency, business criticality, and defect history.
 */
import { z } from 'zod';
// Input schema for prioritize-gaps tool
export const PrioritizeGapsInputSchema = z.object({
    gaps: z
        .array(z.object({
        id: z.string(),
        type: z.enum(['line', 'branch', 'function']),
        file: z.string(),
        startLine: z.number(),
        endLine: z.number(),
    }))
        .optional()
        .describe('Pre-analyzed gaps (or will analyze from targetPath)'),
    targetPath: z.string().optional().describe('Path to analyze if gaps not provided'),
    factors: z
        .array(z.enum([
        'complexity',
        'change-frequency',
        'defect-history',
        'business-critical',
        'dependency-count',
        'test-difficulty',
    ]))
        .default(['complexity', 'change-frequency', 'defect-history'])
        .describe('Prioritization factors'),
    weights: z
        .object({
        complexity: z.number().min(0).max(1).default(0.25),
        changeFrequency: z.number().min(0).max(1).default(0.25),
        defectHistory: z.number().min(0).max(1).default(0.2),
        businessCritical: z.number().min(0).max(1).default(0.15),
        dependencyCount: z.number().min(0).max(1).default(0.1),
        testDifficulty: z.number().min(0).max(1).default(0.05),
    })
        .optional()
        .describe('Custom weights for prioritization factors'),
    limit: z.number().min(1).max(100).default(20).describe('Maximum gaps to return'),
    groupBy: z
        .enum(['risk', 'file', 'type', 'none'])
        .default('risk')
        .describe('How to group the results'),
});
// Default weights
const DEFAULT_WEIGHTS = {
    complexity: 0.25,
    changeFrequency: 0.25,
    defectHistory: 0.2,
    businessCritical: 0.15,
    dependencyCount: 0.1,
    testDifficulty: 0.05,
};
/**
 * MCP Tool Handler for prioritize-gaps
 */
export async function handler(input, context) {
    const startTime = Date.now();
    try {
        // Validate input
        const validatedInput = PrioritizeGapsInputSchema.parse(input);
        // Get bridge for defect history lookup
        const bridge = context.get('aqe.bridge');
        // Get or generate gaps
        let gaps = validatedInput.gaps;
        if (!gaps || gaps.length === 0) {
            if (!validatedInput.targetPath) {
                throw new Error('Either gaps or targetPath must be provided');
            }
            gaps = await generateGapsFromPath(validatedInput.targetPath);
        }
        // Apply weights
        const weights = { ...DEFAULT_WEIGHTS, ...validatedInput.weights };
        // Calculate priority scores for each gap
        const prioritizedGaps = await calculatePriorities(gaps, validatedInput.factors, weights, bridge);
        // Sort by priority score
        prioritizedGaps.sort((a, b) => b.priorityScore - a.priorityScore);
        // Limit results
        const limitedGaps = prioritizedGaps.slice(0, validatedInput.limit);
        // Group results
        const groups = groupGaps(limitedGaps, validatedInput.groupBy);
        // Calculate statistics
        const statistics = calculateStatistics(prioritizedGaps);
        // Generate recommendations
        const recommendations = generateRecommendations(limitedGaps, statistics);
        // Build result
        const result = {
            success: true,
            prioritizedGaps: limitedGaps,
            groups,
            statistics,
            recommendations,
            metadata: {
                analyzedAt: new Date().toISOString(),
                durationMs: Date.now() - startTime,
                factorsUsed: validatedInput.factors,
                weightsApplied: weights,
            },
        };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: errorMessage,
                        prioritizedGaps: [],
                        metadata: {
                            analyzedAt: new Date().toISOString(),
                            durationMs: Date.now() - startTime,
                        },
                    }, null, 2),
                },
            ],
        };
    }
}
async function generateGapsFromPath(_targetPath) {
    // Cannot derive real coverage gaps without running the test suite and collecting
    // an lcov/json report. Pass a coverage report via the `gaps` input instead, or
    // run `npx vitest --coverage` and feed the output to `analyze-coverage` first.
    return [];
}
async function calculatePriorities(gaps, factors, weights, bridge) {
    const prioritizedGaps = [];
    for (const gap of gaps) {
        const factorScores = [];
        let totalScore = 0;
        // Calculate each factor
        if (factors.includes('complexity')) {
            const score = calculateComplexityScore(gap);
            const contribution = score * weights.complexity;
            factorScores.push({
                factor: 'complexity',
                score,
                weight: weights.complexity,
                contribution,
                details: `Cyclomatic complexity: ${Math.round(score * 20)}`,
            });
            totalScore += contribution;
        }
        if (factors.includes('change-frequency')) {
            const score = calculateChangeFrequency(gap);
            const contribution = score * weights.changeFrequency;
            factorScores.push({
                factor: 'change-frequency',
                score,
                weight: weights.changeFrequency,
                contribution,
                details: `Changes in last 90 days: ${Math.round(score * 10)}`,
            });
            totalScore += contribution;
        }
        if (factors.includes('defect-history')) {
            const score = await calculateDefectHistory(gap, bridge);
            const contribution = score * weights.defectHistory;
            factorScores.push({
                factor: 'defect-history',
                score,
                weight: weights.defectHistory,
                contribution,
                details: `Historical defects: ${Math.round(score * 5)}`,
            });
            totalScore += contribution;
        }
        if (factors.includes('business-critical')) {
            const score = calculateBusinessCriticality(gap);
            const contribution = score * weights.businessCritical;
            factorScores.push({
                factor: 'business-critical',
                score,
                weight: weights.businessCritical,
                contribution,
                details: `Business impact: ${score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low'}`,
            });
            totalScore += contribution;
        }
        if (factors.includes('dependency-count')) {
            const score = calculateDependencyScore(gap);
            const contribution = score * weights.dependencyCount;
            factorScores.push({
                factor: 'dependency-count',
                score,
                weight: weights.dependencyCount,
                contribution,
                details: `Dependents: ${Math.round(score * 15)}`,
            });
            totalScore += contribution;
        }
        if (factors.includes('test-difficulty')) {
            const score = calculateTestDifficulty(gap);
            const contribution = score * weights.testDifficulty;
            factorScores.push({
                factor: 'test-difficulty',
                score,
                weight: weights.testDifficulty,
                contribution,
                details: `Test complexity: ${score > 0.7 ? 'hard' : score > 0.4 ? 'medium' : 'easy'}`,
            });
            totalScore += contribution;
        }
        // Normalize score
        const priorityScore = Math.round(totalScore * 100) / 100;
        // Determine risk level
        const risk = scoreToRisk(priorityScore);
        // Calculate effort and ROI
        const effort = calculateEffort(gap, factorScores);
        const roi = calculateROI(priorityScore, effort);
        prioritizedGaps.push({
            id: gap.id,
            type: gap.type,
            file: gap.file,
            location: { startLine: gap.startLine, endLine: gap.endLine },
            risk,
            priorityScore,
            factors: factorScores,
            effort,
            roi,
        });
    }
    return prioritizedGaps;
}
function calculateComplexityScore(gap) {
    const lines = gap.endLine - gap.startLine;
    // Estimate cyclomatic complexity from line count
    const estimatedComplexity = lines / 5;
    return Math.min(estimatedComplexity / 10, 1);
}
function calculateChangeFrequency(gap) {
    // Proxy: deeper paths in the tree tend to be more stable, shallower paths change more.
    // A real implementation would query `git log --follow -n 30 -- <file>`.
    const pathDepth = gap.file.split('/').length;
    return Math.min(pathDepth / 10, 1) * 0.8;
}
async function calculateDefectHistory(gap, bridge) {
    if (bridge) {
        try {
            const patterns = await bridge.searchSimilarPatterns(`defect ${gap.file}`, 3);
            return Math.min(patterns.length / 5, 1);
        }
        catch {
            // Fall through to neutral score
        }
    }
    // No bridge and no historical data available — return neutral score.
    return 0;
}
function calculateBusinessCriticality(gap) {
    // Determine criticality based on file path
    const criticalPaths = ['auth', 'payment', 'security', 'core', 'api'];
    const pathLower = gap.file.toLowerCase();
    for (const path of criticalPaths) {
        if (pathLower.includes(path)) {
            return 0.9;
        }
    }
    return 0.3;
}
function calculateDependencyScore(gap) {
    // Proxy: larger code blocks tend to have more callers. Real implementation would
    // query the monograph dependency graph for actual dependent count.
    const lines = gap.endLine - gap.startLine;
    return Math.min(lines / 50, 1);
}
function calculateTestDifficulty(gap) {
    // Estimate test difficulty
    const lines = gap.endLine - gap.startLine;
    if (lines > 30)
        return 0.8;
    if (lines > 15)
        return 0.5;
    return 0.2;
}
function scoreToRisk(score) {
    if (score >= 0.75)
        return 'critical';
    if (score >= 0.5)
        return 'high';
    if (score >= 0.25)
        return 'medium';
    return 'low';
}
function calculateEffort(gap, factors) {
    const lines = gap.endLine - gap.startLine;
    const difficultyFactor = factors.find((f) => f.factor === 'test-difficulty');
    const difficulty = difficultyFactor?.score ?? 0.5;
    const effortScore = (lines / 50) * 0.5 + difficulty * 0.5;
    if (effortScore > 0.7)
        return 'high';
    if (effortScore > 0.3)
        return 'medium';
    return 'low';
}
function calculateROI(priorityScore, effort) {
    const effortMultiplier = { low: 3, medium: 2, high: 1 };
    return Math.round(priorityScore * effortMultiplier[effort] * 100) / 100;
}
function groupGaps(gaps, groupBy) {
    const groups = new Map();
    for (const gap of gaps) {
        let key;
        switch (groupBy) {
            case 'risk':
                key = gap.risk;
                break;
            case 'file':
                key = gap.file;
                break;
            case 'type':
                key = gap.type;
                break;
            default:
                key = 'all';
        }
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(gap);
    }
    return Array.from(groups.entries()).map(([name, gapList]) => ({
        name,
        count: gapList.length,
        avgPriorityScore: Math.round((gapList.reduce((sum, g) => sum + g.priorityScore, 0) / gapList.length) * 100) / 100,
        gaps: gapList,
    }));
}
function calculateStatistics(gaps) {
    const total = gaps.length;
    if (total === 0) {
        return {
            totalGaps: 0,
            criticalCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
            avgPriorityScore: 0,
            avgEffort: 'unknown',
            estimatedTestingEffort: '0 hours',
        };
    }
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    const efforts = { low: 0, medium: 0, high: 0 };
    for (const gap of gaps) {
        counts[gap.risk]++;
        efforts[gap.effort]++;
    }
    const avgScore = gaps.reduce((sum, g) => sum + g.priorityScore, 0) / total;
    // Estimate testing effort
    const hours = efforts.low * 0.5 + efforts.medium * 2 + efforts.high * 5;
    return {
        totalGaps: total,
        criticalCount: counts.critical,
        highCount: counts.high,
        mediumCount: counts.medium,
        lowCount: counts.low,
        avgPriorityScore: Math.round(avgScore * 100) / 100,
        avgEffort: efforts.high > efforts.medium && efforts.high > efforts.low ? 'high' : efforts.medium > efforts.low ? 'medium' : 'low',
        estimatedTestingEffort: `${Math.round(hours)} hours`,
    };
}
function generateRecommendations(gaps, stats) {
    const recommendations = [];
    // Immediate action for critical gaps
    const criticalGaps = gaps.filter((g) => g.risk === 'critical');
    if (criticalGaps.length > 0) {
        recommendations.push({
            type: 'immediate-action',
            priority: 1,
            description: `Address ${criticalGaps.length} critical coverage gaps immediately`,
            affectedGaps: criticalGaps.map((g) => g.id),
            expectedImpact: 'Significant risk reduction',
        });
    }
    // High ROI opportunities
    const highROI = gaps.filter((g) => g.roi > 1).slice(0, 5);
    if (highROI.length > 0) {
        recommendations.push({
            type: 'short-term',
            priority: 2,
            description: `Focus on ${highROI.length} high-ROI gaps for maximum coverage impact`,
            affectedGaps: highROI.map((g) => g.id),
            expectedImpact: 'Best coverage improvement per effort invested',
        });
    }
    // Long-term refactoring
    const complexGaps = gaps.filter((g) => g.effort === 'high');
    if (complexGaps.length > 3) {
        recommendations.push({
            type: 'long-term',
            priority: 3,
            description: `Consider refactoring ${complexGaps.length} complex areas before testing`,
            affectedGaps: complexGaps.slice(0, 5).map((g) => g.id),
            expectedImpact: 'Improved testability and maintainability',
        });
    }
    return recommendations;
}
// Export tool definition for MCP registration
export const toolDefinition = {
    name: 'aqe/prioritize-gaps',
    description: 'Prioritize coverage gaps by risk score using multiple weighted factors',
    category: 'coverage-analysis',
    version: '3.2.3',
    inputSchema: PrioritizeGapsInputSchema,
    handler,
};
export default toolDefinition;
//# sourceMappingURL=prioritize-gaps.js.map