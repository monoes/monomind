/**
 * P1-19: Command-output-honesty regression tests.
 *
 * Prevents P0-1 through P0-6 from recurring. Each test asserts that the
 * fabricated metrics, theatrical delays, and misleading output that were
 * removed in v2.9.5 do NOT come back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname_test = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname_test, '..', '..', 'src');

function readSrc(rel: string): string {
  return readFileSync(join(SRC_DIR, rel), 'utf8');
}

describe('P1-19: Command-output-honesty regression (prevents P0-1 to P0-6 recurrence)', () => {
  describe('P0-1: hooks pretrain — no theatrical pipeline', () => {
    const src = readSrc('commands/hooks-routing-commands.ts');

    it('does NOT contain the fake 4-step pipeline labels', () => {
      expect(src).not.toContain('RETRIEVE');
      expect(src).not.toContain('DISTILL');
      expect(src).not.toContain('CONSOLIDATE');
      expect(src).not.toContain('HYPERBOLIC');
    });

    it('does NOT contain the theatrical 800ms setTimeout delay', () => {
      expect(src).not.toContain('setTimeout(resolve, 800)');
    });

    it('does NOT display fabricated result columns', () => {
      expect(src).not.toContain('Trajectories Evaluated');
      expect(src).not.toContain('Contradictions Resolved');
      expect(src).not.toContain('Hyperbolic Projections');
    });

    it('description is honest ("No model is trained")', () => {
      expect(src).toContain('No model is trained');
    });
  });

  describe('P0-2: hooks intelligence status — no fabricated MoE metrics', () => {
    const src = readSrc('commands/hooks-workers.ts');

    it('MoE block is hardcoded off (not conditional on hasLocalData)', () => {
      // The fabricated defaults 8/0.82/0.9 must NOT appear
      expect(src).not.toContain('hasLocalData ? 8');
      expect(src).not.toContain('hasLocalData ? 0.82');
      expect(src).not.toContain('hasLocalData ? 0.9');
    });

    it('MoE status is "not-loaded"', () => {
      expect(src).toContain("'not-loaded'");
    });
  });

  describe('P0-3: hooks intelligence train — no LoRA lie', () => {
    const src = readSrc('commands/hooks-workers.ts');

    it('does NOT claim "EWC+LoRA applied"', () => {
      expect(src).not.toContain('EWC+LoRA');
      expect(src).not.toContain('LoRA applied');
    });

    it('reports real consolidation counts instead of a canned message', () => {
      // Wave 2 (IN-3): --train now runs the real compactPatterns() pass and
      // reports actual before/after/removed counts instead of a fixed
      // "EWC consolidation applied" string.
      expect(src).not.toContain('EWC consolidation applied');
      expect(src).toContain('consolidation removed');
    });
  });

  describe('P0-4: swarm init/start — no theatrical output', () => {
    const src = readSrc('commands/swarm.ts');

    it('does NOT claim to create coordination topology', () => {
      expect(src).not.toContain('Creating coordination topology');
      expect(src).not.toContain('Initializing memory namespace');
      expect(src).not.toContain('Setting up communication channels');
    });

    it('does NOT claim to configure SQLite-backed vector search in v1-mode', () => {
      expect(src).not.toContain('Configuring SQLite-backed vector search');
      expect(src).not.toContain('Initializing keyword routing');
    });

    it('start message is honest ("config written", not "initialized with slots")', () => {
      expect(src).toContain('config written');
      expect(src).not.toContain('initialized with');
    });
  });

  describe('P0-5: agent spawn — no fabricated precision numbers', () => {
    const src = readSrc('commands/agent-lifecycle.ts');

    it('does NOT contain fabricated multipliers in hints', () => {
      expect(src).not.toContain('150x-12,500x');
      expect(src).not.toContain('2.49x-7.47x');
    });

    it('does NOT reference deprecated lancedb in capabilities', () => {
      expect(src).not.toContain("'lancedb'");
    });
  });

  describe('P0-6: hive-mind gossip/crdt — no silent substitution', () => {
    const src = readSrc('mcp-tools/hive-mind-tools.ts');

    it('does NOT silently substitute byzantine for gossip/crdt', () => {
      // The old code had PLANNED_CONSENSUS + consensusWarning
      expect(src).not.toContain('PLANNED_CONSENSUS');
      expect(src).not.toContain('consensusWarning');
    });

    it('hard-errors on gossip/crdt with supported list', () => {
      expect(src).toContain('REJECTED_CONSENSUS');
      expect(src).toContain('is not implemented');
      expect(src).toContain('Supported: byzantine | bft | raft | quorum');
    });
  });

  describe('P0-14: enable-moe flag removed (was never read)', () => {
    const src = readSrc('commands/hooks-workers.ts');

    it('the dead --enable-moe/-m/--enable-sona/--embedding-provider flags are gone, not just relabeled', () => {
      // Wave 2 (IN-14): these were echoed but never read, so they were
      // deleted outright rather than kept around with an "Inert" label.
      expect(src).not.toContain('enable-moe');
      expect(src).not.toContain('enable-sona');
      expect(src).not.toContain('embedding-provider');
    });
  });
});
