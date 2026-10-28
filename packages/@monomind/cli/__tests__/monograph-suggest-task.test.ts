/**
 * monograph_suggest with task= (#406).
 *
 * Suggest used to answer only from AMBIGUOUS/INFERRED edges (~3% of a real
 * graph), so on a built graph most task descriptions got "No suggestions for
 * this task. Run monograph_build first." It must return task-ranked nodes,
 * and say "run monograph_build" only when the graph is actually empty.
 *
 * Real SQLite graph + real @monoes/monograph, no mocks.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, insertEdge, insertNode, openDb } from '@monoes/monograph';

const originalCwdEnv = process.env.MONOMIND_CWD;
const dirs: string[] = [];

function makeRepo(populate: boolean): string {
  const repoDir = mkdtempSync(join(tmpdir(), 'mono-suggest-'));
  dirs.push(repoDir);
  mkdirSync(join(repoDir, '.monomind'), { recursive: true });
  const db = openDb(join(repoDir, '.monomind', 'monograph.db'));
  if (populate) {
    insertNode(db, {
      id: 'cls_payment_processor',
      label: 'Class',
      name: 'PaymentProcessor',
      normLabel: 'paymentprocessor',
      filePath: 'src/payments/processor.ts',
      startLine: 10,
      isExported: true,
      language: 'typescript',
    } as never);
    insertNode(db, {
      id: 'fn_log_payment',
      label: 'Function',
      name: 'logPayment',
      normLabel: 'logpayment',
      filePath: 'src/payments/log.ts',
      startLine: 20,
      isExported: false,
      language: 'typescript',
    } as never);
    // Only EXPLICIT edges — the case that used to produce "run build".
    insertEdge(db, {
      id: 'e_proc_log',
      sourceId: 'cls_payment_processor',
      targetId: 'fn_log_payment',
      relation: 'CALLS',
      confidence: 'EXPLICIT',
      confidenceScore: 1,
    } as never);
  }
  closeDb(db);
  return repoDir;
}

async function suggest(repoDir: string, input: Record<string, unknown>): Promise<string> {
  process.env.MONOMIND_CWD = repoDir;
  const { monographSuggestTool } = await import('../src/mcp-tools/monograph/query-tools-search.js');
  const out = await monographSuggestTool.handler({ checkStaleness: false, ...input });
  return (out as { content: Array<{ text: string }> }).content[0].text;
}

let builtRepo: string;
let emptyRepo: string;

beforeAll(() => {
  builtRepo = makeRepo(true);
  emptyRepo = makeRepo(false);
});

afterAll(() => {
  if (originalCwdEnv === undefined) delete process.env.MONOMIND_CWD;
  else process.env.MONOMIND_CWD = originalCwdEnv;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('monograph_suggest task= (#406)', () => {
  it('returns task-ranked nodes with file:line on a built graph with only EXPLICIT edges', async () => {
    const out = await suggest(builtRepo, { task: 'fix PaymentProcessor logging' });
    expect(out).not.toMatch(/monograph_build/);
    expect(out).toMatch(/PaymentProcessor\s+src\/payments\/processor\.ts:10/);
    expect(out.indexOf('PaymentProcessor')).toBeLessThan(
      out.indexOf('logPayment') === -1 ? Infinity : out.indexOf('logPayment'),
    );
  });

  it('caps results at limit', async () => {
    const out = await suggest(builtRepo, { task: 'PaymentProcessor logPayment', limit: 1 });
    const nodeLines = out.split('\n').filter((l) => /^\s+\[(Class|Function)\]/.test(l));
    expect(nodeLines).toHaveLength(1);
  });

  it('says the task matched nothing — not "run build" — on a built graph', async () => {
    const out = await suggest(builtRepo, { task: 'zzzznotpresentzzzz' });
    expect(out).toMatch(/No nodes match this task/);
    expect(out).not.toMatch(/monograph_build/);
  });

  it('says "no relevant match" when the hits only share one stray word with the task', async () => {
    const out = await suggest(builtRepo, { task: 'payment gateway scheduler retries' });
    expect(out).toMatch(/No relevant match/);
    expect(out).not.toMatch(/\[(Class|Function)\]/);
  });

  it('tells the caller to build when the graph is empty', async () => {
    const withTask = await suggest(emptyRepo, { task: 'PaymentProcessor' });
    expect(withTask).toMatch(/Run monograph_build first/);
    const noTask = await suggest(emptyRepo, {});
    expect(noTask).toMatch(/Run monograph_build first/);
  });

  it('without task on a built graph with no open questions, does not claim it is unbuilt', async () => {
    const out = await suggest(builtRepo, {});
    expect(out).not.toMatch(/monograph_build/);
  });
});
