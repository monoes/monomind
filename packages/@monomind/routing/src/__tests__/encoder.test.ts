import { describe, it, expect, vi } from 'vitest';
import { LocalEncoder, HNSWEncoder } from '../encoder.js';

describe('LocalEncoder', () => {
  const encoder = new LocalEncoder();

  it('produces a 256-dimensional vector', async () => {
    const vec = await encoder.encode('hello world');
    expect(vec).toHaveLength(256);
  });

  it('is deterministic (same input produces same output)', async () => {
    const a = await encoder.encode('fix the login bug');
    const b = await encoder.encode('fix the login bug');
    expect(a).toEqual(b);
  });

  it('is case-insensitive and trims whitespace', async () => {
    const a = await encoder.encode('Hello World');
    const b = await encoder.encode('  hello world  ');
    expect(a).toEqual(b);
  });

  it('produces L2-normalized vectors (magnitude ~1)', async () => {
    const vec = await encoder.encode('implement user authentication');
    const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it('caches results (second call returns same reference)', async () => {
    const fresh = new LocalEncoder();
    const a = await fresh.encode('cached value test');
    const b = await fresh.encode('cached value test');
    // Same reference from cache
    expect(a).toBe(b);
  });

  it('produces different vectors for different inputs', async () => {
    const a = await encoder.encode('write unit tests');
    const b = await encoder.encode('deploy to production');
    expect(a).not.toEqual(b);
  });

  it('encodeAll returns vectors for all inputs', async () => {
    const results = await encoder.encodeAll(['hello', 'world', 'test']);
    expect(results).toHaveLength(3);
    for (const vec of results) {
      expect(vec).toHaveLength(256);
    }
  });
});

describe('HNSWEncoder', () => {
  it('falls back to LocalEncoder when no embedder injected', async () => {
    const hnsw = new HNSWEncoder();
    const local = new LocalEncoder();
    const hnswVec = await hnsw.encode('test input');
    const localVec = await local.encode('test input');
    expect(hnswVec).toEqual(localVec);
  });

  it('delegates to injected embed function', async () => {
    const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const hnsw = new HNSWEncoder(mockEmbed);
    const result = await hnsw.encode('hello');
    expect(mockEmbed).toHaveBeenCalledWith('hello');
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it('encodeAll delegates to injected embed function sequentially', async () => {
    const calls: string[] = [];
    const mockEmbed = vi.fn().mockImplementation(async (text: string) => {
      calls.push(text);
      return [calls.length * 0.1];
    });
    const hnsw = new HNSWEncoder(mockEmbed);
    const results = await hnsw.encodeAll(['a', 'b', 'c']);
    expect(mockEmbed).toHaveBeenCalledTimes(3);
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(results).toHaveLength(3);
  });

  it('encodeAll falls back to LocalEncoder when no embedder', async () => {
    const hnsw = new HNSWEncoder();
    const local = new LocalEncoder();
    const hnswResults = await hnsw.encodeAll(['x', 'y']);
    const localResults = await local.encodeAll(['x', 'y']);
    expect(hnswResults).toEqual(localResults);
  });
});
