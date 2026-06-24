/**
 * Hooks Embedding Utilities
 * Shared utility functions for hooks: embedding generation, memory access,
 * routing outcome persistence, agent suggestion, and risk assessment.
 * Extracted from hooks-tools.ts.
 */
/**
 * Hooks MCP Tools
 * Provides intelligent hooks functionality via MCP protocol
 */
import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { getProjectCwd } from './types.js';
// Base dir for per-route outcome records — sits alongside routing-outcomes.json
export function getRouteOutcomesBaseDir() {
    return join(getProjectCwd(), '.monomind');
}
// Real vector search functions - lazy loaded to avoid circular imports
let searchEntriesFn = null;
export async function getRealSearchFunction() {
    if (!searchEntriesFn) {
        try {
            const { searchEntries } = await import('../memory/memory-initializer.js');
            searchEntriesFn = searchEntries;
        }
        catch {
            searchEntriesFn = null;
        }
    }
    return searchEntriesFn;
}
// Real store function - lazy loaded
let storeEntryFn = null;
export async function getRealStoreFunction() {
    if (!storeEntryFn) {
        try {
            const { storeEntry } = await import('../memory/memory-initializer.js');
            storeEntryFn = storeEntry;
        }
        catch {
            storeEntryFn = null;
        }
    }
    return storeEntryFn;
}
// =============================================================================
// Neural Module Lazy Loaders (SONA, EWC++, MoE, LoRA, Flash Attention)
// =============================================================================
// SONA Optimizer - lazy loaded
let sonaOptimizer = null;
export async function getSONAOptimizer() {
    if (!sonaOptimizer) {
        try {
            const { getSONAOptimizer: getSona } = await import('../memory/sona-optimizer.js');
            sonaOptimizer = await getSona();
        }
        catch {
            sonaOptimizer = null;
        }
    }
    return sonaOptimizer;
}
// EWC++ Consolidator - lazy loaded
let ewcConsolidator = null;
export async function getEWCConsolidator() {
    if (!ewcConsolidator) {
        try {
            const { getEWCConsolidator: getEWC } = await import('../memory/ewc-consolidation.js');
            ewcConsolidator = await getEWC();
        }
        catch {
            ewcConsolidator = null;
        }
    }
    return ewcConsolidator;
}
export function generateSimpleEmbedding(text, dimension = 384) {
    // Simple deterministic embedding based on character codes
    // This is for routing purposes where we need consistent, fast embeddings
    const embedding = new Float32Array(dimension);
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const words = normalized.split(/\s+/).filter(w => w.length > 0);
    // Combine word-level and character-level features
    for (let i = 0; i < dimension; i++) {
        let value = 0;
        // Word-level features
        for (let w = 0; w < words.length; w++) {
            const word = words[w];
            for (let c = 0; c < word.length; c++) {
                const charCode = word.charCodeAt(c);
                value += Math.sin((charCode * (i + 1) + w * 17 + c * 23) * 0.0137);
            }
        }
        // Character-level features
        for (let c = 0; c < text.length; c++) {
            value += Math.cos((text.charCodeAt(c) * (i + 1) + c * 7) * 0.0073);
        }
        embedding[i] = value / Math.max(1, text.length);
    }
    // Normalize
    let norm = 0;
    for (let i = 0; i < dimension; i++) {
        norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < dimension; i++) {
            embedding[i] /= norm;
        }
    }
    return embedding;
}
// ── Runtime routing outcome persistence ──────────────────────────────
// Closes the learning loop: post-task records outcomes → route loads them.
// Evaluated lazily via getter so it uses runtime CWD, not import-time CWD
export function getRoutingOutcomesPath() {
    return join(getProjectCwd(), '.monomind', 'routing-outcomes.json');
}
export const ROUTING_STOPWORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once',
    'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
    'he', 'she', 'they', 'them', 'and', 'but', 'or', 'nor', 'not', 'no', 'so', 'if', 'when', 'than',
    'very', 'just', 'also', 'only', 'both', 'each', 'all', 'any', 'few', 'more', 'most', 'other',
    'some', 'such', 'same', 'new', 'now', 'here', 'there', 'where', 'how', 'what', 'which', 'who',
]);
export function extractKeywords(text) {
    if (!text)
        return [];
    return text.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !ROUTING_STOPWORDS.has(w));
}
export function loadRoutingOutcomes() {
    try {
        if (existsSync(getRoutingOutcomesPath())) {
            const data = JSON.parse(readFileSync(getRoutingOutcomesPath(), 'utf-8'));
            return data.outcomes || [];
        }
    }
    catch { /* corrupt file, start fresh */ }
    return [];
}
export function saveRoutingOutcomes(outcomes) {
    try {
        const dir = dirname(getRoutingOutcomesPath());
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        // Cap at 500 entries to bound file size
        const capped = outcomes.slice(-500);
        const tmp = getRoutingOutcomesPath() + '.tmp';
        writeFileSync(tmp, JSON.stringify({ outcomes: capped }, null, 2));
        renameSync(tmp, getRoutingOutcomesPath());
    }
    catch { /* non-critical */ }
}
/**
 * Build learned routing patterns from successful task outcomes.
 * Returns patterns in the same shape as TASK_PATTERNS so they can be
 * merged into both the native HNSW and pure-JS semantic routers.
 */
export function loadLearnedPatterns() {
    const outcomes = loadRoutingOutcomes();
    const byAgent = {};
    for (const o of outcomes) {
        if (!o.success || !o.agent || !o.keywords?.length)
            continue;
        if (!byAgent[o.agent])
            byAgent[o.agent] = new Set();
        for (const kw of o.keywords)
            byAgent[o.agent].add(kw);
    }
    const patterns = {};
    for (const [agent, kwSet] of Object.entries(byAgent)) {
        patterns[`learned-${agent}`] = {
            keywords: [...kwSet].slice(0, 50),
            agents: [agent],
        };
    }
    return patterns;
}
/**
 * Merge static TASK_PATTERNS with runtime-learned patterns.
 * Static patterns take precedence (learned patterns won't overwrite them).
 */
export function getMergedTaskPatterns() {
    const merged = { ...TASK_PATTERNS };
    const learned = loadLearnedPatterns();
    for (const [key, pattern] of Object.entries(learned)) {
        if (!merged[key]) {
            merged[key] = pattern;
        }
    }
    return merged;
}
// ── Static task patterns (used by both native and pure-JS routers) ───
export const TASK_PATTERNS = {
    'security-task': {
        keywords: ['authentication', 'security', 'auth', 'password', 'encryption', 'vulnerability', 'cve', 'audit'],
        agents: ['security-architect', 'security-auditor', 'reviewer'],
    },
    'testing-task': {
        keywords: ['test', 'testing', 'spec', 'coverage', 'unit test', 'integration test', 'e2e'],
        agents: ['tester', 'reviewer'],
    },
    'api-task': {
        keywords: ['api', 'endpoint', 'rest', 'graphql', 'route', 'handler', 'controller'],
        agents: ['architect', 'coder', 'tester'],
    },
    'performance-task': {
        keywords: ['performance', 'optimize', 'speed', 'memory', 'benchmark', 'profiling', 'bottleneck'],
        agents: ['performance-engineer', 'coder', 'tester'],
    },
    'refactor-task': {
        keywords: ['refactor', 'restructure', 'clean', 'organize', 'modular', 'decouple'],
        agents: ['architect', 'coder', 'reviewer'],
    },
    'bugfix-task': {
        keywords: ['bug', 'fix', 'error', 'issue', 'broken', 'crash', 'debug'],
        agents: ['coder', 'tester', 'reviewer'],
    },
    'feature-task': {
        keywords: ['feature', 'implement', 'add', 'new', 'create', 'build'],
        agents: ['architect', 'coder', 'tester'],
    },
    'database-task': {
        keywords: ['database', 'sql', 'query', 'schema', 'migration', 'orm'],
        agents: ['architect', 'coder', 'tester'],
    },
    'frontend-task': {
        keywords: ['frontend', 'ui', 'component', 'react', 'css', 'style', 'layout'],
        agents: ['coder', 'reviewer', 'tester'],
    },
    'devops-task': {
        keywords: ['deploy', 'ci', 'cd', 'pipeline', 'docker', 'kubernetes', 'infrastructure'],
        agents: ['devops', 'coder', 'tester'],
    },
    'swarm-task': {
        keywords: ['swarm', 'agent', 'coordinator', 'hive', 'mesh', 'topology'],
        agents: ['swarm-specialist', 'coordinator', 'architect'],
    },
    'memory-task': {
        keywords: ['memory', 'cache', 'store', 'vector', 'embedding', 'persistence'],
        agents: ['memory-specialist', 'architect', 'coder'],
    },
};
// In-memory trajectory tracking (persisted on end)
export const activeTrajectories = new Map();
export const MEMORY_DIR = '.monomind/memory';
export const MEMORY_FILE = 'store.json';
export function getMemoryPath() {
    return join(getProjectCwd(), MEMORY_DIR, MEMORY_FILE);
}
// Maximum size of the legacy JSON memory store before reads are skipped.
// Matches the guard in memory-tools.ts (loadLegacyStore) which loads the same file.
export const MAX_MEMORY_STORE_BYTES = 50 * 1024 * 1024; // 50 MB
export function loadMemoryStore() {
    try {
        const path = getMemoryPath();
        if (existsSync(path) && statSync(path).size <= MAX_MEMORY_STORE_BYTES) {
            const data = readFileSync(path, 'utf-8');
            return JSON.parse(data);
        }
    }
    catch {
        // Return empty store on error
    }
    return { entries: {}, version: '3.0.0' };
}
/**
 * Get real intelligence statistics from memory store
 */
export function getIntelligenceStatsFromMemory() {
    const store = loadMemoryStore();
    const entries = Object.values(store.entries);
    // Count trajectories (keys starting with "trajectory-" or containing trajectory data)
    const trajectoryEntries = entries.filter(e => e.key.includes('trajectory') ||
        (e.metadata?.type === 'trajectory'));
    const successfulTrajectories = trajectoryEntries.filter(e => e.metadata?.success === true ||
        (typeof e.value === 'object' && e.value !== null && e.value.success === true));
    // Count patterns
    const patternEntries = entries.filter(e => e.key.includes('pattern') ||
        e.metadata?.type === 'pattern' ||
        e.key.startsWith('learned-'));
    // Categorize patterns
    const categories = {};
    patternEntries.forEach(e => {
        const category = e.metadata?.category || 'general';
        categories[category] = (categories[category] || 0) + 1;
    });
    // Count routing decisions
    const routingEntries = entries.filter(e => e.key.includes('routing') ||
        e.metadata?.type === 'routing-decision');
    // Calculate average confidence from routing decisions
    let totalConfidence = 0;
    let confidenceCount = 0;
    routingEntries.forEach(e => {
        const confidence = e.metadata?.confidence;
        if (typeof confidence === 'number') {
            totalConfidence += confidence;
            confidenceCount++;
        }
    });
    // Calculate total access count
    const totalAccessCount = entries.reduce((sum, e) => sum + (e.accessCount || 0), 0);
    // Calculate memory file size
    let memorySizeBytes = 0;
    try {
        const memPath = getMemoryPath();
        if (existsSync(memPath)) {
            memorySizeBytes = statSync(memPath).size;
        }
    }
    catch {
        // Ignore
    }
    return {
        trajectories: {
            total: trajectoryEntries.length,
            successful: successfulTrajectories.length,
        },
        patterns: {
            learned: patternEntries.length,
            categories,
        },
        memory: {
            indexSize: entries.length,
            totalAccessCount,
            memorySizeBytes,
        },
        routing: {
            decisions: routingEntries.length,
            avgConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
        },
    };
}
// Agent routing configuration - maps file types to recommended agents
export const AGENT_PATTERNS = {
    '.ts': ['coder', 'architect', 'tester'],
    '.tsx': ['coder', 'architect', 'reviewer'],
    '.test.ts': ['tester', 'reviewer'],
    '.spec.ts': ['tester', 'reviewer'],
    '.md': ['researcher', 'documenter'],
    '.json': ['coder', 'architect'],
    '.yaml': ['coder', 'devops'],
    '.yml': ['coder', 'devops'],
    '.sh': ['devops', 'coder'],
    '.py': ['coder', 'ml-developer', 'researcher'],
    '.sql': ['coder', 'architect'],
    '.css': ['coder', 'designer'],
    '.scss': ['coder', 'designer'],
};
// Keyword patterns for fallback routing (when semantic routing doesn't match)
export const KEYWORD_PATTERNS = {
    'authentication': { agents: ['security-architect', 'coder', 'tester'], confidence: 0.9 },
    'auth': { agents: ['security-architect', 'coder', 'tester'], confidence: 0.85 },
    'api': { agents: ['architect', 'coder', 'tester'], confidence: 0.85 },
    'test': { agents: ['tester', 'reviewer'], confidence: 0.95 },
    'refactor': { agents: ['architect', 'coder', 'reviewer'], confidence: 0.9 },
    'performance': { agents: ['performance-engineer', 'coder', 'tester'], confidence: 0.88 },
    'security': { agents: ['security-architect', 'security-auditor', 'reviewer'], confidence: 0.92 },
    'database': { agents: ['architect', 'coder', 'tester'], confidence: 0.85 },
    'frontend': { agents: ['coder', 'designer', 'tester'], confidence: 0.82 },
    'backend': { agents: ['architect', 'coder', 'tester'], confidence: 0.85 },
    'bug': { agents: ['coder', 'tester', 'reviewer'], confidence: 0.88 },
    'fix': { agents: ['coder', 'tester', 'reviewer'], confidence: 0.85 },
    'feature': { agents: ['architect', 'coder', 'tester'], confidence: 0.8 },
    'swarm': { agents: ['swarm-specialist', 'coordinator', 'architect'], confidence: 0.9 },
    'memory': { agents: ['memory-specialist', 'architect', 'coder'], confidence: 0.88 },
    'deploy': { agents: ['devops', 'coder', 'tester'], confidence: 0.85 },
    'ci/cd': { agents: ['devops', 'coder'], confidence: 0.9 },
};
export function getFileExtension(filePath) {
    const match = filePath.match(/\.[a-zA-Z0-9]+$/);
    return match ? match[0] : '';
}
export function suggestAgentsForFile(filePath) {
    const ext = getFileExtension(filePath);
    // Check for test files first
    if (filePath.includes('.test.') || filePath.includes('.spec.')) {
        return AGENT_PATTERNS['.test.ts'] || ['tester', 'reviewer'];
    }
    return AGENT_PATTERNS[ext] || ['coder', 'architect'];
}
export function suggestAgentsForTask(task) {
    const taskLower = task.toLowerCase();
    // Check static keyword patterns first
    for (const [pattern, result] of Object.entries(KEYWORD_PATTERNS)) {
        if (taskLower.includes(pattern)) {
            return result;
        }
    }
    // Check runtime-learned patterns from successful task outcomes
    const taskKeywords = extractKeywords(task);
    if (taskKeywords.length > 0) {
        const outcomes = loadRoutingOutcomes();
        let bestAgent = '';
        let bestOverlap = 0;
        for (const outcome of outcomes) {
            if (!outcome.success || !outcome.agent || !outcome.keywords?.length)
                continue;
            const overlap = taskKeywords.filter(kw => outcome.keywords.includes(kw)).length;
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                bestAgent = outcome.agent;
            }
        }
        // Require at least 2 keyword overlap to prevent false positives
        if (bestAgent && bestOverlap >= 2) {
            return { agents: [bestAgent], confidence: Math.min(0.6 + bestOverlap * 0.05, 0.85) };
        }
    }
    // Default fallback
    return { agents: ['coder', 'researcher', 'tester'], confidence: 0.7 };
}
/**
 * V3: Augment agent suggestions with semantic matches from intelligence.ts ReasoningBank.
 * Returns null when the intelligence system is unavailable or has no relevant patterns.
 * Kept sync-safe by returning a Promise — callers that need a sync result use the
 * non-async suggestAgentsForTask above and optionally merge async results.
 */
// Canonical set of valid monomind agent type strings.
// Patterns whose type is not in this set (e.g. 'action', 'observation', 'routing')
// are structural labels, not agent names, and must be excluded from routing.
//
// Lean teardown: the SONA neural LoRA routing adaptation (applyNeuralAdaptation +
// the @monomind/neural NeuralLearningSystem singleton) has been removed. Routing now
// uses the pure keyword path plus the deterministic generateSimpleEmbedding query
// against the pattern index, with outcomes recorded via route-outcomes. No ONNX /
// LoRA inference happens on the routing hot path anymore.
export const VALID_AGENT_TYPES = new Set([
    'coder', 'reviewer', 'tester', 'planner', 'researcher',
    'architect', 'security-architect', 'security-auditor',
    'performance-engineer', 'backend-dev', 'mobile-dev',
    'ml-developer', 'cicd-engineer', 'api-docs', 'system-architect',
    'code-analyzer', 'devops', 'debugger', 'documenter', 'optimizer',
]);
export async function suggestAgentsFromIntelligence(task) {
    try {
        const intel = await import('../memory/intelligence.js');
        await intel.initializeIntelligence();
        const matches = await intel.findSimilarPatterns(task, { k: 5 });
        if (!matches || matches.length === 0)
            return null;
        // Only count patterns whose type is a valid agent name.
        // Trajectory-derived patterns use type='action'|'observation' etc. — skip those.
        const agentCounts = {};
        for (const m of matches) {
            const agent = m.type ?? '';
            if (!VALID_AGENT_TYPES.has(agent))
                continue;
            agentCounts[agent] = (agentCounts[agent] ?? 0) + (m.similarity ?? m.confidence ?? 0.5);
        }
        const sorted = Object.entries(agentCounts).sort((a, b) => b[1] - a[1]);
        if (sorted.length === 0)
            return null;
        // Return top-3 ranked agents so callers can build multi-agent task assignments
        const topAgents = sorted.slice(0, 3).map(([agent]) => agent);
        const confidence = Math.min(0.9, sorted[0][1] / matches.length);
        return { agents: topAgents, confidence };
    }
    catch {
        return null;
    }
}
export function assessCommandRisk(command) {
    const warnings = [];
    let level = 0;
    // High risk commands
    if (command.includes('rm -rf') || command.includes('rm -r')) {
        level = Math.max(level, 0.9);
        warnings.push('Recursive deletion detected - verify target path');
    }
    if (command.includes('sudo')) {
        level = Math.max(level, 0.7);
        warnings.push('Elevated privileges requested');
    }
    if (command.includes('> /') || command.includes('>> /')) {
        level = Math.max(level, 0.6);
        warnings.push('Writing to system path');
    }
    if (command.includes('chmod') || command.includes('chown')) {
        level = Math.max(level, 0.5);
        warnings.push('Permission modification');
    }
    if (command.includes('curl') && command.includes('|')) {
        level = Math.max(level, 0.8);
        warnings.push('Piping remote content to shell');
    }
    // Safe commands
    if (command.startsWith('npm ') || command.startsWith('npx ')) {
        level = Math.min(level, 0.3);
    }
    if (command.startsWith('git ')) {
        level = Math.min(level, 0.2);
    }
    if (command.startsWith('ls ') || command.startsWith('cat ') || command.startsWith('echo ')) {
        level = Math.min(level, 0.1);
    }
    const risk = level >= 0.7 ? 'high' : level >= 0.4 ? 'medium' : 'low';
    return { risk, level, warnings };
}
//# sourceMappingURL=hooks-embedding.js.map