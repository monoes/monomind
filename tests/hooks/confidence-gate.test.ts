import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { parseScore } from '../../packages/@monomind/hooks/src/confidence/confidence-prompt.js';
import { evaluate } from '../../packages/@monomind/hooks/src/confidence/confidence-gate.js';
import { InputRequestStore } from '../../packages/@monomind/hooks/src/confidence/input-request-store.js';
import type { ConfidenceConfig } from '../../packages/@monomind/hooks/src/confidence/types.js';
import { DEFAULT_CONFIDENCE_CONFIG } from '../../packages/@monomind/hooks/src/confidence/types.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ConfidenceConfig> = {}): ConfidenceConfig {
  return { ...DEFAULT_CONFIDENCE_CONFIG, ...overrides };
}

// ---------------------------------------------------------------------------
// parseScore
// ---------------------------------------------------------------------------

describe('parseScore', () => {
  it('extracts mid-string confidence score', () => {
    const output = 'Here is my answer.\nCONFIDENCE: 0.85\nDone.';
    expect(parseScore(output)).toBe(0.85);
  });

  it('handles 1.0', () => {
    expect(parseScore('CONFIDENCE: 1.0')).toBe(1.0);
  });

  it('returns null when no CONFIDENCE line', () => {
    expect(parseScore('No score here at all')).toBeNull();
  });

  it('clamps above 1.0', () => {
    expect(parseScore('CONFIDENCE: 1.5')).toBe(1.0);
  });

  it('is case-insensitive', () => {
    expect(parseScore('confidence: 0.42')).toBe(0.42);
  });
});

// ---------------------------------------------------------------------------
// evaluate (ConfidenceGate)
// ---------------------------------------------------------------------------

describe('evaluate', () => {
  it('returns PROCEED when score meets threshold', () => {
    const result = evaluate('CONFIDENCE: 0.90', makeConfig({ threshold: 0.7 }));
    expect(result.action).toBe('PROCEED');
    expect(result.score).toBe(0.9);
  });

  it('returns PAUSE when score below threshold', () => {
    const result = evaluate('CONFIDENCE: 0.30', makeConfig({ threshold: 0.7 }));
    expect(result.action).toBe('PAUSE');
    expect(result.score).toBe(0.3);
  });

  it('returns ABORT in CI mode with ciAbortOnLowConfidence', () => {
    const result = evaluate(
      'CONFIDENCE: 0.30',
      makeConfig({ threshold: 0.7, ciAbortOnLowConfidence: true }),
    );
    expect(result.action).toBe('ABORT');
    expect(result.score).toBe(0.3);
  });

  it('returns PROCEED when mode is NEVER', () => {
    const result = evaluate('CONFIDENCE: 0.10', makeConfig({ mode: 'NEVER' }));
    expect(result.action).toBe('PROCEED');
  });

  it('returns PAUSE when mode is ALWAYS', () => {
    const result = evaluate('CONFIDENCE: 0.99', makeConfig({ mode: 'ALWAYS' }));
    expect(result.action).toBe('PAUSE');
  });

  it('returns PROCEED when no confidence line found', () => {
    const result = evaluate('Just some output.', makeConfig());
    expect(result.action).toBe('PROCEED');
    expect(result.score).toBeNull();
    expect(result.reason).toContain('warning');
  });
});

// ---------------------------------------------------------------------------
// InputRequestStore
// ---------------------------------------------------------------------------

describe('InputRequestStore', () => {
  let tmpDir: string;
  let store: InputRequestStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'conf-gate-'));
    store = new InputRequestStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('create generates requestId', () => {
    const req = store.create('agent-1', 'task-1', 'output text', 0.5, 60_000);
    expect(req.requestId).toBeDefined();
    expect(typeof req.requestId).toBe('string');
    expect(req.requestId.length).toBeGreaterThan(0);
    expect(req.status).toBe('pending');
    expect(req.agentId).toBe('agent-1');
    expect(req.taskId).toBe('task-1');
  });

  it('respond updates status', () => {
    const req = store.create('agent-1', 'task-1', 'output text', 0.5, 60_000);
    const updated = store.respond(req.requestId, 'Looks good, proceed.');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('responded');
    expect(updated!.response).toBe('Looks good, proceed.');
    expect(updated!.respondedAt).toBeDefined();
  });

  it('poll returns request', () => {
    const req = store.create('agent-2', 'task-2', 'some output', 0.3, 30_000);
    const polled = store.poll(req.requestId);
    expect(polled).not.toBeNull();
    expect(polled!.requestId).toBe(req.requestId);
    expect(polled!.agentId).toBe('agent-2');
  });
});
