/**
 * embeddings_neural drift/consolidate must read an INITIALIZED intelligence
 * store, not the uninitialized module singleton.
 *
 * Before the fix, `drift` and `consolidate` imported getIntelligenceStats()
 * without first awaiting initializeIntelligence() (unlike `adapt` and
 * `status`, which do). The SONA coordinator / ReasoningBank singletons were
 * therefore still null, patternsLearned was 0, and a populated store reported
 * "No patterns stored yet - drift detection inactive".
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initSpy = vi.fn(async () => ({ success: true }));
let initialized = false;

vi.mock('../memory/intelligence.js', () => ({
  initializeIntelligence: async () => {
    initialized = true;
    return initSpy();
  },
  getIntelligenceStats: () => ({
    sonaEnabled: initialized,
    // A populated store — but only visible once initialize() has run.
    reasoningBankSize: initialized ? 42 : 0,
    patternsLearned: initialized ? 7 : 0,
    trajectoriesRecorded: initialized ? 3 : 0,
    lastAdaptation: null,
    avgAdaptationTime: 0,
  }),
  benchmarkAdaptation: () => ({ avgMs: 0.01, minMs: 0.01, maxMs: 0.02, targetMet: true }),
}));

let tmp: string;
let cwd: string;

async function getNeuralTool() {
  // embeddings_neural is gated out of `embeddingsTools` unless
  // MONOMIND_MCP_SPECULATIVE=1; allEmbeddingsTools always contains it.
  const { allEmbeddingsTools } = await import('../mcp-tools/embeddings-tools.js');
  const tool = allEmbeddingsTools.find((t) => t.name === 'embeddings_neural');
  if (!tool) throw new Error('embeddings_neural tool not found');
  return tool;
}

beforeEach(() => {
  initialized = false;
  initSpy.mockClear();
  cwd = process.cwd();
  tmp = mkdtempSync(join(cwd, '.tmp-embneural-'));
  mkdirSync(join(tmp, '.monomind'), { recursive: true });
  writeFileSync(
    join(tmp, '.monomind', 'embeddings.json'),
    JSON.stringify({
      model: 'test',
      modelPath: '',
      dimension: 8,
      cacheSize: 1,
      hyperbolic: { enabled: false, curvature: 1, epsilon: 1e-6, maxNorm: 1 },
      neural: {
        enabled: true,
        driftThreshold: 0.3,
        decayRate: 0.01,
        features: { semanticDrift: true, memoryPhysics: true },
      },
    }),
  );
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(tmp, { recursive: true, force: true });
});

describe('embeddings_neural reads the store, not the uninitialized singleton', () => {
  it('drift initializes intelligence and reports the populated store', async () => {
    const tool = await getNeuralTool();
    const res = (await tool.handler({ action: 'drift' })) as Record<string, any>;

    expect(initSpy).toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.status.semanticDrift.patternsTracked).toBe(7);
    expect(res.status.semanticDrift.status).toBe('tracking');
    expect(res.message).not.toMatch(/No patterns stored yet/);
  });

  it('consolidate initializes intelligence and reports the populated store', async () => {
    const tool = await getNeuralTool();
    const res = (await tool.handler({ action: 'consolidate' })) as Record<string, any>;

    expect(initSpy).toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.status.memoryPhysics.patternsStored).toBe(42);
    expect(res.status.memoryPhysics.trajectoriesRecorded).toBe(3);
  });
});
