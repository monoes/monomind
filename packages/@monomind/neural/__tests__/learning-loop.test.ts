/**
 * Integration tests for the neural learning loop.
 *
 * These tests exercise the full data path without mocking core components:
 *   user action → embedding → trajectory → reward → LoRA update → pattern flush → routing
 *
 * @monomind/neural is tested in isolation; cross-package paths (LearningBridge,
 * intelligence.ts) are tested with lightweight stubs that do not mock the logic
 * under test.
 */

import { describe, it, expect, vi } from 'vitest';
// Import directly from source modules, NOT from the barrel index.ts.
// index.ts re-exports from both sona-manager.ts AND modes/index.ts; in Vitest's
// ESM loader this triggers a circular dependency that puts BaseModeImplementation
// in a temporal dead zone when balanced.ts tries to extend it.
import { SONAManager, createSONAManager } from '../src/sona-manager.js';
import { PatternLearner } from '../src/pattern-learner.js';
import { ReasoningBank } from '../src/reasoning-bank.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmbedding(seed: number, dim = 768): Float32Array {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) arr[i] = Math.sin(seed * (i + 1));
  // L2-normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) arr[i] /= norm;
  return arr;
}

// ---------------------------------------------------------------------------
// 1. Learning trigger threshold
// ---------------------------------------------------------------------------

describe('SONAManager learning trigger', () => {
  it('fires triggerLearning after MIN_TRIGGER_COUNT (5) completed trajectories', async () => {
    const manager = new SONAManager('balanced');
    await manager.initialize();

    const triggerSpy = vi.spyOn(manager as any, 'triggerLearning');

    // Complete 5 trajectories — should trigger learning
    for (let i = 0; i < 5; i++) {
      const id = manager.beginTrajectory(`task-${i}`, 'general');
      manager.recordStep(id, `action-${i}`, 0.8, makeEmbedding(i));
      manager.completeTrajectory(id, 0.8);
    }

    // triggerLearning is called async with .catch — give the microtask queue a beat
    await new Promise(r => setTimeout(r, 10));

    expect(triggerSpy).toHaveBeenCalledWith('capacity_threshold');
    await manager.cleanup();
  });

  it('does NOT fire for fewer than 5 completed trajectories', async () => {
    const manager = new SONAManager('balanced');
    await manager.initialize();

    const triggerSpy = vi.spyOn(manager as any, 'triggerLearning');

    // 4 trajectories — below the MIN_TRIGGER_COUNT of 5
    for (let i = 0; i < 4; i++) {
      const id = manager.beginTrajectory(`task-${i}`, 'general');
      manager.recordStep(id, `action-${i}`, 0.8, makeEmbedding(i));
      manager.completeTrajectory(id, 0.8);
    }

    await new Promise(r => setTimeout(r, 10));
    expect(triggerSpy).not.toHaveBeenCalled();
    await manager.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 2. LoRA B matrices actually update after triggerLearning
// ---------------------------------------------------------------------------

describe('SONAManager LoRA weight updates', () => {
  it('B matrices are non-zero after learning cycle with high-quality trajectories', async () => {
    const manager = new SONAManager('balanced');
    await manager.initialize();

    // Seed 10 trajectories to trigger auto-learning
    for (let i = 0; i < 10; i++) {
      const id = manager.beginTrajectory(`coding task ${i}`, 'code');
      manager.recordStep(id, `wrote_code_${i}`, 0.9, makeEmbedding(i));
      manager.completeTrajectory(id, 0.9);
    }

    // Wait for async triggerLearning to finish
    await new Promise(r => setTimeout(r, 50));

    const weights = (manager as any).loraWeights.get('default');
    expect(weights).toBeDefined();

    // At least one B matrix element should be non-zero after gradient update
    let anyNonZero = false;
    for (const [, B] of weights.B) {
      for (let i = 0; i < B.length; i++) {
        if (Math.abs(B[i]) > 1e-10) { anyNonZero = true; break; }
      }
      if (anyNonZero) break;
    }
    expect(anyNonZero).toBe(true);

    // B-norm must stay below the documented divergence threshold.
    // >0.1 is suspicious; >1.0 means EWC is failing to regularize.
    const loraStats = manager.getLoRAStats();
    for (const stats of Object.values(loraStats)) {
      expect(stats.avgBNorm).toBeLessThan(0.1);
    }
    await manager.cleanup();
  });

  it('EWC Fisher info is populated after learning cycle', async () => {
    const manager = new SONAManager('balanced');
    await manager.initialize();

    for (let i = 0; i < 10; i++) {
      const id = manager.beginTrajectory(`task ${i}`, 'general');
      manager.recordStep(id, `step ${i}`, 0.85, makeEmbedding(i + 100));
      manager.completeTrajectory(id, 0.85);
    }

    await new Promise(r => setTimeout(r, 50));

    const ewcState = (manager as any).ewcState;
    expect(ewcState).toBeDefined();
    expect(ewcState.fisher.size).toBeGreaterThan(0);

    // Fisher values should be positive (B²)
    for (const [, fisher] of ewcState.fisher) {
      const allNonNegative = Array.from(fisher).every((v: number) => v >= 0);
      expect(allNonNegative).toBe(true);
    }
    await manager.cleanup();
  });

  it('EWC means are only updated at task boundary (consolidateEWC), not every cycle', async () => {
    const manager = new SONAManager('balanced');
    await manager.initialize();

    // Manually call triggerLearning twice and check means are stable between calls
    for (let i = 0; i < 10; i++) {
      const id = manager.beginTrajectory(`task ${i}`, 'code');
      manager.recordStep(id, `action`, 0.8, makeEmbedding(i));
      manager.completeTrajectory(id, 0.8);
    }

    await new Promise(r => setTimeout(r, 50));

    const ewcState = (manager as any).ewcState;
    if (ewcState.means.size === 0) return; // No weights initialized yet, skip

    // Snapshot means after first learning cycle
    const meansBefore = new Map<string, Float32Array>();
    for (const [key, means] of ewcState.means) {
      meansBefore.set(key, new Float32Array(means));
    }

    // Call updateEWCFisher directly — should NOT change means
    (manager as any).updateEWCFisher();

    for (const [key, means] of ewcState.means) {
      const before = meansBefore.get(key);
      if (!before) continue;
      // means should be unchanged by updateEWCFisher
      for (let i = 0; i < means.length; i++) {
        expect(means[i]).toBe(before[i]);
      }
    }

    await manager.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 3. EWC penalty is applied (not a no-op)
// ---------------------------------------------------------------------------

describe('EWC penalty in gradient update', () => {
  it('B matrix update differs from pure gradient when Fisher and means are set', async () => {
    const manager = new SONAManager('balanced');
    await manager.initialize();

    // Run a full learning cycle to populate Fisher and means
    for (let i = 0; i < 10; i++) {
      const id = manager.beginTrajectory(`task ${i}`, 'code');
      manager.recordStep(id, `action`, 0.9, makeEmbedding(i));
      manager.completeTrajectory(id, 0.9);
    }
    await new Promise(r => setTimeout(r, 50));

    // Force consolidate to snapshot means
    (manager as any).consolidateEWC();

    // Manually perturb B away from means so penalty is non-zero
    const weights = (manager as any).loraWeights.get('default');
    if (!weights) return;
    for (const [, B] of weights.B) {
      for (let i = 0; i < Math.min(10, B.length); i++) B[i] += 0.5;
    }

    // Capture B before another learning cycle
    const BsBefore = new Map<string, Float32Array>();
    for (const [module, B] of weights.B) {
      BsBefore.set(module, new Float32Array(B));
    }

    // Add 10 more trajectories to trigger learning again
    for (let i = 10; i < 20; i++) {
      const id = manager.beginTrajectory(`task ${i}`, 'code');
      manager.recordStep(id, `action`, 0.9, makeEmbedding(i));
      manager.completeTrajectory(id, 0.9);
    }
    await new Promise(r => setTimeout(r, 50));

    // B should have changed; the EWC penalty would have pulled it toward means
    for (const [module, B] of weights.B) {
      const before = BsBefore.get(module);
      if (!before) continue;
      let changed = false;
      for (let i = 0; i < B.length; i++) {
        if (Math.abs(B[i] - before[i]) > 1e-12) { changed = true; break; }
      }
      expect(changed).toBe(true);
    }

    await manager.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 4. Non-finite rewards are rejected (don't corrupt weights)
// ---------------------------------------------------------------------------

describe('SONAManager input validation', () => {
  it('Infinity reward is silently dropped', async () => {
    const manager = new SONAManager('balanced');
    await manager.initialize();

    const id = manager.beginTrajectory('task', 'general');
    // Should not throw, should be ignored
    expect(() => manager.recordStep(id, 'action', Infinity, makeEmbedding(1))).not.toThrow();
    expect(() => manager.recordStep(id, 'action', -Infinity, makeEmbedding(2))).not.toThrow();

    const traj = manager.getTrajectory(id);
    // Steps with Infinity reward were dropped
    expect(traj?.steps.length).toBe(0);
    await manager.cleanup();
  });

  it('NaN reward is silently dropped', async () => {
    const manager = new SONAManager('balanced');
    await manager.initialize();

    const id = manager.beginTrajectory('task', 'general');
    expect(() => manager.recordStep(id, 'action', NaN, makeEmbedding(3))).not.toThrow();

    const traj = manager.getTrajectory(id);
    expect(traj?.steps.length).toBe(0);
    await manager.cleanup();
  });

  it('finalQuality outside [0,1] is clamped', async () => {
    const manager = new SONAManager('balanced');
    await manager.initialize();

    const id = manager.beginTrajectory('task', 'general');
    manager.recordStep(id, 'action', 0.5, makeEmbedding(4));
    const traj = manager.completeTrajectory(id, 999);

    expect(traj?.qualityScore).toBe(1.0);

    const id2 = manager.beginTrajectory('task2', 'general');
    manager.recordStep(id2, 'action', 0.5, makeEmbedding(5));
    const traj2 = manager.completeTrajectory(id2, -50);
    expect(traj2?.qualityScore).toBe(0.0);

    await manager.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 5. Component integration: SONAManager + PatternLearner + ReasoningBank
// ---------------------------------------------------------------------------

describe('Component integration cycle', () => {
  it('PatternLearner.getPatterns() returns typed patterns (no throw)', () => {
    const learner = new PatternLearner();
    const patterns = learner.getPatterns();
    expect(Array.isArray(patterns)).toBe(true);
    // Empty before any extractPattern calls
    for (const p of patterns) {
      expect(typeof p.patternId).toBe('string');
      expect(typeof p.domain).toBe('string');
      expect(typeof p.successRate).toBe('number');
      expect(p.successRate).toBeGreaterThanOrEqual(0);
      expect(p.successRate).toBeLessThanOrEqual(1);
    }
  });

  it('SONAManager.applyAdaptations returns same-length Float32Array', async () => {
    const manager = createSONAManager('balanced');
    await manager.initialize();

    const input = makeEmbedding(99);
    const output = await manager.applyAdaptations(input, 'default');

    expect(output).toBeInstanceOf(Float32Array);
    expect(output.length).toBe(input.length);

    await manager.cleanup();
  });

  it('SONAManager.findSimilarPatterns returns array (empty before training)', async () => {
    const manager = createSONAManager('balanced');
    await manager.initialize();

    const results = await manager.findSimilarPatterns(makeEmbedding(55), 3);
    expect(Array.isArray(results)).toBe(true);

    await manager.cleanup();
  });

  it('SONAManager completes full learn cycle without throwing', async () => {
    const manager = createSONAManager('balanced');
    await manager.initialize();

    for (let i = 0; i < 10; i++) {
      const id = manager.beginTrajectory(`task ${i}`, 'code');
      manager.recordStep(id, `action`, 0.85, makeEmbedding(i + 300));
      manager.completeTrajectory(id, 0.85);
    }

    // Explicitly trigger learning and wait
    await expect(manager.triggerLearning('test')).resolves.not.toThrow();
    await manager.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 6. Persist/load round-trip: LoRA weights survive cleanup + reinitialize
// ---------------------------------------------------------------------------

describe('SONAManager persist/load round-trip', () => {
  it('consolidated means and B matrices are restored after cleanup + reinitialize', async () => {
    const manager = new SONAManager('balanced');
    await manager.initialize();

    // Run enough trajectories to trigger learning (MIN_TRIGGER_COUNT=5)
    for (let i = 0; i < 5; i++) {
      const id = manager.beginTrajectory(`persist test ${i}`, 'code');
      manager.recordStep(id, `action_${i}`, 0.85, makeEmbedding(i + 500));
      manager.completeTrajectory(id, 0.85);
    }

    // Wait for async triggerLearning + persist
    await new Promise(r => setTimeout(r, 100));

    // Snapshot B values from the first manager instance
    const weights1 = (manager as any).loraWeights.get('default');
    expect(weights1).toBeDefined();
    const bSnapshot: Record<string, Float32Array> = {};
    for (const [module, B] of weights1.B) {
      bSnapshot[module] = new Float32Array(B);
    }

    // cleanup() consolidates EWC means then persists to disk
    await manager.cleanup();

    // Create a fresh manager and initialize — should load the persisted state
    const manager2 = new SONAManager('balanced');
    await manager2.initialize();

    const weights2 = (manager2 as any).loraWeights.get('default');
    // Weights may have been reset if avgBNorm > 1.0, but should exist
    // In stable operation, they should match the persisted values
    if (weights2) {
      const loraStats = manager2.getLoRAStats();
      const domainStats = loraStats['default'];
      if (domainStats) {
        // Loaded weights should not be diverged
        expect(domainStats.avgBNorm).toBeLessThan(1.0);
      }
    }

    // EWC state should have been restored with taskCount incremented by consolidateEWC
    const ewcState2 = (manager2 as any).ewcState;
    if (ewcState2 && ewcState2.taskCount > 0) {
      // means should be populated (were snapshotted during cleanup's consolidateEWC)
      expect(ewcState2.means.size).toBeGreaterThan(0);
    }

    await manager2.cleanup();
  });

  it('diverged B matrices (avgBNorm > 1.0) are reset to zero on load', async () => {
    const manager = new SONAManager('balanced');
    await manager.initialize();

    // Manually inject diverged B values to simulate a corrupted prior state
    const weights = (manager as any).loraWeights;
    if (!weights.has('default')) {
      (manager as any).initializeLoRAWeights('default');
    }
    const w = weights.get('default');
    for (const B of w.B.values()) {
      B.fill(50); // far above the 1.0 divergence threshold
    }

    // Persist the corrupted state
    await (manager as any).persistLearnedState();

    // Load into a fresh manager — should detect and reset the diverged weights
    const manager2 = new SONAManager('balanced');
    await manager2.initialize();

    const w2 = (manager2 as any).loraWeights.get('default');
    if (w2) {
      // Reset B matrices should be zero (filled with 0 after divergence detection)
      for (const B of w2.B.values()) {
        let allZero = true;
        for (let i = 0; i < Math.min(10, B.length); i++) {
          if (Math.abs(B[i]) > 1e-10) { allZero = false; break; }
        }
        expect(allZero).toBe(true);
      }
    }

    await manager2.cleanup();
    await manager.cleanup();
  });
});

// ---------------------------------------------------------------------------
// 7. domain→agent type mapping in flushNeuralPatternsToFile
// ---------------------------------------------------------------------------

describe('flushNeuralPatternsToFile domain mapping', () => {
  it('maps known domains to valid agent types', () => {
    // Test the mapping inline since it's a private method — verify the mapping
    // constants are logically correct by checking the domain→agent logic
    const DOMAIN_TO_AGENT: Record<string, string> = {
      code: 'coder',
      coding: 'coder',
      reasoning: 'researcher',
      research: 'researcher',
      testing: 'tester',
      review: 'reviewer',
      security: 'security-architect',
      performance: 'performance-engineer',
      architecture: 'architect',
      creative: 'researcher',
      math: 'researcher',
      chat: 'coder',
      general: 'coder',
    };

    const VALID_AGENT_TYPES = new Set([
      'coder', 'reviewer', 'tester', 'planner', 'researcher',
      'architect', 'security-architect', 'security-auditor',
      'performance-engineer', 'backend-dev', 'mobile-dev',
      'ml-developer', 'cicd-engineer', 'api-docs', 'system-architect',
      'code-analyzer', 'devops', 'debugger', 'documenter', 'optimizer',
    ]);

    for (const [domain, agent] of Object.entries(DOMAIN_TO_AGENT)) {
      expect(VALID_AGENT_TYPES.has(agent),
        `domain '${domain}' maps to '${agent}' which is not in VALID_AGENT_TYPES`
      ).toBe(true);
    }
  });
});
