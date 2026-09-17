// packages/@monomind/cli/src/__tests__/memory-bridge-local-models-switch.test.ts
//
// Issue #249: `org run`/`org serve` used to disable the local ONNX models by
// setting MONOMIND_NO_LOCAL_EMBEDDINGS=1 / MONOMIND_RERANKER=0 on process.env,
// which every role's CLI and every command a role ran inherited — so a role's
// own `monomind memory search` silently degraded to keyword-only. The guard is
// now a process-local switch; these tests pin that it actually stops the model
// loads without touching process.env, and that the env opt-in still works.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let transformersImported = false;
vi.mock('@huggingface/transformers', () => {
  transformersImported = true;
  return { AutoTokenizer: {}, AutoModelForSequenceClassification: {}, pipeline: async () => null };
});

const VARS = ['MONOMIND_NO_LOCAL_EMBEDDINGS', 'MONOMIND_RERANKER'];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
});
afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('process-local switch for local models', () => {
  it('still honors the env opt-in when the switch is off', async () => {
    const bridge = await import('../memory/memory-bridge.js');
    expect(bridge.localEmbeddingsDisabled()).toBe(false);
    expect(bridge.rerankerDisabled()).toBe(false);
    process.env.MONOMIND_NO_LOCAL_EMBEDDINGS = '1';
    process.env.MONOMIND_RERANKER = '0';
    expect(bridge.localEmbeddingsDisabled()).toBe(true);
    expect(bridge.rerankerDisabled()).toBe(true);
  });

  it('disableLocalModels() skips the model loads without exporting anything to child processes', async () => {
    const bridge = await import('../memory/memory-bridge.js');
    bridge.disableLocalModels();
    expect(bridge.localEmbeddingsDisabled()).toBe(true);
    expect(bridge.rerankerDisabled()).toBe(true);
    await bridge.loadReranker();
    expect(transformersImported).toBe(false);
    expect(process.env.MONOMIND_NO_LOCAL_EMBEDDINGS).toBeUndefined();
    expect(process.env.MONOMIND_RERANKER).toBeUndefined();
  });
});
