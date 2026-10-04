// P3.11 parity: the runtime org_doc_check (packages/@monomind/cli/src/orgrt/documents/) against the prototype
// pilot__doc_check that was measured (tools.ts, store.ts here), driven through both real tool handlers on the
// same documents: the honest sheets and the three seeds of injected faults (wrong value against its evidence,
// reversed files, a copied sheet). What a consumer can observe must agree: which documents are flagged, which
// answers and which checks, the document-level failures, and the count of answers. Where the runtime differs on
// purpose (result shape, `passed` as a verdict, paging, the call record) a test says so. No model, no corpus.
// @ts-nocheck: the prototype modules are loosely typed fixtures
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DOCS,
  honestDoc,
  sweepChecksOrg,
  V2,
  worker,
} from '../../../../packages/@monomind/cli/__tests__/orgrt/support/check-defs.js';
import { openDocumentsRuntime } from '../../../../packages/@monomind/cli/src/orgrt/documents/runtime.js';
import { documentTools } from '../../../../packages/@monomind/cli/src/orgrt/documents/tools-core.js';
import { OrgDefSchema } from '../../../../packages/@monomind/cli/src/orgrt/types.js';
import { faultInjector, planFaults } from './fault-injection.js';
import { HandoffStore } from './store.js';
import { pilotTools } from './tools.js';

const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'check-parity-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// The harness store without the deliverable files (they need a workspace; the checks do not read files).
const CONTRACTS = V2.map(({ deliverables: _d, ...c }) => c);

async function both(seed: number | null) {
  const plan = seed === null ? undefined : planFaults(seed, DOCS);
  const proto = new HandoffStore(
    mkdtempSync(join(root, 'p-')),
    CONTRACTS,
    undefined,
    plan ? faultInjector(plan) : undefined,
    {},
  );
  const rt = openDocumentsRuntime({
    def: OrgDefSchema.parse(sweepChecksOrg()),
    orgDir: mkdtempSync(join(root, 'r-')),
    run: 'parity',
  })!;
  const inj = plan ? faultInjector(plan) : undefined;
  const call = async (tools, name, args) => JSON.parse((await tools.find((t) => t.name === name).handler(args)).text);
  for (const doc of DOCS) {
    const p = await call(pilotTools(proto, worker(doc)), 'pilot__doc_publish', { doc_id: doc, content: honestDoc(doc) });
    const body = inj?.apply(doc, honestDoc(doc))?.content ?? honestDoc(doc);
    const r = await call(documentTools(rt.forRole(worker(doc))), 'org_doc_publish', { type: doc, body });
    expect([p.ok, r.ok]).toEqual([true, true]);
  }
  const results = {};
  for (const doc of DOCS)
    results[doc] = {
      p: await call(pilotTools(proto, 'synthesiser'), 'pilot__doc_check', { doc_id: doc }),
      r: await call(documentTools(rt.forRole('synthesiser')), 'org_doc_check', { id: `${doc}-1` }),
    };
  return { plan, results, proto, rt };
}

/** What a consumer observes, in a shape both sides can produce. */
const observed = ({ p, r }) => ({
  proto: {
    answers: p.answers,
    flagged: p.flagged.map((x) => [x.sheet, x.q, x.failed.map((y) => y.check)]),
    doc_level: p.doc_level.map((x) => x.check),
  },
  runtime: {
    answers: r.answers,
    flagged: r.flagged.map((x) => [x.sheet, x.q, x.failed.map((y) => y.check)]),
    doc_level: r.document_failures.map((x) => x.check),
  },
});

describe('doc_check and org_doc_check agree on the measured fault classes', () => {
  for (const seed of [20261004, 20261005, 7]) {
    it(`flag the same documents, answers and checks on the injected faults (seed ${seed})`, async () => {
      const { plan, results } = await both(seed);
      const flaggedDocs = [];
      for (const doc of DOCS) {
        const o = observed(results[doc]);
        expect(o.runtime, doc).toEqual(o.proto);
        expect(results[doc].r.passed, doc).toBe(o.runtime.flagged.length === 0 && o.runtime.doc_level.length === 0);
        if (!results[doc].r.passed) flaggedDocs.push(doc);
      }
      expect(flaggedDocs.sort()).toEqual(plan.faults.map((f) => f.doc).sort());
      for (const f of plan.faults) {
        const checks = results[f.doc].r.flagged.flatMap((x) => x.failed.map((y) => y.check));
        const doc_level = results[f.doc].r.document_failures.map((x) => x.check);
        if (f.class.startsWith('wrong-value')) expect(checks).toEqual(['value_matches_chain']);
        if (f.class === 'files-order') expect(new Set(checks)).toEqual(new Set(['files_match_evidence']));
        if (f.class === 'duplicate-sheet') expect(doc_level).toEqual(['unique_across_sheets']);
      }
    });
  }

  it('flag nothing on the honest sheets, on either side', async () => {
    const { results } = await both(null);
    for (const doc of DOCS) {
      const o = observed(results[doc]);
      expect(o.proto).toEqual({ answers: 48, flagged: [], doc_level: [] });
      expect(o.runtime).toEqual(o.proto);
      expect(results[doc].r).toMatchObject({ passed: true, flagged_count: 0 });
    }
  });

  it('say the same thing about their own limits, and record the call', async () => {
    const { results, proto, rt } = await both(20261004);
    const { p, r } = results[DOCS[0]];
    expect(p.note).toMatch(/do not prove it right/);
    expect(r.note).toMatch(/necessary but not sufficient/);
    expect(proto.events().filter((e) => e.kind === 'check')).toHaveLength(8);
    expect(rt.checks.counts()).toMatchObject({ calls: 8, ran: 8, refused: 0, calls_flagging: 4 });
  });

  it('refuse the same callers: a producer of another document is neither a reader nor a checker', async () => {
    const { proto, rt } = await both(null);
    const p = JSON.parse(
      (await pilotTools(proto, 'worker-1').find((t) => t.name === 'pilot__doc_check').handler({ doc_id: DOCS[1] })).text,
    );
    const r = JSON.parse(
      (await documentTools(rt.forRole('worker-1')).find((t) => t.name === 'org_doc_check').handler({ id: `${DOCS[1]}-1` })).text,
    );
    expect([p.ok, r.ok]).toEqual([false, false]);
    expect(r.code).toBe('ACCESS_READ');
  });
});
