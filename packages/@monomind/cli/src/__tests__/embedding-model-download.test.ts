/**
 * Tests for the opt-in embedding-model download (init prompt + command).
 *
 * These never download the model: they cover the pure prompt-decision logic
 * with stubbed TTY/CI inputs, the existence of the standalone downloader
 * script, and registration of the `download-embeddings` command.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  EMBEDDING_MODEL_ID,
  embeddingDownloadDecision,
  findTransformersCacheDir,
  isEmbeddingModelCached,
} from '../routing/model-download.js';
import { getCommandAsync } from '../commands/index.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('embeddingDownloadDecision', () => {
  it('never prompts when the model is already cached', () => {
    expect(
      embeddingDownloadDecision({ cached: true, stdinTTY: true, stdoutTTY: true, ci: false }),
    ).toBe('already-cached');
    // ...even in a non-interactive run (no hint needed either)
    expect(
      embeddingDownloadDecision({ cached: true, stdinTTY: false, stdoutTTY: false, ci: true }),
    ).toBe('already-cached');
  });

  it('skips non-interactive runs (no stdin TTY)', () => {
    expect(
      embeddingDownloadDecision({ cached: false, stdinTTY: false, stdoutTTY: true, ci: false }),
    ).toBe('non-interactive');
  });

  it('skips non-interactive runs (no stdout TTY)', () => {
    expect(
      embeddingDownloadDecision({ cached: false, stdinTTY: true, stdoutTTY: false, ci: false }),
    ).toBe('non-interactive');
  });

  it('skips CI runs even on a TTY', () => {
    expect(
      embeddingDownloadDecision({ cached: false, stdinTTY: true, stdoutTTY: true, ci: true }),
    ).toBe('non-interactive');
  });

  it('prompts only when interactive and the model is missing', () => {
    expect(
      embeddingDownloadDecision({ cached: false, stdinTTY: true, stdoutTTY: true, ci: false }),
    ).toBe('prompt');
  });
});

describe('embedding model cache detection', () => {
  it('is consistent: cached implies a resolvable cache dir', () => {
    if (isEmbeddingModelCached()) {
      expect(findTransformersCacheDir()).not.toBeNull();
    } else {
      // Absent weights are a valid state (fresh checkout) — just no crash.
      expect(isEmbeddingModelCached()).toBe(false);
    }
  });
});

describe('standalone downloader script', () => {
  const script = join(PKG_ROOT, 'scripts', 'download-embedding-model.mjs');

  it('exists', () => {
    expect(existsSync(script)).toBe(true);
  });

  it('targets the same model as the semantic router', () => {
    const src = readFileSync(script, 'utf-8');
    expect(src).toContain(EMBEDDING_MODEL_ID);
    // Must not download when weights are already present.
    expect(src).toContain('already cached');
  });
});

describe('download-embeddings command', () => {
  it('is registered', async () => {
    const cmd = await getCommandAsync('download-embeddings');
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('download-embeddings');
    expect(typeof cmd!.action).toBe('function');
  });
});
