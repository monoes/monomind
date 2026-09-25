/**
 * `init --with-embeddings` used to shell out to a non-existent
 * `monomind embeddings init` command and always print "skipped". The step now
 * writes the config in-process and fetches the memory bridge's model — and an
 * offline machine must get a warning, never a crashed init.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runEmbeddingsStep } from '../init/embeddings-step.js';
import { DEFAULT_EMBEDDING_MODEL } from '../init/types.js';
import { output } from '../output.js';

function captureOutput(): string[] {
  const lines: string[] = [];
  vi.spyOn(output, 'writeln').mockImplementation((t?: string) => {
    lines.push(String(t ?? ''));
  });
  return lines;
}

afterEach(() => vi.restoreAllMocks());

describe('init --with-embeddings step', () => {
  it('writes the config and downloads the memory model', async () => {
    const lines = captureOutput();
    const writeConfig = vi.fn(async () => ({ success: true }));
    const downloadModel = vi.fn(async () => {});

    const r = await runEmbeddingsStep(DEFAULT_EMBEDDING_MODEL, { writeConfig, downloadModel });

    expect(r).toEqual({ configured: true, modelReady: true });
    expect(writeConfig).toHaveBeenCalledWith(DEFAULT_EMBEDDING_MODEL);
    expect(downloadModel).toHaveBeenCalledOnce();
    expect(lines.join('\n')).toContain('Embedding model ready');
    expect(lines.join('\n')).not.toMatch(/skipped/i);
  });

  it('degrades with a clear message when offline instead of throwing', async () => {
    const lines = captureOutput();
    const r = await runEmbeddingsStep(DEFAULT_EMBEDDING_MODEL, {
      writeConfig: async () => ({ success: true }),
      downloadModel: async () => {
        throw new Error('fetch failed');
      },
    });

    expect(r).toEqual({ configured: true, modelReady: false });
    const text = lines.join('\n');
    expect(text).toContain('fetch failed');
    expect(text).toContain('keyword matching');
    expect(text).toContain('monomind doc eval --provision-model');
  });

  it('survives a config write that throws', async () => {
    captureOutput();
    const r = await runEmbeddingsStep(DEFAULT_EMBEDDING_MODEL, {
      writeConfig: async () => {
        throw new Error('EACCES');
      },
      downloadModel: async () => {},
    });
    expect(r).toEqual({ configured: false, modelReady: true });
  });

  it('says a non-default model is not what memory embeds with', async () => {
    const lines = captureOutput();
    await runEmbeddingsStep('Xenova/all-MiniLM-L6-v2', {
      writeConfig: async () => ({ success: true }),
      downloadModel: async () => {},
    });
    expect(lines.join('\n')).toContain(`always embed with ${DEFAULT_EMBEDDING_MODEL}`);
  });

  it('init no longer shells out to the missing `embeddings init` command', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../commands/init.ts', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/'embeddings',\s*'init'/);
    expect(src).toContain('runEmbeddingsStep(');
  });
});
