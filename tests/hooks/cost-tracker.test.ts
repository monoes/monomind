import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CostTracker } from '../../packages/@monobrain/hooks/src/cost/cost-tracker.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let tracker: CostTracker;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'monobrain-cost-test-'));
  tracker = new CostTracker({ dbPath: join(tmpDir, 'test.jsonl') });
});

afterEach(() => {
  tracker.close();
  rmSync(tmpDir, { recursive: true });
});

describe('CostTracker', () => {
  describe('record()', () => {
    it('records a cost entry without throwing', () => {
      expect(() => tracker.record({
        id: 'test-001',
        agentSlug: 'coder',
        model: 'claude-haiku-3',
        inputTokens: 1000,
        outputTokens: 500,
      })).not.toThrow();
    });

    it('auto-calculates costUsd when not provided', () => {
      tracker.record({
        id: 'test-002',
        agentSlug: 'coder',
        model: 'claude-haiku-3',
        inputTokens: 1_000_000, // 1M tokens = $0.25
        outputTokens: 0,
      });
      const alert = tracker.checkBudget('coder', 0.20);
      expect(alert).not.toBeNull(); // $0.25 > $0.20
    });

    it('preserves explicit costUsd when provided', () => {
      tracker.record({
        id: 'test-003',
        agentSlug: 'coder',
        model: 'claude-haiku-3',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 99.99,
      });
      const records = tracker.readAll('coder');
      expect(records[0].costUsd).toBe(99.99);
    });

    it('generates id when not provided', () => {
      tracker.record({
        agentSlug: 'coder',
        model: 'claude-haiku-3',
        inputTokens: 100,
        outputTokens: 50,
      });
      const records = tracker.readAll();
      expect(records[0].id).toBeDefined();
      expect(records[0].id.length).toBeGreaterThan(0);
    });
  });

  describe('checkBudget()', () => {
    it('returns null when under budget', () => {
      tracker.record({
        id: 'b-001',
        agentSlug: 'cheap-agent',
        model: 'claude-haiku-3',
        inputTokens: 100,
        outputTokens: 50,
      });
      const alert = tracker.checkBudget('cheap-agent', 10.00);
      expect(alert).toBeNull();
    });

    it('returns BudgetAlert when over budget', () => {
      tracker.record({
        id: 'b-002',
        agentSlug: 'expensive-agent',
        model: 'claude-opus-4',
        inputTokens: 1_000_000, // $15
        outputTokens: 0,
      });
      const alert = tracker.checkBudget('expensive-agent', 5.00);
      expect(alert).not.toBeNull();
      expect(alert!.agentSlug).toBe('expensive-agent');
      expect(alert!.totalCostUsd).toBeGreaterThan(5.00);
    });

    it('scopes to specific agent', () => {
      tracker.record({
        agentSlug: 'agent-a',
        model: 'claude-opus-4',
        inputTokens: 1_000_000,
        outputTokens: 0,
      });
      tracker.record({
        agentSlug: 'agent-b',
        model: 'claude-haiku-3',
        inputTokens: 100,
        outputTokens: 50,
      });
      const alert = tracker.checkBudget('agent-b', 10.00);
      expect(alert).toBeNull(); // agent-b is cheap
    });
  });
});
