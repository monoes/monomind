import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getProjectCwd } from './types.js';

// Base dir for per-route outcome records — sits alongside routing-outcomes.json
export function getRouteOutcomesBaseDir(): string {
  return join(getProjectCwd(), '.monomind');
}

// Real vector search functions - lazy loaded to avoid circular imports
let searchEntriesFn:
  | ((options: {
      query: string;
      namespace?: string;
      limit?: number;
      threshold?: number;
    }) => Promise<{
      success: boolean;
      results: { id: string; key: string; content: string; score: number; namespace: string }[];
      searchTime: number;
      error?: string;
    }>)
  | null = null;

export async function getRealSearchFunction() {
  if (!searchEntriesFn) {
    try {
      const { searchEntries } = await import('../memory/memory-initializer.js');
      searchEntriesFn = searchEntries;
    } catch {
      searchEntriesFn = null;
    }
  }
  return searchEntriesFn;
}

// Real store function - lazy loaded
let storeEntryFn:
  | ((options: {
      key: string;
      value: string;
      namespace?: string;
      generateEmbeddingFlag?: boolean;
      tags?: string[];
      ttl?: number;
    }) => Promise<{
      success: boolean;
      id: string;
      embedding?: { dimensions: number; model: string };
      error?: string;
    }>)
  | null = null;

export async function getRealStoreFunction() {
  if (!storeEntryFn) {
    try {
      const { storeEntry } = await import('../memory/memory-initializer.js');
      storeEntryFn = storeEntry;
    } catch {
      storeEntryFn = null;
    }
  }
  return storeEntryFn;
}

// =============================================================================
// Neural Module Lazy Loaders (SONA, EWC++, MoE, LoRA, Flash Attention)
// =============================================================================

// SONA Optimizer - lazy loaded
let sonaOptimizer: Awaited<
  ReturnType<typeof import('../memory/sona-optimizer.js').getSONAOptimizer>
> | null = null;
export async function getSONAOptimizer() {
  if (!sonaOptimizer) {
    try {
      const { getSONAOptimizer: getSona } = await import('../memory/sona-optimizer.js');
      sonaOptimizer = await getSona();
    } catch {
      sonaOptimizer = null;
    }
  }
  return sonaOptimizer;
}

// EWC++ Consolidator - lazy loaded
let ewcConsolidator: Awaited<
  ReturnType<typeof import('../memory/ewc-consolidation.js').getEWCConsolidator>
> | null = null;
export async function getEWCConsolidator() {
  if (!ewcConsolidator) {
    try {
      const { getEWCConsolidator: getEWC } = await import('../memory/ewc-consolidation.js');
      ewcConsolidator = await getEWC();
    } catch {
      ewcConsolidator = null;
    }
  }
  return ewcConsolidator;
}

export function generateSimpleEmbedding(text: string, dimension: number = 384): Float32Array {
  // Simple deterministic embedding based on character codes
  // This is for routing purposes where we need consistent, fast embeddings
  const embedding = new Float32Array(dimension);
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const words = normalized.split(/\s+/).filter((w) => w.length > 0);

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
export function getRoutingOutcomesPath(): string {
  return join(getProjectCwd(), '.monomind', 'routing-outcomes.json');
}

export const ROUTING_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'under',
  'again',
  'further',
  'then',
  'once',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'she',
  'they',
  'them',
  'and',
  'but',
  'or',
  'nor',
  'not',
  'no',
  'so',
  'if',
  'when',
  'than',
  'very',
  'just',
  'also',
  'only',
  'both',
  'each',
  'all',
  'any',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'same',
  'new',
  'now',
  'here',
  'there',
  'where',
  'how',
  'what',
  'which',
  'who',
]);

interface RoutingOutcome {
  task: string;
  agent: string;
  success: boolean;
  quality: number;
  keywords: string[];
  timestamp: string;
}

export function extractKeywords(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !ROUTING_STOPWORDS.has(w));
}

export function loadRoutingOutcomes(): RoutingOutcome[] {
  try {
    if (existsSync(getRoutingOutcomesPath())) {
      const data = JSON.parse(readFileSync(getRoutingOutcomesPath(), 'utf-8'));
      return data.outcomes || [];
    }
  } catch (e) {
    /* corrupt file, start fresh */
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[hooks-embedding] routing-outcomes.json read/parse failed:', e);
  }
  return [];
}

/** Never throws; returns whether the outcomes were written. */
export function saveRoutingOutcomes(outcomes: RoutingOutcome[]): boolean {
  try {
    const dir = dirname(getRoutingOutcomesPath());
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Cap at 500 entries to bound file size
    const capped = outcomes.slice(-500);
    const tmp = `${getRoutingOutcomesPath()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ outcomes: capped }, null, 2));
    renameSync(tmp, getRoutingOutcomesPath());
    return true;
  } catch (e) {
    /* non-critical */
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[hooks-embedding] routing-outcomes.json write failed:', e);
    return false;
  }
}

// Trajectory storage for SONA learning
export interface TrajectoryStep {
  action: string;
  result: string;
  quality: number;
  timestamp: string;
}

export interface TrajectoryData {
  id: string;
  task: string;
  agent: string;
  steps: TrajectoryStep[];
  startedAt: string;
  success?: boolean;
  endedAt?: string;
}

// In-memory trajectory tracking (persisted on end)
export const activeTrajectories = new Map<string, TrajectoryData>();

// Memory store types and helpers
export interface MemoryEntry {
  key: string;
  value: unknown;
  metadata?: Record<string, unknown>;
  storedAt: string;
  accessCount: number;
  lastAccessed: string;
}

export interface MemoryStore {
  entries: Record<string, MemoryEntry>;
  version: string;
}

export const MEMORY_DIR = '.monomind/memory';
export const MEMORY_FILE = 'store.json';

export function getMemoryPath(): string {
  return join(getProjectCwd(), MEMORY_DIR, MEMORY_FILE);
}

// Maximum size of the legacy JSON memory store before reads are skipped.
// Matches the guard in memory-tools.ts (loadLegacyStore) which loads the same file.
export const MAX_MEMORY_STORE_BYTES = 50 * 1024 * 1024; // 50 MB

export function loadMemoryStore(): MemoryStore {
  try {
    const path = getMemoryPath();
    if (existsSync(path) && statSync(path).size <= MAX_MEMORY_STORE_BYTES) {
      const data = readFileSync(path, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    // Return empty store on error
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[hooks-embedding] memory store.json read/parse failed:', e);
  }
  return { entries: {}, version: '3.0.0' };
}

/**
 * Get real intelligence statistics from memory store
 */
export function getIntelligenceStatsFromMemory(): {
  trajectories: { total: number; successful: number };
  patterns: { learned: number; categories: Record<string, number> };
  memory: { indexSize: number; totalAccessCount: number; memorySizeBytes: number };
  routing: { decisions: number; avgConfidence: number };
} {
  const store = loadMemoryStore();
  const entries = Object.values(store.entries);

  // Count trajectories (keys starting with "trajectory-" or containing trajectory data)
  const trajectoryEntries = entries.filter(
    (e) => e.key.includes('trajectory') || e.metadata?.type === 'trajectory',
  );
  const successfulTrajectories = trajectoryEntries.filter(
    (e) =>
      e.metadata?.success === true ||
      (typeof e.value === 'object' &&
        e.value !== null &&
        (e.value as Record<string, unknown>).success === true),
  );

  // Count patterns
  const patternEntries = entries.filter(
    (e) =>
      e.key.includes('pattern') || e.metadata?.type === 'pattern' || e.key.startsWith('learned-'),
  );

  // Categorize patterns
  const categories: Record<string, number> = {};
  patternEntries.forEach((e) => {
    const category = (e.metadata?.category as string) || 'general';
    categories[category] = (categories[category] || 0) + 1;
  });

  // Count routing decisions
  const routingEntries = entries.filter(
    (e) => e.key.includes('routing') || e.metadata?.type === 'routing-decision',
  );

  // Calculate average confidence from routing decisions
  let totalConfidence = 0;
  let confidenceCount = 0;
  routingEntries.forEach((e) => {
    const confidence = e.metadata?.confidence as number;
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
  } catch {
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

// File type → recommended agents for hooks_pre-edit. Every value is a spawnable
// agent name (a bundled agent's frontmatter `name`, the Task subagent_type).
export const AGENT_PATTERNS: Record<string, string[]> = {
  '.ts': ['coder', 'Software Architect', 'tester'],
  '.tsx': ['Frontend Developer', 'coder', 'reviewer'],
  '.test.ts': ['tester', 'reviewer'],
  '.spec.ts': ['tester', 'reviewer'],
  '.md': ['Technical Writer', 'researcher'],
  '.json': ['coder', 'Software Architect'],
  '.yaml': ['DevOps Automator', 'coder'],
  '.yml': ['DevOps Automator', 'coder'],
  '.sh': ['DevOps Automator', 'coder'],
  '.py': ['coder', 'AI Engineer', 'researcher'],
  '.sql': ['Database Optimizer', 'coder'],
  '.css': ['Frontend Developer', 'Monodesign'],
  '.scss': ['Frontend Developer', 'Monodesign'],
};

export function getFileExtension(filePath: string): string {
  const match = filePath.match(/\.[a-zA-Z0-9]+$/);
  return match ? match[0] : '';
}

export function suggestAgentsForFile(filePath: string): string[] {
  const ext = getFileExtension(filePath);

  // Check for test files first
  if (filePath.includes('.test.') || filePath.includes('.spec.')) {
    return AGENT_PATTERNS['.test.ts'] || ['tester', 'reviewer'];
  }

  return AGENT_PATTERNS[ext] || ['coder', 'Software Architect'];
}

/**
 * V3: Augment agent suggestions with semantic matches from intelligence.ts ReasoningBank.
 * Returns null when the intelligence system is unavailable or has no relevant patterns.
 * Used by the prompt hook (.claude/helpers/handlers/route-handler.cjs).
 */
// Only pattern types that are registry agent names (the spawnable Task
// subagent_type) count; structural labels ('action', 'observation',
// 'routing') and names no agent carries any more are skipped.
//
// Lean teardown: the SONA neural LoRA routing adaptation (applyNeuralAdaptation +
// the @monomind/neural NeuralLearningSystem singleton) has been removed. Routing now
// uses the pure keyword path plus the deterministic generateSimpleEmbedding query
// against the pattern index, with outcomes recorded via route-outcomes. No ONNX /
// LoRA inference happens on the routing hot path anymore.

export async function suggestAgentsFromIntelligence(
  task: string,
): Promise<{ agents: string[]; confidence: number } | null> {
  try {
    const intel = await import('../memory/intelligence.js');
    await intel.initializeIntelligence();
    const matches = await intel.findSimilarPatterns(task, { k: 5 });
    if (!matches || matches.length === 0) return null;

    // Only count patterns whose type is a registry agent name.
    // Trajectory-derived patterns use type='action'|'observation' etc. — skip those.
    const { agentNames } = await import('../decision/catalogs.js');
    const names = agentNames(getProjectCwd());
    const agentCounts: Record<string, number> = {};
    for (const m of matches) {
      const agent = m.type ?? '';
      if (!names.has(agent)) continue;
      agentCounts[agent] = (agentCounts[agent] ?? 0) + (m.similarity ?? m.confidence ?? 0.5);
    }

    const sorted = Object.entries(agentCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return null;

    // Return top-3 ranked agents so callers can build multi-agent task assignments
    const topAgents = sorted.slice(0, 3).map(([agent]) => agent);
    const confidence = Math.min(0.9, sorted[0][1] / matches.length);
    return { agents: topAgents, confidence };
  } catch {
    return null;
  }
}

export function assessCommandRisk(command: string): {
  risk: string;
  level: number;
  warnings: string[];
} {
  const warnings: string[] = [];
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
