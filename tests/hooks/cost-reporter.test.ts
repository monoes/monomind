import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CostTracker } from '../../packages/@monomind/hooks/src/cost/cost-tracker.js';
import { CostReporter } from '../../packages/@monomind/hooks/src/cost/cost-reporter.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'monomind-reporter-test-'));
  dbPath = join(tmpDir, 'test.jsonl');
  const tracker = new CostTracker({ dbPath });
  tracker.record({ id: 'r1', agentSlug: 'coder', model: 'claude-haiku-3',
    inputTokens: 1000, outputTokens: 500, taskType: 'feature-development', retryCount: 0 });
  tracker.record({ id: 'r2', agentSlug: 'reviewer', model: 'claude-sonnet-4',
    inputTokens: 2000, outputTokens: 1000, taskType: 'code-review', retryCount: 1 });
  tracker.record({ id: 'r3', agentSlug: 'coder', model: 'claude-haiku-3',
    inputTokens: 800, outputTokens: 400, taskType: 'bug-fix', retryCount: 2 });
  tracker.close();
});

afterEach(() => rmSync(tmpDir, { recursive: true }));

describe('CostReporter', () => {
  let reporter: CostReporter;
  beforeEach(() => { reporter = new CostReporter(dbPath); });
  afterEach(() => reporter.close());

  describe('report()', () => {
    it('returns a CostReport with correct structure', () => {
      const report = reporter.report();
      expect(report).toHaveProperty('periodDays');
      expect(report).toHaveProperty('generatedAt');
      expect(report).toHaveProperty('totalCostUsd');
      expect(report).toHaveProperty('totalCalls');
      expect(report).toHaveProperty('byAgent');
    });

    it('counts all calls in period', () => {
      const report = reporter.report({ periodDays: 7 });
      expect(report.totalCalls).toBe(3);
    });

    it('groups by agent with correct call counts', () => {
      const report = reporter.report();
      const coderSummary = report.byAgent.find(a => a.agentSlug === 'coder');
      expect(coderSummary).toBeDefined();
      expect(coderSummary!.totalCalls).toBe(2);
    });

    it('sums retry counts per agent', () => {
      const report = reporter.report();
      const coderSummary = report.byAgent.find(a => a.agentSlug === 'coder');
      expect(coderSummary!.totalRetries).toBe(2); // 0 + 2
    });

    it('orders by totalCostUsd descending', () => {
      const report = reporter.report();
      if (report.byAgent.length >= 2) {
        expect(report.byAgent[0].totalCostUsd).toBeGreaterThanOrEqual(
          report.byAgent[1].totalCostUsd
        );
      }
    });

    it('returns empty report for non-existent db', () => {
      const emptyReporter = new CostReporter(join(tmpDir, 'nonexistent.jsonl'));
      const report = emptyReporter.report();
      expect(report.totalCalls).toBe(0);
      expect(report.totalCostUsd).toBe(0);
      expect(report.byAgent).toHaveLength(0);
    });
  });
});
