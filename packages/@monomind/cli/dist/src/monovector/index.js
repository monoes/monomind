/**
 * MonoVector Integration Module for Monomind CLI (lean)
 *
 * After the SONA / native / WASM teardown this module provides:
 * - Initialization state: createInitState()
 * - Keyword-based task routing: createKeywordRouter()
 * - Route recommendation→outcome records: recordRoute(), joinOutcome(), accuracy
 * - AST diff classification: DiffClassifier
 *
 * @module @monomind/cli/monovector
 */
export { createInitState } from './init-state.js';
export { recordRoute, joinOutcome, joinLatestUnresolved, readOutcomes, computeRoutingAccuracy, computeAdherence, } from './route-outcomes.js';
export { DiffClassifier, createDiffClassifier, analyzeDiff, analyzeDiffSync, assessFileRisk, assessOverallRisk, classifyDiff, suggestReviewers, getGitDiffNumstat, getGitDiffNumstatAsync, clearDiffCache, clearAllDiffCaches, } from './diff-classifier.js';
export function createKeywordRouter(_config) {
    const agentTypes = ['coder', 'tester', 'reviewer', 'architect', 'researcher', 'optimizer', 'debugger', 'documenter'];
    return {
        async route(task) {
            const lower = task.toLowerCase();
            let agentType = 'coder';
            if (lower.includes('test'))
                agentType = 'tester';
            else if (lower.includes('review') || lower.includes('security'))
                agentType = 'reviewer';
            else if (lower.includes('design') || lower.includes('architect'))
                agentType = 'architect';
            else if (lower.includes('research') || lower.includes('analyz'))
                agentType = 'researcher';
            else if (lower.includes('optim') || lower.includes('perform'))
                agentType = 'optimizer';
            else if (lower.includes('debug') || lower.includes('fix') || lower.includes('bug'))
                agentType = 'debugger';
            else if (lower.includes('doc'))
                agentType = 'documenter';
            return {
                agentType,
                confidence: 0.75,
                reasoning: 'keyword-based routing',
                route: agentType,
                qValues: [],
                explored: false,
                alternatives: agentTypes.filter(a => a !== agentType).slice(0, 3).map(a => ({ route: a, score: 0 })),
            };
        },
        async initialize() { },
        getStats() {
            return { updateCount: 0, qTableSize: 0, stepCount: 0, epsilon: 0, avgTDError: 0, useNative: 0 };
        },
        update() { return 0; },
        reset() { },
        export() { return {}; },
        import() { },
    };
}
//# sourceMappingURL=index.js.map