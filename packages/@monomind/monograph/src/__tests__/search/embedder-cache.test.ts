import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTransformersEmbedder,
  EMBEDDING_MODEL,
  isModelCached,
} from '../../embeddings/transformers-embedder.js';

describe('createTransformersEmbedder never downloads on its own', () => {
  let cacheDir: string;
  const prev = { ...process.env };

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'model-cache-'));
    delete process.env.MONOGRAPH_ALLOW_DOWNLOAD;
    delete process.env.MONOGRAPH_EMBED;
  });

  afterEach(() => {
    process.env = { ...prev };
    rmSync(cacheDir, { recursive: true, force: true });
  });

  const fakeHf = (pipeline: () => unknown) => async () => ({ env: { cacheDir }, pipeline });

  it('reports whether the model directory exists', () => {
    expect(isModelCached(cacheDir)).toBe(false);
    expect(isModelCached(undefined)).toBe(false);
    mkdirSync(join(cacheDir, EMBEDDING_MODEL), { recursive: true });
    expect(isModelCached(cacheDir)).toBe(true);
  });

  it('returns null without touching the network when the model is not on disk', async () => {
    const pipeline = vi.fn();
    expect(await createTransformersEmbedder(fakeHf(pipeline))).toBeNull();
    expect(pipeline).not.toHaveBeenCalled();
  });

  it('loads the model when it is cached', async () => {
    mkdirSync(join(cacheDir, EMBEDDING_MODEL), { recursive: true });
    const pipeline = vi.fn(async () => async () => ({ data: new Float32Array(384) }));
    const embedder = await createTransformersEmbedder(fakeHf(pipeline));
    expect(embedder?.model).toBe(EMBEDDING_MODEL);
    expect(pipeline).toHaveBeenCalledOnce();
  });

  it('downloads only when explicitly allowed', async () => {
    process.env.MONOGRAPH_ALLOW_DOWNLOAD = '1';
    const pipeline = vi.fn(async () => async () => ({ data: new Float32Array(384) }));
    expect(await createTransformersEmbedder(fakeHf(pipeline))).not.toBeNull();
    expect(pipeline).toHaveBeenCalledOnce();
  });

  it('stays off when MONOGRAPH_EMBED=0, even with the model cached', async () => {
    mkdirSync(join(cacheDir, EMBEDDING_MODEL), { recursive: true });
    process.env.MONOGRAPH_EMBED = '0';
    const pipeline = vi.fn();
    expect(await createTransformersEmbedder(fakeHf(pipeline))).toBeNull();
    expect(pipeline).not.toHaveBeenCalled();
  });
});
