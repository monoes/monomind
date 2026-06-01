/**
 * JSONL Store Tests — blank-line guard regression
 *
 * Verifies that blank lines in JSONL files (from partial writes or crashes)
 * do NOT cause SyntaxError in readAll() / readJsonl() calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { InputRequestStore } from '../confidence/input-request-store.js';
import { PlanStore } from '../planning/plan-store.js';
import { TraceQualityStore } from '../optimization/trace-quality-store.js';

function mkTmpDir(): string {
  const d = join(tmpdir(), `hooks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

// ---------------------------------------------------------------------------
// InputRequestStore
// ---------------------------------------------------------------------------

describe('InputRequestStore — JSONL blank-line guard', () => {
  let dir: string;

  beforeEach(() => { dir = mkTmpDir(); });

  it('does not throw when file has blank lines', () => {
    const store = new InputRequestStore(dir);
    const filePath = join(dir, 'input-requests.jsonl');
    const req = {
      requestId: 'r1', agentId: 'a', taskId: 't', agentOutput: 'x',
      confidenceScore: 0.9, question: 'q', createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'pending',
    };
    // Inject blank lines into the file
    writeFileSync(filePath, JSON.stringify(req) + '\n\n' + JSON.stringify(req) + '\n', 'utf-8');

    expect(() => store.poll('r1')).not.toThrow();
  });

  it('reads valid records despite surrounding blank lines', () => {
    const store = new InputRequestStore(dir);
    const filePath = join(dir, 'input-requests.jsonl');
    const req = {
      requestId: 'r2', agentId: 'a', taskId: 't', agentOutput: 'x',
      confidenceScore: 0.9, question: 'q', createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'pending',
    };
    writeFileSync(filePath, '\n' + JSON.stringify(req) + '\n\n', 'utf-8');

    const result = store.poll('r2');
    expect(result).not.toBeNull();
    expect(result?.requestId).toBe('r2');
  });
});

// ---------------------------------------------------------------------------
// PlanStore
// ---------------------------------------------------------------------------

describe('PlanStore — JSONL blank-line guard', () => {
  let dir: string;

  beforeEach(() => { dir = mkTmpDir(); });

  it('does not throw on blank-line file', () => {
    const store = new PlanStore(dir);
    const filePath = join(dir, 'plans.jsonl');
    const plan = {
      planId: 'p1', agentSlug: 'coder', goal: 'test goal',
      steps: [], status: 'active', createdAt: new Date(), approved: false,
    };
    store.save(plan as any);
    // Inject blank lines
    const existing = readFileSync(filePath, 'utf-8');
    writeFileSync(filePath, '\n' + existing + '\n\n', 'utf-8');

    expect(() => store.get('p1')).not.toThrow();
    expect(store.get('p1')?.planId).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// TraceQualityStore
// ---------------------------------------------------------------------------

describe('TraceQualityStore — JSONL blank-line guard', () => {
  let dir: string;

  beforeEach(() => { dir = mkTmpDir(); });

  it('does not throw on blank-line file', () => {
    const store = new TraceQualityStore(dir);
    const filePath = join(dir, 'trace-quality.jsonl');
    const rec = {
      traceId: 'tr1', agentSlug: 'coder', input: 'i', output: 'o',
      qualityScore: 0.8, createdAt: new Date(),
    };
    store.saveScore(rec);
    const existing = readFileSync(filePath, 'utf-8');
    writeFileSync(filePath, '\n' + existing + '\n\n', 'utf-8');

    expect(() => store.query('coder', new Date(Date.now() - 60_000), 0)).not.toThrow();
    const results = store.query('coder', new Date(Date.now() - 60_000), 0);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
