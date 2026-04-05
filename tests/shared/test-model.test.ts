import { describe, it, expect } from 'vitest';

import { TestModel, hashPrompt } from '../../packages/@monobrain/shared/src/testing/test-model.js';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TestModel', () => {
  it('returns fixture for matching prompt', async () => {
    const model = new TestModel({ responses: new Map() });
    model.addFixture('hello', 'world');
    expect(await model.complete('hello')).toBe('world');
  });

  it('throws on unmatched prompt without defaultResponse', async () => {
    const model = new TestModel({ responses: new Map() });
    await expect(model.complete('unknown')).rejects.toThrow('No fixture');
  });

  it('returns defaultResponse on unmatched prompt', async () => {
    const model = TestModel.withDefaultResponse('fallback');
    expect(await model.complete('anything')).toBe('fallback');
  });

  it('hashPrompt is deterministic', () => {
    const h1 = hashPrompt('test input');
    const h2 = hashPrompt('test input');
    expect(h1).toBe(h2);
    expect(h1.length).toBe(16);
  });

  it('hashPrompt differs for different inputs', () => {
    expect(hashPrompt('a')).not.toBe(hashPrompt('b'));
  });

  it('saveToFile and fromFixtureFile round-trip', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'testmodel-'));
    const filePath = join(tempDir, 'fixtures.json');
    try {
      const model = new TestModel({ responses: new Map() });
      model.addFixture('prompt1', 'response1');
      model.addFixture('prompt2', 'response2');
      model.saveToFile(filePath);

      const loaded = TestModel.fromFixtureFile(filePath);
      expect(loaded.fixtureCount).toBe(2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fromFixtureFile throws for missing file', () => {
    expect(() => TestModel.fromFixtureFile('/nonexistent.json')).toThrow('not found');
  });

  it('fromFixtureFile loads nested fixtures format', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'testmodel-'));
    const filePath = join(tempDir, 'nested.json');
    try {
      writeFileSync(filePath, JSON.stringify({ fixtures: { abc123: 'response' } }));
      const model = TestModel.fromFixtureFile(filePath);
      expect(model.fixtureCount).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('simulates latencyMs delay', async () => {
    const model = new TestModel({ responses: new Map(), defaultResponse: 'ok', latencyMs: 50 });
    const t = Date.now();
    await model.complete('any');
    expect(Date.now() - t).toBeGreaterThanOrEqual(40); // allow small timing slack
  });

  it('addFixtureByHash works with explicit hash', async () => {
    const model = new TestModel({ responses: new Map() });
    const hash = hashPrompt('my prompt');
    model.addFixtureByHash(hash, 'matched');
    expect(await model.complete('my prompt')).toBe('matched');
  });

  it('fixtureCount reflects added fixtures', () => {
    const model = new TestModel({ responses: new Map() });
    expect(model.fixtureCount).toBe(0);
    model.addFixture('a', 'b');
    expect(model.fixtureCount).toBe(1);
  });
});
