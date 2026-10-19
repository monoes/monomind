import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type Embedder,
  embeddingStatus,
  embedPending,
  quantize,
  semanticSearch,
} from '../../embeddings/store.js';
import { searchGraphFused } from '../../search/fused-search.js';
import { searchGraph } from '../../search/hybrid-query.js';
import { openDb } from '../../storage/db.js';

// A toy embedding space whose axes are concepts, each reachable by several
// words — so "worker" and "agent" land together although they share no letters.
const CONCEPTS = [
  ['agent', 'worker', 'handler', 'assignee'],
  ['task', 'job', 'work', 'ticket'],
  ['graph', 'network', 'node', 'edge'],
  ['test', 'check', 'verify', 'spec'],
];

function vectorOf(text: string): Float32Array {
  const words = text.toLowerCase().split(/[^a-z]+/);
  const v = new Float32Array(CONCEPTS.length + 1);
  CONCEPTS.forEach((syn, i) => {
    v[i] = words.filter((w) => syn.includes(w.replace(/s$/, ''))).length;
  });
  v[CONCEPTS.length] = 0.01;
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm) as Float32Array;
}

function fakeEmbedder(model = 'toy-1', calls: string[][] = []): Embedder {
  return {
    model,
    dim: CONCEPTS.length + 1,
    embedPassages: async (texts) => {
      calls.push(texts);
      return texts.map(vectorOf);
    },
    embedQuery: async (q) => vectorOf(q),
  };
}

describe('semantic index', () => {
  let dir: string;
  let db: Database.Database;

  const addNode = (
    id: string,
    name: string,
    summary: string,
    label = 'Function',
    file = `src/${id}.ts`,
  ) => {
    db.prepare(
      'INSERT INTO nodes (id, label, name, norm_label, file_path, start_line) VALUES (?, ?, ?, ?, ?, 1)',
    ).run(id, label, name, name.toLowerCase(), file);
    db.prepare('INSERT INTO node_summaries_fts (node_id, text) VALUES (?, ?)').run(id, summary);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'semantic-'));
    db = openDb(join(dir, 'g.db'));
    addNode('a', 'dispatchJob', 'dispatch Job decide which worker takes it');
    addNode('b', 'renderGraph', 'render Graph network nodes and edges');
    addNode('c', 'runChecks', 'run Checks verify the spec');
    addNode('d', 'UserService', 'User Service');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('embeds every summary once and is idempotent', async () => {
    const calls: string[][] = [];
    const first = await embedPending(db, fakeEmbedder('toy-1', calls));
    expect(first).toEqual({ embedded: 4, remaining: 0 });
    expect(embeddingStatus(db)).toEqual({ total: 4, embedded: 4, model: 'toy-1' });
    const second = await embedPending(db, fakeEmbedder('toy-1', calls));
    expect(second).toEqual({ embedded: 0, remaining: 0 });
    expect(calls.flat()).toHaveLength(4);
  });

  it('re-embeds only the summaries whose text changed, and drops vectors of removed ones', async () => {
    await embedPending(db, fakeEmbedder());
    db.prepare(
      "UPDATE node_summaries_fts SET text = 'run Checks verify spec and test' WHERE node_id = 'c'",
    ).run();
    db.prepare("DELETE FROM node_summaries_fts WHERE node_id = 'd'").run();
    const calls: string[][] = [];
    const r = await embedPending(db, fakeEmbedder('toy-1', calls));
    expect(r.embedded).toBe(1);
    expect(calls.flat()).toEqual(['run Checks verify spec and test']);
    expect(embeddingStatus(db).embedded).toBe(3);
  });

  it('discards vectors made by a different model', async () => {
    await embedPending(db, fakeEmbedder('toy-1'));
    const calls: string[][] = [];
    await embedPending(db, fakeEmbedder('toy-2', calls));
    expect(calls.flat()).toHaveLength(4);
    expect(embeddingStatus(db).model).toBe('toy-2');
  });

  it('stops at its time budget and resumes where it left off', async () => {
    const slow: Embedder = {
      ...fakeEmbedder(),
      embedPassages: async (t) => {
        await new Promise((r) => setTimeout(r, 30));
        return t.map(vectorOf);
      },
    };
    const part = await embedPending(db, slow, { batchSize: 1, maxMs: 40 });
    expect(part.embedded).toBeGreaterThan(0);
    expect(part.remaining).toBeGreaterThan(0);
    const rest = await embedPending(db, fakeEmbedder(), { batchSize: 1 });
    expect(rest.remaining).toBe(0);
    expect(embeddingStatus(db).embedded).toBe(4);
  });

  it('ranks by similarity and honours a label filter', async () => {
    await embedPending(db, fakeEmbedder());
    const hits = semanticSearch(db, vectorOf('who is the agent for a job'), 3);
    expect(hits[0].name).toBe('dispatchJob');
    expect(semanticSearch(db, vectorOf('agent job'), 3, 'Class')).toEqual([]);
  });

  it('keeps vectors well inside int8 range', () => {
    const q = quantize(vectorOf('agent task'));
    expect(q.length).toBe(CONCEPTS.length + 1);
    expect(
      [...new Int8Array(q.buffer, q.byteOffset, q.length)].every((x) => Math.abs(x) <= 127),
    ).toBe(true);
  });
});

describe('searchGraphFused', () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fused-'));
    db = openDb(join(dir, 'g.db'));
    const add = (id: string, name: string, summary: string) => {
      db.prepare(
        "INSERT INTO nodes (id, label, name, norm_label, file_path, start_line) VALUES (?, 'Function', ?, ?, ?, 1)",
      ).run(id, name, name.toLowerCase(), `src/${id}.ts`);
      db.prepare('INSERT INTO node_summaries_fts (node_id, text) VALUES (?, ?)').run(id, summary);
    };
    add('a', 'dispatchJob', 'dispatch Job decide which worker takes it');
    add('b', 'renderGraph', 'render Graph network nodes and edges');
    add('c', 'jobLog', 'job Log');
    add('d', 'worker', 'worker');
    await embedPending(db, fakeEmbedder());
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('is plain lexical search without an embedder', async () => {
    const plain = searchGraph(db, 'which agent takes a job', { limit: 5 });
    const fused = await searchGraphFused(db, 'which agent takes a job', { limit: 5 });
    expect(fused.map((r) => r.id)).toEqual(plain.map((r) => r.id));
  });

  it('finds a symbol whose words never appear in the question', async () => {
    const lexical = await searchGraphFused(db, 'which assignee picks up a ticket', { limit: 3 });
    expect(lexical.find((r) => r.id === 'a')).toBeUndefined();
    const fused = await searchGraphFused(db, 'which assignee picks up a ticket', {
      limit: 3,
      embedder: fakeEmbedder(),
    });
    expect(fused[0].id).toBe('a');
    expect(fused[0].matchStrategy).toBe('semantic');
  });

  it('pins an exact name match first even when the semantic lane disagrees', async () => {
    const fused = await searchGraphFused(db, 'worker', { limit: 3, embedder: fakeEmbedder() });
    expect(fused[0].name).toBe('worker');
  });

  it("never drops keyword search's best hit in favour of the semantic lane", async () => {
    // "job" is the only word the question shares with jobLog; semantically it is far from it.
    const embedder = fakeEmbedder();
    const fused = await searchGraphFused(db, 'which assignee takes the job log', {
      limit: 2,
      embedder,
    });
    const lexicalTop = searchGraph(db, 'which assignee takes the job log', { limit: 1 })[0];
    expect(fused.map((r) => r.id)).toContain(lexicalTop.id);
    expect(fused).toHaveLength(2);
  });

  it('falls back to lexical results if the embedder fails', async () => {
    const broken: Embedder = {
      ...fakeEmbedder(),
      embedQuery: async () => {
        throw new Error('model gone');
      },
    };
    const fused = await searchGraphFused(db, 'renderGraph', { limit: 3, embedder: broken });
    expect(fused[0].name).toBe('renderGraph');
  });

  it('keeps scores in 0..1 and ordered', async () => {
    const fused = await searchGraphFused(db, 'agent for a task', {
      limit: 4,
      embedder: fakeEmbedder(),
    });
    for (const r of fused) expect(r.relevance).toBeGreaterThanOrEqual(0);
    for (const r of fused) expect(r.relevance).toBeLessThanOrEqual(1.0001);
    expect(fused.map((r) => r.relevance)).toEqual(
      [...fused.map((r) => r.relevance)].sort((x, y) => y - x),
    );
  });
});
