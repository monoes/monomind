// P4.13: hand-written runtime records of a finished trial, for the scripted (no daemon, no model) tests of the Phase 4
// eval-tree parity. `phase3Root` is a trial root with only the records the Phase 3 runtime leaves (the event log, the
// notice journal, the check journal, the bus); `addPhase4Records` adds the records the Phase 4 keys leave. The shapes are
// the runtime's own (documents/store-types.ts, notice-journal.ts, section-budget-notice.ts, part-journal.ts, and the bus
// audit events of writer-engine.ts, unread-watch-run.ts and lead-watch.ts); nothing here is a model's output.
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ORG = 'p413-org';
const T = (s: number) => new Date(Date.UTC(2026, 9, 4, 10, 0, 0) + s * 1000).toISOString();
const jl = (rows: unknown[]) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

/** A temp trial root with the Phase 3 runtime records of one document, rejected once and then accepted. */
export function phase3Root(tag = 'p413'): string {
  const root = mkdtempSync(join(process.env.TMPDIR ?? '/var/tmp', `${tag}-`));
  const org = join(root, '.monomind/orgs', ORG);
  const docs = join(org, 'docs/run-a');
  const doc = 'module-sheets-w1-1';
  const type = 'module-sheets-w1';
  mkdirSync(join(docs, 'sweep-a', type), { recursive: true });
  mkdirSync(join(org, 'run-1'), { recursive: true });
  const pub = (seq: number, version: number, s: number) => ({
    seq,
    type: 'published',
    doc,
    doc_type: type,
    section: 'sweep-a',
    version,
    by: 'worker-1',
    at: T(s),
  });
  writeFileSync(
    join(docs, 'events.jsonl'),
    jl([
      pub(1, 1, 1),
      { seq: 2, type: 'read', doc, version: 1, by: 'synthesiser', at: T(2) },
      {
        seq: 3,
        type: 'decided',
        doc,
        version: 1,
        by: 'synthesiser',
        decision: 'reject',
        reason: 'q05 is wrong',
        status_after: 'rejected',
        at: T(3),
      },
      pub(4, 2, 4),
      { seq: 5, type: 'read', doc, version: 2, by: 'synthesiser', at: T(5) },
      {
        seq: 6,
        type: 'decided',
        doc,
        version: 2,
        by: 'synthesiser',
        decision: 'accept',
        status_after: 'accepted',
        at: T(6),
      },
    ]),
  );
  for (const v of [1, 2])
    writeFileSync(
      join(docs, 'sweep-a', type, `${doc}@v${v}.json`),
      JSON.stringify({ body: { worker: 'worker-1', sheets: [] } }),
    );
  writeFileSync(
    join(docs, 'notices.jsonl'),
    jl([
      { t: 'delivered', key: 'p:1:synthesiser', at: T(1.5), receipt: 'r1' },
      { t: 'delivered', key: 'r:3:producer', at: T(3.5), receipt: 'r2' },
      { t: 'delivered', key: 'r:3:lead', at: T(3.6), receipt: 'r3' },
      { t: 'delivered', key: 'p:4:synthesiser', at: T(4.5), receipt: 'r4' },
    ]),
  );
  writeFileSync(
    join(docs, 'checks.jsonl'),
    jl([
      {
        at: T(2.5),
        by: 'synthesiser',
        ok: true,
        ref: `${doc}@v1`,
        type,
        answers: 4,
        flagged: 1,
        per_check: { c1: 1 },
      },
    ]),
  );
  writeFileSync(
    join(org, 'run-1/bus.jsonl'),
    jl([
      { type: 'tool', from: 'worker-1', ts: 1_000, data: {} },
      { type: 'usage', from: 'worker-1', ts: 2_000, data: { cost_usd: 0.5 } },
      { type: 'usage', from: 'synthesiser', ts: 3_000, data: { cost_usd: 0.25 } },
    ]),
  );
  return root;
}

/** The records of the Phase 4 keys, added to a root made by `phase3Root`. Returns the counts they stand for. */
export function addPhase4Records(root: string): void {
  const org = join(root, '.monomind/orgs', ORG);
  const docs = join(org, 'docs/run-a');
  const owed = (key: string, kind: string, scope: string, to: string, at: string) => ({
    t: 'owed',
    key: `${key}>${to}`,
    at,
    seq: 0,
    kind,
    audience: 'lead',
    to,
    subject: `${kind} ${scope}`,
    body: 'budget text',
    doc: key,
    version: 0,
  });
  // the section budget journal: one warning and one closure, each to the lead and the root; one delivery failed
  const rows: unknown[] = [];
  for (const to of ['worker-1', 'lead'])
    rows.push(owed('warn:sweep-a:30', 'section-budget-warning', 'sweep-a', to, T(7)));
  for (const to of ['worker-1', 'lead'])
    rows.push(owed('closed:sweep-a:30', 'section-budget-closed', 'sweep-a', to, T(8)));
  rows.push(
    { t: 'delivered', key: 'warn:sweep-a:30>worker-1', at: T(7.1), receipt: 'b1' },
    { t: 'delivered', key: 'warn:sweep-a:30>lead', at: T(7.1), receipt: 'b2' },
    { t: 'delivered', key: 'closed:sweep-a:30>worker-1', at: T(8.1), receipt: 'b3' },
    { t: 'failed', key: 'closed:sweep-a:30>lead', at: T(8.1), error: 'mailbox closed' },
  );
  writeFileSync(join(docs, 'budget-notices.jsonl'), jl(rows));
  // the exhaustion notices ride the P3.8 delivery journal: one rework cycle and one loop, each to three recipients
  const doc = 'module-sheets-w1-1';
  appendFileSync(
    join(docs, 'notices.jsonl'),
    jl([
      ...['lead', 'worker-1', 'synthesiser'].map((to, i) => ({
        t: 'delivered',
        key: `x:${doc}|synthesiser|2@6:${to}`,
        at: T(9 + i / 10),
        receipt: `x${i}`,
      })),
      ...['lead', 'worker-1', 'synthesiser'].map((to, i) => ({
        t: 'delivered',
        key: `l:sweep-a+synthesis|${doc}@v1|2@6:${to}`,
        at: T(10 + i / 10),
        receipt: `l${i}`,
      })),
    ]),
  );
  writeFileSync(
    join(docs, 'part-reads.jsonl'),
    jl([
      { at: T(2), by: 'synthesiser', doc, version: 1, part: 1, parts: 2 },
      { at: T(2.1), by: 'synthesiser', doc, version: 1, part: 2, parts: 2 },
      { at: T(5), by: 'synthesiser', doc, version: 2, part: 1, parts: 1 },
    ]),
  );
  appendFileSync(
    join(org, 'run-1/bus.jsonl'),
    jl([
      {
        type: 'audit',
        from: 'worker-2',
        reason: 'writer-refused',
        msg: 'not yours',
        ts: 4_000,
        data: { tool: 'Write', path: 'x' },
      },
      {
        type: 'audit',
        from: 'worker-2',
        reason: 'writer-refused',
        msg: 'not yours',
        ts: 4_100,
        data: { tool: 'Edit', path: 'y' },
      },
      {
        type: 'audit',
        from: 'org-docs',
        reason: 'doc-unread',
        msg: 'told lead',
        ts: 5_000,
        data: { key: 'k1', doc, to: 'lead' },
      },
      {
        type: 'audit',
        reason: 'lead-watch',
        msg: 'told lead',
        ts: 6_000,
        data: { role: 'worker-2', kind: 'silent', taskIds: ['t1'] },
      },
      {
        type: 'audit',
        reason: 'lead-watch',
        msg: 'told lead',
        ts: 6_100,
        data: { role: 'worker-2', kind: 'not-started', taskIds: ['t2'] },
      },
    ]),
  );
}

/** A corpus truth the metrics can be computed against (one module, one question). */
export const truth = () => ({ modules: { m1: { q01: { value: 1, files: ['a.ts'] } } } });
