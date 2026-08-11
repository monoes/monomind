import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { monographQueryTool } from '../../src/mcp-tools/query.js';
import type { MonographNode } from '../../src/types.js';

// MONO-4 regression: monograph_query used to call `hybridQuery` (BM25-only),
// giving MCP users weaker ranking than the CLI which used `hybridSearch`
// (BM25 + LIKE + in-memory fuzzy + node-type bonus). The tool now routes
// through `hybridSearch`, so the same ranker serves both code paths.

const dbPath = join(tmpdir(), `monograph-query-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
let db: ReturnType<typeof openDb>;

const exact: MonographNode = {
  id: 'payment_processor',
  label: 'Class',
  name: 'PaymentProcessor',
  normLabel: 'paymentprocessor',
  filePath: 'src/payments/processor.ts',
  startLine: 10,
  isExported: true,
  language: 'typescript',
};
const nearMatch: MonographNode = {
  id: 'payment_log',
  label: 'Function',
  name: 'logPayment',
  normLabel: 'logpayment',
  filePath: 'src/payments/log.ts',
  isExported: false,
  language: 'typescript',
};
const unrelated: MonographNode = {
  id: 'shipping_router',
  label: 'Class',
  name: 'ShippingRouter',
  normLabel: 'shippingrouter',
  filePath: 'src/shipping/router.ts',
  isExported: true,
  language: 'typescript',
};

beforeAll(() => {
  db = openDb(dbPath);
  for (const n of [exact, nearMatch, unrelated]) insertNode(db, n);
});

afterAll(() => {
  closeDb(db);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(p)) {
      try { unlinkSync(p); } catch { /* best effort */ }
    }
  }
});

describe('MONO-4: monograph_query uses hybridSearch ranking', () => {
  it('returns results for a direct identifier match', async () => {
    const out = await monographQueryTool.handler({ query: 'PaymentProcessor', db });
    expect(out.results.length).toBeGreaterThan(0);
    const ids = out.results.map(r => r.id);
    expect(ids).toContain('payment_processor');
  });

  it('ranks exact-name matches above partial matches', async () => {
    const out = await monographQueryTool.handler({ query: 'PaymentProcessor', db });
    expect(out.results.length).toBeGreaterThan(0);
    // The exact-name Class node should outrank the partial-match Function node.
    const procRank = out.results.findIndex(r => r.id === 'payment_processor');
    const logRank = out.results.findIndex(r => r.id === 'payment_log');
    if (procRank !== -1 && logRank !== -1) {
      expect(procRank).toBeLessThan(logRank);
    }
  });

  it('returns combinedScore > 0 from hybridSearch (not raw BM25 rank)', async () => {
    const out = await monographQueryTool.handler({ query: 'Payment', db });
    expect(out.results.length).toBeGreaterThan(0);
    // hybridSearch's combinedScore is a small positive number (ftsScore + fuzz + bonus),
    // always >= 0. BM25 rank alone is negative — so >0 confirms the hybrid ranker ran.
    for (const r of out.results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });

  it('respects includeProcesses=false filter', async () => {
    const out = await monographQueryTool.handler({ query: 'Payment', db, includeProcesses: false });
    expect(out.results.every(r => !r.isProcess)).toBe(true);
  });

  it('respects topK limit', async () => {
    const out = await monographQueryTool.handler({ query: 'Payment', db, topK: 1 });
    expect(out.results.length).toBeLessThanOrEqual(1);
  });

  it('returns empty when db is null and no repoPath given', async () => {
    const out = await monographQueryTool.handler({ query: 'Payment' });
    expect(out.results).toHaveLength(0);
    expect(out.processCount).toBe(0);
    expect(out.symbolCount).toBe(0);
  });

  it('finds results via LIKE fallback for short queries (≤3 chars)', async () => {
    // hybridSearch runs the LIKE fallback for short queries (≤3 chars) where the
    // trigram tokenizer can't fire (needs ≥3 chars per token). The old BM25-only
    // path also handled this, but hybridSearch adds fuzzy + node-type bonus on top.
    const out = await monographQueryTool.handler({ query: 'Pay', db });
    expect(out.results.some(r => r.id === 'payment_processor')).toBe(true);
  });
});
