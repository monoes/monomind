import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { EpisodicStore } from '../../packages/@monomind/memory/src/episodic-store.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('EpisodicStore', () => {
  let store: EpisodicStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'episodic-test-'));
    store = new EpisodicStore({
      filePath: join(tempDir, 'episodes.jsonl'),
      maxRunsPerEpisode: 3,
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('accumulates runs into a single episode', async () => {
    await store.addRun('r1', 'coder', 'feature', 'content1', 'sess1');
    await store.addRun('r2', 'tester', 'test', 'content2', 'sess1');

    // Episode not yet closed (maxRunsPerEpisode = 3), file should be empty
    const episodes = store.readAll();
    expect(episodes).toHaveLength(0);
    expect(store.hasOpenEpisode()).toBe(true);
  });

  it('auto-closes episode when maxRunsPerEpisode reached', async () => {
    await store.addRun('r1', 'coder', 'feature', 'content1', 'sess1');
    await store.addRun('r2', 'tester', 'test', 'content2', 'sess1');
    const result = await store.addRun('r3', 'reviewer', 'review', 'content3', 'sess1');

    expect(result).not.toBeNull();
    expect(result!.runIds).toEqual(['r1', 'r2', 'r3']);
    expect(result!.agentSlugs).toEqual(expect.arrayContaining(['coder', 'tester', 'reviewer']));
    expect(result!.taskTypes).toEqual(expect.arrayContaining(['feature', 'test', 'review']));
    expect(result!.sessionId).toBe('sess1');

    const episodes = store.readAll();
    expect(episodes).toHaveLength(1);
    expect(episodes[0].runIds).toEqual(['r1', 'r2', 'r3']);
    expect(store.hasOpenEpisode()).toBe(false);
  });

  it('closeEpisode persists to file and can be retrieved by id', async () => {
    await store.addRun('r1', 'coder', 'feature', 'some content', 'sess1');
    const episode = await store.closeEpisode();

    expect(episode).not.toBeNull();
    expect(episode!.episodeId).toBeDefined();
    expect(episode!.runIds).toEqual(['r1']);

    const retrieved = store.getById(episode!.episodeId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.episodeId).toBe(episode!.episodeId);
    expect(retrieved!.summary).toContain('some content');
  });

  it('search returns episodes with matching summary text', async () => {
    await store.addRun('r1', 'coder', 'feature', 'authentication module fix', 'sess1');
    await store.closeEpisode();

    await store.addRun('r2', 'coder', 'feature', 'database migration script', 'sess1');
    await store.closeEpisode();

    const results = store.search('authentication');
    expect(results).toHaveLength(1);
    expect(results[0].runIds).toEqual(['r1']);

    const noResults = store.search('nonexistent');
    expect(noResults).toHaveLength(0);
  });

  it('listBySession returns episodes for given session', async () => {
    await store.addRun('r1', 'coder', 'feature', 'content', 'sess1');
    await store.closeEpisode();

    await store.addRun('r2', 'coder', 'feature', 'content', 'sess2');
    await store.closeEpisode();

    await store.addRun('r3', 'coder', 'feature', 'content', 'sess1');
    await store.closeEpisode();

    const sess1Episodes = store.listBySession('sess1');
    expect(sess1Episodes).toHaveLength(2);
    expect(sess1Episodes.every((ep) => ep.sessionId === 'sess1')).toBe(true);

    const sess2Episodes = store.listBySession('sess2');
    expect(sess2Episodes).toHaveLength(1);
  });

  it('getById returns undefined for unknown id', () => {
    const result = store.getById('nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('uses custom summarizer when provided', async () => {
    const customSummarizer = vi.fn().mockResolvedValue('custom summary');
    const customStore = new EpisodicStore({
      filePath: join(tempDir, 'custom.jsonl'),
      maxRunsPerEpisode: 20,
      summarizer: customSummarizer,
    });

    await customStore.addRun('r1', 'coder', 'feature', 'raw content', 'sess1');
    const episode = await customStore.closeEpisode();

    expect(customSummarizer).toHaveBeenCalledWith('raw content');
    expect(episode!.summary).toBe('custom summary');
  });

  it('returns null from closeEpisode when no current episode', async () => {
    const result = await store.closeEpisode();
    expect(result).toBeNull();
  });
});
