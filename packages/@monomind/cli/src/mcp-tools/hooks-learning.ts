/**
 * Hooks MCP Tools — pretrain, transfer and intelligence.
 * Extracted from hooks-routing.ts.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { DEFAULT_EMBEDDING_DIMS, DEFAULT_EMBEDDING_MODEL } from '../init/types.js';
import { readPatternDbRecords, writePatternDbRecords } from '../memory/intelligence-pattern-db.js';
import { validateMcpString } from '../utils/input-guards.js';
import { mergeRecordsById } from '../utils/json-file.js';
import { getIntelligenceStatsFromMemory, getSONAOptimizer } from './hooks-embedding.js';
import { getProjectCwd, type MCPTool } from './types.js';

/** Shape of a record in `.monomind/neural/patterns.json` — mirrors the
 *  `Pattern`/`StoredPattern` interfaces in src/memory/intelligence.ts. Kept
 *  loose here (no embedding required) since `hooks transfer` only needs to
 *  filter/dedupe/report on id, type, and confidence. */
interface NeuralPattern {
  id: string;
  type?: string;
  confidence?: number;
  [key: string]: unknown;
}

// Pretrain hook - repository analysis for intelligence bootstrap
export const hooksPretrain: MCPTool = {
  name: 'hooks_pretrain',
  description:
    'Walk the repository counting file extensions and directory patterns to seed the keyword router. This is a filesystem scan writing JSON state — despite the name, no model is trained.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository path' },
      depth: { type: 'string', description: 'Analysis depth (shallow, medium, deep)' },
      skipCache: { type: 'boolean', description: 'Skip cached analysis' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const repoPath = resolve(validateMcpString(params.path, 'path', 4 * 1024) ?? '.');
    const projectRoot = getProjectCwd();
    if (repoPath !== projectRoot && !repoPath.startsWith(projectRoot + sep)) {
      return { error: 'Invalid path: must be within the project directory.' };
    }
    const depth = validateMcpString(params.depth, 'depth', 16) ?? 'medium';
    const allowedDepths = new Set(['shallow', 'medium', 'deep']);
    if (!allowedDepths.has(depth)) {
      return { error: 'Invalid depth: must be shallow, medium, or deep' };
    }
    const startTime = performance.now();

    // Real file scanning — count files by extension, extract patterns
    const { readdirSync, statSync } = await import('node:fs');
    const extCounts: Record<string, number> = {};
    let filesAnalyzed = 0;
    let totalLines = 0;
    const maxDepth = depth === 'shallow' ? 2 : depth === 'deep' ? 6 : 4;
    const patterns: string[] = [];

    const scan = (dir: string, currentDepth: number) => {
      if (currentDepth > maxDepth) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist')
            continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            scan(full, currentDepth + 1);
          } else if (entry.isFile()) {
            const ext = entry.name.includes('.')
              ? entry.name.slice(entry.name.lastIndexOf('.'))
              : '';
            if (ext) extCounts[ext] = (extCounts[ext] || 0) + 1;
            filesAnalyzed++;
            // For code files, count lines and extract imports
            if (['.ts', '.js', '.py', '.go', '.rs', '.java'].includes(ext)) {
              try {
                // Skip very large files (minified bundles, generated code) to prevent OOM.
                // 1 MB is generous for a source file; anything larger is unlikely to have
                // useful import patterns in the first 30 lines anyway.
                const MAX_CODE_FILE_BYTES = 1 * 1024 * 1024;
                if (statSync(full).size > MAX_CODE_FILE_BYTES) continue;
                const content = readFileSync(full, 'utf-8');
                const lines = content.split('\n');
                totalLines += lines.length;
                // Extract import patterns (first 50 files max for performance)
                if (filesAnalyzed <= 50) {
                  for (const line of lines.slice(0, 30)) {
                    if (
                      line.startsWith('import ') ||
                      line.startsWith('from ') ||
                      (line.startsWith('const ') && line.includes('require('))
                    ) {
                      const trimmed = line.trim();
                      if (trimmed.length < 120 && !patterns.includes(trimmed))
                        patterns.push(trimmed);
                      if (patterns.length >= 100) break;
                    }
                  }
                }
              } catch {
                /* skip unreadable */
              }
            }
          }
        }
      } catch {
        /* skip inaccessible dirs */
      }
    };

    scan(repoPath, 0);
    const elapsed = Math.round(performance.now() - startTime);

    // Store extracted patterns in memory backend
    let patternsStored = 0;
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const stored = await bridge.bridgeStoreEntry({
        key: `pretrain-${Date.now()}`,
        value: JSON.stringify({
          filesAnalyzed,
          totalLines,
          topExtensions: Object.entries(extCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10),
          importPatterns: patterns.slice(0, 20),
        }),
        namespace: 'pretrain',
        tags: ['pretrain', depth],
      });
      // #293: only count what actually persisted. bridgeStoreEntry returns
      // null (never throws) when the backend cannot be loaded, so this used to
      // report every scanned pattern as stored on a store that did nothing.
      if (stored?.success) patternsStored = patterns.length;
      else
        console.warn(
          `[hooks-pretrain] patterns were NOT stored (${stored?.error ?? 'memory backend unavailable'})`,
        );
    } catch (e) {
      /* memory backend unavailable */
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-pretrain] pattern store failed:', e);
    }

    // Record the extracted import patterns as steps and one trajectory in the
    // local pattern log (intelligence.ts). No model is trained.
    let neuralPatternsLearned = 0;
    if (patterns.length > 0) {
      try {
        const intel = await import('../memory/intelligence.js');
        await intel.initializeIntelligence({
          confidenceLearningRate: 0.002,
          maxTrajectorySize: patterns.length,
        });
        // Record each extracted pattern as an action step
        for (const pat of patterns.slice(0, 50)) {
          await intel.recordStep({
            type: 'action',
            content: pat,
            metadata: { source: 'pretrain', depth },
          });
        }
        // Record the entire scan as a completed trajectory
        const steps = patterns.slice(0, 50).map((p) => ({ type: 'action' as const, content: p }));
        const recorded = await intel.recordTrajectory(steps, 'success');
        intel.flushPatterns();
        if (recorded) neuralPatternsLearned = steps.length;
      } catch (e) {
        /* intelligence not available */
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error('[hooks-pretrain] intelligence training failed:', e);
      }
    }

    return {
      success: true,
      _real: true,
      path: repoPath,
      depth,
      durationMs: elapsed,
      stats: {
        filesAnalyzed,
        totalLines,
        patternsExtracted: patterns.length,
        patternsStored,
        neuralPatternsLearned,
        fileTypes: Object.entries(extCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([ext, count]) => ({ ext, count })),
      },
    };
  },
};

// Transfer hook - transfer patterns from another project
export const hooksTransfer: MCPTool = {
  name: 'hooks_transfer',
  description: 'Copy recorded patterns from another project',
  inputSchema: {
    type: 'object',
    properties: {
      sourcePath: { type: 'string', description: 'Source project path' },
      filter: { type: 'string', description: 'Filter patterns by type' },
      minConfidence: { type: 'number', description: 'Minimum confidence threshold' },
    },
    required: ['sourcePath'],
  },
  handler: async (params: Record<string, unknown>) => {
    const sourcePath = validateMcpString(params.sourcePath, 'sourcePath', 4 * 1024);
    if (!sourcePath) {
      return { error: 'sourcePath is required (non-empty string, no control chars, max 4KB)' };
    }
    const minConfidence =
      typeof params.minConfidence === 'number' && Number.isFinite(params.minConfidence)
        ? Math.max(0, Math.min(1, params.minConfidence as number))
        : 0.7;
    const filter = validateMcpString(params.filter, 'filter', 64) ?? undefined;

    // Validate sourcePath is an existing directory before reading from it
    const resolvedSource = resolve(sourcePath);
    const { statSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    const home = homedir();
    if (resolvedSource !== home && !resolvedSource.startsWith(home + sep)) {
      return { error: 'sourcePath must be within the home directory.' };
    }
    try {
      const st = statSync(resolvedSource);
      if (!st.isDirectory()) {
        return { error: 'sourcePath must be a directory' };
      }
    } catch {
      return { error: 'sourcePath does not exist' };
    }

    // Load learned patterns from the source project's neural pattern store —
    // the same `.monomind/neural/patterns.json` file `hooks intelligence
    // import` writes to and intelligence.ts reads from (src/memory/intelligence.ts
    // getPatternsPath()).
    const sourcePatternsPath = join(resolvedSource, '.monomind', 'neural', 'patterns.json');
    let sourcePatterns: NeuralPattern[] = [];

    const MAX_SOURCE_PATTERNS_BYTES = 50 * 1024 * 1024; // 50 MB — matches other store readers
    // The source's SQLite store (patterns.db, opened read-only) when it has
    // one, else its patterns.json.
    const sourceDbRecords = readPatternDbRecords(join(resolvedSource, '.monomind', 'neural'));
    try {
      if (sourceDbRecords) {
        sourcePatterns = sourceDbRecords as NeuralPattern[];
      } else if (
        existsSync(sourcePatternsPath) &&
        statSync(sourcePatternsPath).size <= MAX_SOURCE_PATTERNS_BYTES
      ) {
        const parsed = JSON.parse(readFileSync(sourcePatternsPath, 'utf-8'));
        if (Array.isArray(parsed)) sourcePatterns = parsed;
      }
    } catch (e) {
      // Fall back to empty list
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-transfer] source patterns.json read/parse failed:', e);
    }

    if (sourcePatterns.length === 0) {
      return {
        success: false,
        message: 'No patterns found in source project',
        sourcePath,
        transferred: { total: 0, byType: {} },
      };
    }

    // Qualifying patterns: confidence at/above threshold, and (if given) type
    // matches the filter.
    const qualifying = sourcePatterns.filter(
      (p) =>
        typeof p.id === 'string' &&
        p.id.length > 0 &&
        (typeof p.confidence !== 'number' || p.confidence >= minConfidence) &&
        (!filter || (typeof p.type === 'string' && p.type.includes(filter))),
    );

    if (qualifying.length === 0) {
      return {
        success: false,
        message: 'No patterns in source project meet the filter/confidence threshold',
        sourcePath,
        transferred: { total: 0, byType: {} },
      };
    }

    // Merge into this project's pattern store, reusing the same by-id dedupe
    // logic as `hooks intelligence import` (neural-registry.ts's importCommand).
    const destDir = join(getProjectCwd(), '.monomind', 'neural');
    const destPatternsPath = join(destDir, 'patterns.json');
    let destPatterns: NeuralPattern[] = [];
    const destDbRecords = readPatternDbRecords(destDir);
    try {
      if (destDbRecords) {
        destPatterns = destDbRecords as NeuralPattern[];
      } else if (
        existsSync(destPatternsPath) &&
        statSync(destPatternsPath).size <= MAX_SOURCE_PATTERNS_BYTES
      ) {
        const parsed = JSON.parse(readFileSync(destPatternsPath, 'utf-8'));
        if (Array.isArray(parsed)) destPatterns = parsed;
      }
    } catch (e) {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[hooks-transfer] destination patterns.json read/parse failed:', e);
    }

    const { merged, added } = mergeRecordsById(destPatterns, qualifying);

    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    if (!writePatternDbRecords(destDir, merged, 'add')) {
      const tmpDest = `${destPatternsPath}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmpDest, JSON.stringify(merged, null, 2), 'utf-8');
      renameSync(tmpDest, destPatternsPath);
    }

    // Real counts of what was actually transferred, grouped by each pattern's
    // own `type` field (falling back to 'unknown' when absent).
    const byType: Record<string, number> = {};
    for (const p of added) {
      const type = typeof p.type === 'string' && p.type.length > 0 ? p.type : 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    }

    return {
      success: true,
      sourcePath,
      transferred: {
        total: added.length,
        byType,
      },
      dataSource: 'source-project',
    };
  },
};

// Intelligence hook - JS pattern/trajectory logging
export const hooksIntelligence: MCPTool = {
  name: 'hooks_intelligence',
  description: 'Intelligence status: pattern/trajectory logging metrics from the memory store',
  inputSchema: {
    type: 'object',
    properties: {
      enableHnsw: { type: 'boolean', description: 'Enable HNSW search' },
      forceTraining: { type: 'boolean', description: 'Force training cycle' },
      showStatus: { type: 'boolean', description: 'Show status only' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const enableHnsw = params.enableHnsw !== false;

    // Get REAL statistics from memory store
    const realStats = getIntelligenceStatsFromMemory();

    // Check actual implementation availability
    const sonaAvailable = (await getSONAOptimizer()) !== null;

    return {
      status: 'active',
      components: {
        sona: {
          enabled: sonaAvailable,
          status: sonaAvailable ? 'active' : 'idle',
          implemented: true,
          trajectoriesRecorded: realStats.trajectories.total,
          trajectoriesSuccessful: realStats.trajectories.successful,
          patternsLearned: realStats.patterns.learned,
          note: 'Trajectory + pattern logging (no neural training in the lean build)',
        },
        moe: {
          enabled: false,
          status: 'removed',
          implemented: false,
          routingDecisions: realStats.routing.decisions,
          note: 'MoE removed in lean build; keyword routing is used instead (see monoes-full-loop)',
        },
        hnsw: {
          enabled: enableHnsw,
          status: enableHnsw ? 'active' : 'disabled',
          implemented: true,
          indexSize: realStats.memory.indexSize,
          memorySizeBytes: realStats.memory.memorySizeBytes,
          note: 'Pure-JS HNSW vector indexing (O(log n) vs O(n))',
        },
        flashAttention: {
          enabled: false,
          status: 'removed',
          implemented: false,
          note: 'Flash Attention removed in lean build; lives on monoes-full-loop branch',
        },
        ewc: {
          enabled: false,
          status: 'removed',
          implemented: false,
          note: 'EWC++ removed in lean build; lives on monoes-full-loop branch',
        },
        lora: {
          enabled: false,
          status: 'removed',
          implemented: false,
          note: 'LoRA removed in lean build; lives on monoes-full-loop branch',
        },
        embeddings: {
          provider: 'transformers',
          model: DEFAULT_EMBEDDING_MODEL,
          dimension: DEFAULT_EMBEDDING_DIMS,
          implemented: true,
          note: `Real ONNX embeddings via ${DEFAULT_EMBEDDING_MODEL}`,
        },
      },
      realMetrics: {
        trajectories: realStats.trajectories,
        patterns: realStats.patterns,
        memory: realStats.memory,
        routing: realStats.routing,
      },
      implementationStatus: {
        working: [
          'memory-store',
          'embeddings',
          'trajectory-recording',
          'claims',
          'swarm-coordination',
          'hnsw-index',
          'pattern-storage',
          'keyword-routing',
        ],
        partial: [],
        notImplemented: [],
        removed: [
          'moe-routing',
          'flash-attention',
          'lora-adapter',
          'native-sona-engine',
          'native-router',
          'native-attention',
        ],
      },
      version: '3.0.0-alpha.102',
    };
  },
};
