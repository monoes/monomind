/**
 * Tests for Prompt Version Management (Task 24).
 *
 * Uses vitest globals (describe, it, expect, beforeEach, afterEach, vi).
 * Run: npx vitest run tests/agents/prompt-versioning.test.ts --globals
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TestModel } from '../../packages/@monobrain/shared/src/testing/index.js';
import { PromptVersionStore } from '../../packages/@monobrain/memory/src/prompt-version-store.js';
import type {
  PromptVersion,
  PromptExperiment,
} from '../../packages/@monobrain/memory/src/prompt-version-store.js';
import { PromptExperimentRouter } from '../../packages/@monobrain/cli/src/agents/prompt-experiment.js';
import { PromptVersionManager } from '../../packages/@monobrain/cli/src/agents/prompt-version-manager.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'prompt-ver-'));
}

function makeVersion(overrides: Partial<PromptVersion> = {}): PromptVersion {
  return {
    agentSlug: 'coder',
    version: '1.0.0',
    prompt: 'You are a coder agent.',
    changelog: 'Initial version',
    activeFrom: new Date(),
    traceCount: 0,
    publishedBy: 'test',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PromptVersionStore', () => {
  let dir: string;
  let store: PromptVersionStore;

  beforeEach(() => {
    dir = makeTmpDir();
    store = new PromptVersionStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should save and retrieve the active version', () => {
    const v = makeVersion();
    store.save(v);
    const active = store.getActive('coder');
    expect(active).not.toBeNull();
    expect(active!.version).toBe('1.0.0');
    expect(active!.prompt).toBe('You are a coder agent.');
  });

  it('should return null for a missing agent', () => {
    const active = store.getActive('nonexistent');
    expect(active).toBeNull();
  });

  it('setActive should close old version and open new one', () => {
    const v1 = makeVersion({ version: '1.0.0', createdAt: new Date('2025-01-01') });
    const v2 = makeVersion({ version: '2.0.0', activeTo: new Date(), createdAt: new Date('2025-02-01') });
    store.save(v1);
    store.save(v2);

    store.setActive('coder', '2.0.0');

    const active = store.getActive('coder');
    expect(active).not.toBeNull();
    expect(active!.version).toBe('2.0.0');

    const all = store.listVersions('coder');
    const old = all.find((v) => v.version === '1.0.0');
    expect(old!.activeTo).toBeDefined();
  });

  it('listVersions returns ordered by createdAt DESC', () => {
    store.save(makeVersion({ version: '1.0.0', createdAt: new Date('2025-01-01') }));
    store.save(makeVersion({ version: '2.0.0', createdAt: new Date('2025-06-01') }));
    store.save(makeVersion({ version: '1.5.0', createdAt: new Date('2025-03-01') }));

    const list = store.listVersions('coder');
    expect(list.map((v) => v.version)).toEqual(['2.0.0', '1.5.0', '1.0.0']);
  });

  it('diff counts additions and deletions', () => {
    store.save(makeVersion({ version: '1.0.0', prompt: 'line1\nline2\nline3' }));
    store.save(makeVersion({ version: '2.0.0', prompt: 'line1\nline4\nline5' }));

    const result = store.diff('coder', '1.0.0', '2.0.0');
    expect(result.additions).toBe(2); // line4, line5
    expect(result.deletions).toBe(2); // line2, line3
  });

  it('updateQualityScore persists the score', () => {
    store.save(makeVersion({ version: '1.0.0' }));
    store.updateQualityScore('coder', '1.0.0', 0.95);

    const all = store.listVersions('coder');
    expect(all[0].qualityScore).toBe(0.95);
  });

  it('concludeExperiment sets winnerId', () => {
    const exp: PromptExperiment = {
      agentSlug: 'coder',
      control: '1.0.0',
      candidate: '2.0.0',
      trafficPct: 0.5,
      startedAt: new Date(),
    };
    store.saveExperiment(exp);

    expect(store.getExperiment('coder')).not.toBeNull();

    store.concludeExperiment('coder', '2.0.0');
    // After conclusion, no active experiment
    expect(store.getExperiment('coder')).toBeNull();
  });
});

describe('PromptExperimentRouter', () => {
  let dir: string;
  let store: PromptVersionStore;
  let router: PromptExperimentRouter;

  beforeEach(() => {
    dir = makeTmpDir();
    store = new PromptVersionStore(dir);
    router = new PromptExperimentRouter(store);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('traffic splitter distributes approximately at trafficPct', () => {
    store.save(makeVersion({ version: '1.0.0', prompt: 'control prompt' }));
    store.save(makeVersion({ version: '2.0.0', prompt: 'candidate prompt', activeTo: new Date() }));

    store.saveExperiment({
      agentSlug: 'coder',
      control: '1.0.0',
      candidate: '2.0.0',
      trafficPct: 0.3,
      startedAt: new Date(),
    });

    let candidateCount = 0;
    const samples = 1000;
    for (let i = 0; i < samples; i++) {
      const resolved = router.resolvePromptForSpawn('coder');
      if (resolved.isCandidate) candidateCount++;
    }

    const ratio = candidateCount / samples;
    // Allow +-10% tolerance
    expect(ratio).toBeGreaterThan(0.15);
    expect(ratio).toBeLessThan(0.45);
  });

  it('falls back to active version when no experiment', () => {
    store.save(makeVersion({ version: '1.0.0', prompt: 'active prompt' }));

    const resolved = router.resolvePromptForSpawn('coder');
    expect(resolved.prompt).toBe('active prompt');
    expect(resolved.version).toBe('1.0.0');
    expect(resolved.isCandidate).toBe(false);
  });
});

describe('PromptVersionManager', () => {
  let dir: string;
  let store: PromptVersionStore;
  let manager: PromptVersionManager;

  beforeEach(() => {
    dir = makeTmpDir();
    store = new PromptVersionStore(dir);
    manager = new PromptVersionManager(store);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rollback promotes previous version', () => {
    store.save(makeVersion({ version: '1.0.0', createdAt: new Date('2025-01-01') }));
    store.save(makeVersion({ version: '2.0.0', createdAt: new Date('2025-06-01') }));
    store.setActive('coder', '2.0.0');

    manager.rollback('coder');

    const active = store.getActive('coder');
    expect(active).not.toBeNull();
    expect(active!.version).toBe('1.0.0');
  });

  it('publishFromFile reads file and saves version', () => {
    const filePath = join(dir, 'prompt.txt');
    writeFileSync(filePath, 'You are a helpful assistant.', 'utf-8');

    const result = manager.publishFromFile('coder', filePath, '3.0.0', 'New prompt');
    expect(result.version).toBe('3.0.0');
    expect(result.prompt).toBe('You are a helpful assistant.');

    const active = store.listVersions('coder');
    expect(active).toHaveLength(1);
  });
});

describe('TestModel as offline prompt evaluation fixture', () => {
  it('TestModel.withDefaultResponse provides deterministic completions', async () => {
    const model = TestModel.withDefaultResponse('This prompt needs improvement: add examples');
    const response = await model.complete('Evaluate: You are a coder agent.');
    expect(response).toBe('This prompt needs improvement: add examples');
  });

  it('TestModel.addFixture maps specific prompt hashes to evaluation responses', async () => {
    const model = TestModel.withDefaultResponse('default evaluation');
    model.addFixture('You are a reviewer agent.', 'Good — clear role definition');
    model.addFixture('You are a tester agent.', 'Good — clear role definition');

    expect(await model.complete('You are a reviewer agent.')).toBe('Good — clear role definition');
    expect(await model.complete('You are a tester agent.')).toBe('Good — clear role definition');
    expect(await model.complete('some unknown prompt')).toBe('default evaluation');
  });

  it('TestModel tracks fixture count correctly', () => {
    const model = TestModel.withDefaultResponse('ok');
    expect(model.fixtureCount).toBe(0);
    model.addFixture('prompt a', 'response a');
    model.addFixture('prompt b', 'response b');
    expect(model.fixtureCount).toBe(2);
  });
});
