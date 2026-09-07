import { describe, it, expect } from 'vitest';
import { buildRuntimeOptions } from '../../src/orgrt/runtime-options.js';
import { RUNNER_SPECS } from '../../src/orgrt/runner-registry.js';

describe('buildRuntimeOptions', () => {
  it('lists every RuntimeKind exactly once, matching runner-registry coverage', async () => {
    const result = await buildRuntimeOptions();
    const ids = result.runtimes.map((r) => r.id).sort();
    const expected = RUNNER_SPECS.map((s) => s.id).sort();
    expect(ids).toEqual(expected);
  });

  it('never includes secret-bearing fields on named providers', async () => {
    const result = await buildRuntimeOptions();
    for (const p of result.namedProviders) {
      expect(Object.keys(p).sort()).toEqual(
        Object.keys(p)
          .filter((k) => k === 'name' || k === 'defaultModel')
          .sort(),
      );
    }
  });

  it('marks a null-binary (in-process) runtime available without a PATH probe', async () => {
    const result = await buildRuntimeOptions();
    const vercel = result.runtimes.find((r) => r.id === 'vercel')!;
    expect(vercel.available).toBe(true);
    expect(vercel.binary).toBeUndefined();
  });

  it('keeps installed-detection distinct from auth/remote-model validation (no auth fields present)', async () => {
    const result = await buildRuntimeOptions();
    for (const r of result.runtimes) {
      expect(Object.prototype.hasOwnProperty.call(r, 'authenticated')).toBe(false);
    }
  });
});
