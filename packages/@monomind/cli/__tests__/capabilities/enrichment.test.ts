import { describe, it, expect, afterEach } from 'vitest';
import { EnrichmentPipeline } from '../../src/capabilities/enrichment.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('EnrichmentPipeline', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks enrichment state per file', () => {
    const pipeline = new EnrichmentPipeline();
    pipeline.markDone('report.pdf', 't0');
    pipeline.markDone('report.pdf', 't1');
    pipeline.markQueued('report.pdf', 't2');

    const state = pipeline.getState();
    expect(state['report.pdf'].t0).toBe('done');
    expect(state['report.pdf'].t1).toBe('done');
    expect(state['report.pdf'].t2).toBe('queued');
  });

  it('reports progress summary', () => {
    const pipeline = new EnrichmentPipeline();
    pipeline.markDone('a.pdf', 't0');
    pipeline.markDone('a.pdf', 't1');
    pipeline.markDone('a.pdf', 't2');
    pipeline.markDone('b.pdf', 't0');
    pipeline.markQueued('b.pdf', 't1');

    const summary = pipeline.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.fullyEnriched).toBe(1);
    expect(summary.t0Done).toBe(2);
    expect(summary.t1Done).toBe(1);
  });

  it('saves and loads state from disk', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-test-'));
    const pipeline = new EnrichmentPipeline();
    pipeline.markDone('report.pdf', 't0');

    pipeline.saveState(tmpDir);

    const pipeline2 = new EnrichmentPipeline();
    pipeline2.loadState(tmpDir);
    expect(pipeline2.getState()['report.pdf'].t0).toBe('done');
  });

  it('supports pause and resume', () => {
    const pipeline = new EnrichmentPipeline();
    expect(pipeline.isPaused).toBe(false);
    pipeline.pause();
    expect(pipeline.isPaused).toBe(true);
    pipeline.resume();
    expect(pipeline.isPaused).toBe(false);
  });
});
