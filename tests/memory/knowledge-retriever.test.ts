/**
 * Tests for Task 28 — Per-Agent Knowledge Base
 *
 * Covers document-chunker, knowledge-store, and knowledge-retriever.
 */

import { describe, it, expect, vi } from 'vitest';

import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chunkDocument } from '../../packages/@monobrain/memory/src/knowledge/document-chunker.js';
import { KnowledgeStore } from '../../packages/@monobrain/memory/src/knowledge/knowledge-store.js';
import {
  KnowledgeRetriever,
  type SearchFn,
} from '../../packages/@monobrain/memory/src/knowledge/knowledge-retriever.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
}

// ── chunkDocument ───────────────────────────────────────────────────

describe('chunkDocument', () => {
  it('returns a single chunk for a short document', () => {
    const chunks = chunkDocument('doc1', 'Hello world');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Hello world');
    expect(chunks[0].startChar).toBe(0);
    expect(chunks[0].endChar).toBe(11);
  });

  it('returns multiple overlapping chunks for a long document', () => {
    const text = 'A'.repeat(7000);
    const chunks = chunkDocument('doc2', text, 3200, 400);
    expect(chunks.length).toBeGreaterThan(1);

    // Verify overlap: second chunk should start before first chunk ends
    expect(chunks[1].startChar).toBeLessThan(chunks[0].endChar);
  });

  it('assigns sequential chunkIndex values', () => {
    const text = 'B'.repeat(10000);
    const chunks = chunkDocument('doc3', text, 3200, 400);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunkIndex).toBe(i);
    }
  });

  it('produces chunkId in the format docId:index', () => {
    const text = 'C'.repeat(7000);
    const chunks = chunkDocument('mydoc', text, 3200, 400);
    expect(chunks[0].chunkId).toBe('mydoc:0');
    expect(chunks[1].chunkId).toBe('mydoc:1');
  });

  it('prefers paragraph boundaries when splitting', () => {
    // Build a document where a paragraph break falls in the last 20% of chunk
    const para1 = 'X'.repeat(2800);
    const para2 = 'Y'.repeat(3000);
    const text = para1 + '\n\n' + para2;

    const chunks = chunkDocument('doc-para', text, 3200, 400);
    // First chunk should end right after the paragraph break (2802)
    expect(chunks[0].endChar).toBe(2802);
  });
});

// ── KnowledgeStore ──────────────────────────────────────────────────

describe('KnowledgeStore', () => {
  it('documentNeedsReindex returns false for unchanged content', () => {
    const dir = makeTmpDir();
    const store = new KnowledgeStore(dir);

    // Create a temp file to index
    const filePath = path.join(dir, 'test.txt');
    fs.writeFileSync(filePath, 'some content');

    store.indexDocument(filePath, 'shared');

    // Same content → no reindex needed
    expect(store.documentNeedsReindex(filePath, 'shared')).toBe(false);

    // Change content → reindex needed
    fs.writeFileSync(filePath, 'changed content');
    expect(store.documentNeedsReindex(filePath, 'shared')).toBe(true);
  });

  it('indexDocument stores chunks and metadata in JSONL', () => {
    const dir = makeTmpDir();
    const store = new KnowledgeStore(dir);

    const filePath = path.join(dir, 'doc.txt');
    fs.writeFileSync(filePath, 'Hello world, this is a test document.');

    const result = store.indexDocument(filePath, 'agent-1');
    expect(result.chunksIndexed).toBe(1);

    // Verify JSONL files exist and have content
    const metaPath = path.join(dir, 'metadata.jsonl');
    const chunksPath = path.join(dir, 'chunks.jsonl');
    expect(fs.existsSync(metaPath)).toBe(true);
    expect(fs.existsSync(chunksPath)).toBe(true);

    const metaLines = fs.readFileSync(metaPath, 'utf-8').trim().split('\n');
    expect(metaLines).toHaveLength(1);
    const meta = JSON.parse(metaLines[0]);
    expect(meta.filePath).toBe(filePath);
    expect(meta.scope).toBe('agent-1');
    expect(meta.chunkCount).toBe(1);

    const chunkLines = fs.readFileSync(chunksPath, 'utf-8').trim().split('\n');
    expect(chunkLines).toHaveLength(1);
    const chunk = JSON.parse(chunkLines[0]);
    expect(chunk.namespace).toBe('knowledge:agent-1');
    expect(chunk.text).toContain('Hello world');
  });

  it('getPartitionNamespace maps shared and agent scopes correctly', () => {
    const dir = makeTmpDir();
    const store = new KnowledgeStore(dir);
    expect(store.getPartitionNamespace('shared')).toBe('knowledge:shared');
    expect(store.getPartitionNamespace('coder-1')).toBe('knowledge:coder-1');
  });
});

// ── KnowledgeRetriever ──────────────────────────────────────────────

describe('KnowledgeRetriever', () => {
  function makeSearchFn(
    results: Record<
      string,
      Array<{ key: string; value: string; score: number; metadata: Record<string, unknown> }>
    >,
  ): SearchFn {
    return vi.fn(async (_query, opts) => {
      return results[opts.namespace] ?? [];
    });
  }

  it('merges shared and private results without duplicates', async () => {
    const dir = makeTmpDir();
    const store = new KnowledgeStore(dir);

    const duplicateChunk = {
      key: 'dup:0',
      value: 'duplicate text',
      score: 0.8,
      metadata: { filePath: 'f.txt', chunkIndex: 0 },
    };

    const searchFn = makeSearchFn({
      'knowledge:shared': [
        duplicateChunk,
        { key: 'shared:1', value: 'shared text', score: 0.7, metadata: { filePath: 'a.txt', chunkIndex: 1 } },
      ],
      'knowledge:agent-x': [
        { ...duplicateChunk, score: 0.9 }, // higher score duplicate
        { key: 'private:1', value: 'private text', score: 0.6, metadata: { filePath: 'b.txt', chunkIndex: 0 } },
      ],
    });

    const retriever = new KnowledgeRetriever(searchFn, store);
    const result = await retriever.retrieveForTask('agent-x', 'test query');

    // dup:0 should appear once with the higher score (0.9)
    const dupExcerpts = result.excerpts.filter((e) => e.chunkId === 'dup:0');
    expect(dupExcerpts).toHaveLength(1);
    expect(dupExcerpts[0].similarity).toBe(0.9);

    // Total unique excerpts: dup:0, shared:1, private:1
    expect(result.excerpts).toHaveLength(3);
  });

  it('returns empty excerpts for an unknown agent with no data', async () => {
    const dir = makeTmpDir();
    const store = new KnowledgeStore(dir);

    const searchFn = makeSearchFn({});
    const retriever = new KnowledgeRetriever(searchFn, store);
    const result = await retriever.retrieveForTask('unknown-agent', 'anything');

    expect(result.excerpts).toHaveLength(0);
    expect(result.formattedContext).toBe('');
  });

  it('formats context with header and numbered excerpts', async () => {
    const dir = makeTmpDir();
    const store = new KnowledgeStore(dir);

    const searchFn = makeSearchFn({
      'knowledge:shared': [
        { key: 'c:0', value: 'chunk text', score: 0.85, metadata: { filePath: 'readme.md', chunkIndex: 0 } },
      ],
      'knowledge:my-agent': [],
    });

    const retriever = new KnowledgeRetriever(searchFn, store);
    const result = await retriever.retrieveForTask('my-agent', 'query');

    expect(result.formattedContext).toContain('## Relevant Knowledge Base Excerpts');
    expect(result.formattedContext).toContain('1.');
    expect(result.formattedContext).toContain('readme.md');
    expect(result.formattedContext).toContain('0.85');
    expect(result.formattedContext).toContain('chunk text');
  });

  it('respects maxChunks limit', async () => {
    const dir = makeTmpDir();
    const store = new KnowledgeStore(dir);

    const manyResults = Array.from({ length: 20 }, (_, i) => ({
      key: `k:${i}`,
      value: `text ${i}`,
      score: 1 - i * 0.01,
      metadata: { filePath: `f${i}.txt`, chunkIndex: 0 },
    }));

    const searchFn = makeSearchFn({
      'knowledge:shared': manyResults.slice(0, 10),
      'knowledge:coder': manyResults.slice(10),
    });

    const retriever = new KnowledgeRetriever(searchFn, store);
    const result = await retriever.retrieveForTask('coder', 'query', 4);

    expect(result.excerpts.length).toBeLessThanOrEqual(4);
  });
});
