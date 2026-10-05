// P3.11: org_doc_check over a real documents runtime (real store on disk), role-bound. The checks are the P3.4
// ones (checks.test.ts holds their unit cases); here: when the tool exists, who may call it, version selection,
// the result shape and its paging, the durable call record, and that a check changes no document state.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OrgToolDef } from '../../../src/orgrt/agent-runner.js';
import { CheckJournal } from '../../../src/orgrt/documents/check-journal.js';
import { type DocumentsRuntime, openDocumentsRuntime } from '../../../src/orgrt/documents/runtime.js';
import { errorRemedy, TOOL_ERROR_CODES } from '../../../src/orgrt/documents/tool-errors.js';
import { documentTools } from '../../../src/orgrt/documents/tools-core.js';
import { toolInputSchema } from '../../../src/orgrt/tool-fence.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { FINDINGS, findingsOrg, role, SOURCE } from '../support/doc-defs.js';
import { readAllParts } from '../support/doc-runner.js';
import { DOCS, faulted, honestDoc, sweepChecksOrg, worker } from '../support/check-defs.js';

const tmp = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'doc-check-'));
const open = (raw = sweepChecksOrg()): DocumentsRuntime =>
  openDocumentsRuntime({ def: OrgDefSchema.parse(raw), orgDir: tmp(), run: 'run-1' })!;

class Caller {
  readonly tools: OrgToolDef[];
  constructor(
    readonly rt: DocumentsRuntime,
    readonly role: string,
  ) {
    this.tools = documentTools(rt.forRole(role)).map((t) => ({ ...t, strict: {} }));
  }
  async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const t = this.tools.find((x) => x.name === name)!;
    const parsed = toolInputSchema(t).safeParse(args);
    if (!parsed.success) return { schema_error: parsed.error.issues.map((i) => i.message).join('; ') };
    return JSON.parse((await t.handler(parsed.data)).text);
  }
  check = (a: Record<string, unknown>) => this.call('org_doc_check', a);
}
const as = (rt: DocumentsRuntime, r: string) => new Caller(rt, r);
/** Every part of a version read: org_doc_decide refuses until then (P3.16b). */
const readAll = (c: Caller, docId: string, version: number) =>
  readAllParts((n, a) => c.call(n, a), { id: docId, version });
const id = (doc: string) => `${doc}-1`;

/** Publish every document (honest, or the harness-faulted body of a seed). */
async function publishAll(rt: DocumentsRuntime, seed?: number) {
  const f = seed === undefined ? undefined : faulted(seed);
  for (const doc of DOCS) {
    const r = await as(rt, worker(doc)).call('org_doc_publish', {
      type: doc,
      body: f ? f.body(doc) : honestDoc(doc),
    });
    expect(r, doc).toMatchObject({ ok: true, version: 1 });
  }
  return f;
}

describe('when the tool exists', () => {
  it('is listed last for every role of an org whose contracts declare checks, and not otherwise', () => {
    const rt = open();
    for (const r of ['lead', 'worker-1', 'worker-8', 'synthesiser']) {
      const names = documentTools(rt.forRole(r)).map((t) => t.name);
      expect(names, r).toEqual(['org_doc_list', 'org_doc_read', 'org_doc_publish', 'org_doc_decide', 'org_doc_check']);
    }
    const plain = open(findingsOrg({ qa: true }));
    expect(documentTools(plain.forRole('coder')).map((t) => t.name)).toEqual([
      'org_doc_list',
      'org_doc_read',
      'org_doc_publish',
      'org_doc_decide',
    ]);
    expect(plain.forRole('coder').check).toBeUndefined();
  });

  it('exists as soon as one of several contracts declares checks, and refuses a type that declares none', async () => {
    const rt = open(sweepChecksOrg((raw) => delete raw.documents[DOCS[1]].checks));
    await publishAll(rt);
    expect(documentTools(rt.forRole('synthesiser')).map((t) => t.name)).toContain('org_doc_check');
    expect(await as(rt, 'synthesiser').check({ id: id(DOCS[1]) })).toMatchObject({
      ok: false,
      code: 'NO_CHECKS',
    });
    expect(await as(rt, 'synthesiser').check({ id: id(DOCS[0]) })).toMatchObject({ ok: true });
  });

  it('is strict, carries no role argument, and names the new refusal code with a remedy', () => {
    const t = documentTools(open().forRole('synthesiser')).find((x) => x.name === 'org_doc_check')!;
    expect(Object.keys(t.schema).sort()).toEqual(['id', 'part', 'version']);
    expect(t.description).toMatch(/necessary, not sufficient/);
    expect(TOOL_ERROR_CODES).toContain('NO_CHECKS');
    expect(errorRemedy('NO_CHECKS')).not.toBe('Report this to your lead.');
  });

  it('a role argument cannot override the authenticated role', async () => {
    const rt = open();
    await publishAll(rt);
    const r = await as(rt, 'worker-2').call('org_doc_check', { id: id(DOCS[0]), role: 'synthesiser' });
    expect(r.schema_error).toMatch(/unknown argument "role"/);
  });
});

describe('the result on honest sheets', () => {
  it('passes every check, names none, lists the declared checks with zero failures and carries the note', async () => {
    const rt = open();
    await publishAll(rt);
    for (const doc of DOCS) {
      const r = await as(rt, 'synthesiser').check({ id: id(doc) });
      expect(r, doc).toMatchObject({
        ok: true,
        ref: `${id(doc)}@v1`,
        version: 1,
        type: doc,
        status: 'pending',
        passed: true,
        answers: 48,
        flagged_count: 0,
        document_failure_count: 0,
        part: 1,
        parts: 1,
        flagged: [],
        document_failures: [],
        per_check: {
          value_type: 0,
          files_match_evidence: 0,
          value_matches_chain: 0,
          files_in_module: 0,
          unique_across_sheets: 0,
        },
      });
      expect(r.note).toMatch(/necessary but not sufficient/);
      expect(JSON.stringify(r).length).toBeLessThanOrEqual(8000);
    }
  });
});

describe('the result on faulted sheets (the measured fault classes, three seeds)', () => {
  for (const seed of [20261004, 20261005, 7]) {
    it(`flags exactly the faulted documents and names the failing check (seed ${seed})`, async () => {
      const rt = open();
      const f = await publishAll(rt, seed);
      const flagged: Record<string, any> = {};
      for (const doc of DOCS) {
        const r = await as(rt, 'synthesiser').check({ id: id(doc) });
        if (!r.passed) flagged[doc] = r;
      }
      expect(Object.keys(flagged).sort()).toEqual(f!.plan.faults.map((x) => x.doc).sort());
      for (const fault of f!.plan.faults) {
        const r = flagged[fault.doc];
        if (fault.class.startsWith('wrong-value')) {
          expect(r.flagged).toHaveLength(1);
          expect(r.flagged[0].failed.map((x: any) => x.check)).toEqual(['value_matches_chain']);
          expect(r.flagged[0].failed[0].message).toMatch(/not what the entry file's evidence returns/);
          expect(r.per_check.value_matches_chain).toBe(1);
        } else if (fault.class === 'files-order') {
          expect(r.flagged.map((x: any) => x.q)).toEqual(['q01', 'q02']);
          expect(r.flagged[0].failed[0].check).toBe('files_match_evidence');
        } else {
          expect(r.document_failures[0]).toMatchObject({ check: 'unique_across_sheets' });
          expect(r.document_failure_count).toBe(1);
          expect(r.flagged.every((x: any) => x.failed.some((y: any) => y.check === 'files_in_module'))).toBe(true);
        }
        expect(r.flagged.every((x: any) => x.answer === `${x.sheet}/${x.q}`)).toBe(true);
      }
    });
  }
});

describe('access: who may check a version is who may read it', () => {
  const orgWithAnalyst = () =>
    sweepChecksOrg((raw) => {
      raw.roles.push(role('analyst', 'lead'));
      raw.sections.synthesis.members.push('analyst');
    });

  it('the root, the producer and the consuming lead check; another producer and an outsider are refused', async () => {
    const rt = open();
    await publishAll(rt);
    for (const r of ['lead', 'worker-1', 'synthesiser'])
      expect(await as(rt, r).check({ id: id(DOCS[0]) }), r).toMatchObject({ ok: true });
    for (const r of ['worker-2', 'observer-not-in-org']) {
      const x = await as(rt, r).check({ id: id(DOCS[0]) });
      expect(x, r).toMatchObject({ ok: false, code: 'ACCESS_READ' });
      expect(x.remedy).toBeTruthy();
    }
  });

  it('a consuming member checks accepted versions only', async () => {
    const rt = open(orgWithAnalyst());
    await publishAll(rt);
    const analyst = as(rt, 'analyst');
    expect(await analyst.check({ id: id(DOCS[0]) })).toMatchObject({ ok: false, code: 'NOT_ACCEPTED_YET' });
    expect(await analyst.check({ id: id(DOCS[0]), version: 1 })).toMatchObject({ ok: false, code: 'ACCESS_READ' });
    await readAll(as(rt, 'synthesiser'), id(DOCS[0]), 1);
    expect(
      await as(rt, 'synthesiser').call('org_doc_decide', { id: id(DOCS[0]), version: 1, decision: 'accept' }),
    ).toMatchObject({ ok: true, status: 'accepted' });
    expect(await analyst.check({ id: id(DOCS[0]) })).toMatchObject({ ok: true, version: 1, status: 'accepted' });
  });

  it('an unknown document and an unknown version are refused with the read codes', async () => {
    const rt = open();
    await publishAll(rt);
    expect(await as(rt, 'synthesiser').check({ id: 'nope-1' })).toMatchObject({ ok: false, code: 'UNKNOWN_DOCUMENT' });
    expect(await as(rt, 'synthesiser').check({ id: id(DOCS[0]), version: 9 })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_VERSION',
    });
  });

  it('a closed runtime refuses the call and records nothing', async () => {
    const rt = open();
    await publishAll(rt);
    rt.close();
    expect(await as(rt, 'synthesiser').check({ id: id(DOCS[0]) })).toMatchObject({ ok: false, code: 'RUNTIME_CLOSED' });
    expect(rt.checks.counts().calls).toBe(0);
  });
});

describe('version selection', () => {
  it('defaults to the latest accepted version, else the head; an explicit version wins', async () => {
    const rt = open();
    const doc = DOCS[0];
    const f = faulted(20261004);
    const bad = f.plan.faults.find((x) => x.doc === doc) ? f.body(doc) : (() => {
      const b = honestDoc(doc);
      b.sheets[0].answers[4].value += 5;
      return b;
    })();
    expect(await as(rt, worker(doc)).call('org_doc_publish', { type: doc, body: bad })).toMatchObject({ version: 1 });
    const syn = as(rt, 'synthesiser');
    expect(await syn.check({ id: id(doc) })).toMatchObject({ version: 1, passed: false });
    await readAll(syn, id(doc), 1);
    expect(
      await syn.call('org_doc_decide', { id: id(doc), version: 1, decision: 'reject', reason: 'q05 differs from its evidence' }),
    ).toMatchObject({ ok: true, status: 'rejected' });
    expect(
      await as(rt, worker(doc)).call('org_doc_publish', { type: doc, body: honestDoc(doc), supersedes: `${id(doc)}@v1` }),
    ).toMatchObject({ ok: true, version: 2 });
    expect(await syn.check({ id: id(doc) })).toMatchObject({ version: 2, passed: true });
    expect(await syn.check({ id: id(doc), version: 1 })).toMatchObject({ version: 1, passed: false });
    await readAll(syn, id(doc), 2);
    await syn.call('org_doc_decide', { id: id(doc), version: 2, decision: 'accept' });
    expect(await syn.check({ id: id(doc) })).toMatchObject({ version: 2, status: 'accepted' });
    expect(await syn.check({ id: id(doc), version: 1 })).toMatchObject({ version: 1, status: 'rejected', passed: false });
  });
});

describe('paging, in step with org_doc_read', () => {
  const allWrong = () => {
    const d = honestDoc(DOCS[0]);
    for (const s of d.sheets) for (const a of s.answers) a.value += 1; // every answer disagrees with its evidence
    return d;
  };

  it('splits a large result into parts of at most 8,000 characters that add up to the whole', async () => {
    const rt = open();
    await as(rt, 'worker-1').call('org_doc_publish', { type: DOCS[0], body: allWrong() });
    const syn = as(rt, 'synthesiser');
    const first = await syn.check({ id: id(DOCS[0]) });
    expect(first).toMatchObject({ ok: true, passed: false, flagged_count: 48, part: 1 });
    expect(first.parts).toBeGreaterThan(1);
    expect(first.per_check.value_matches_chain).toBe(48);
    const pages = [first];
    for (let p = 2; p <= first.parts; p++) pages.push(await syn.check({ id: id(DOCS[0]), version: 1, part: p }));
    for (const p of pages) expect(JSON.stringify(p).length).toBeLessThanOrEqual(8000);
    const qs = pages.flatMap((p) => p.flagged.map((x: any) => x.answer));
    expect(qs).toHaveLength(48);
    expect(new Set(qs).size).toBe(48);
    expect(pages.slice(1).every((p, i) => p.ok && p.part === i + 2 && p.parts === first.parts && p.ref === first.ref)).toBe(true);
    // the cut points depend on the outcome alone: asking again gives the same pages
    expect(await syn.check({ id: id(DOCS[0]) })).toEqual(first);
    expect(await syn.check({ id: id(DOCS[0]), version: 1, part: 2 })).toEqual(pages[1]);
  });

  it('refuses a later part without a version, and a part past the end', async () => {
    const rt = open();
    await as(rt, 'worker-1').call('org_doc_publish', { type: DOCS[0], body: allWrong() });
    const syn = as(rt, 'synthesiser');
    expect(await syn.check({ id: id(DOCS[0]), part: 2 })).toMatchObject({ ok: false, code: 'PART_NEEDS_VERSION' });
    expect(await syn.check({ id: id(DOCS[0]), version: 1, part: 99 })).toMatchObject({
      ok: false,
      code: 'PART_OUT_OF_RANGE',
    });
  });

  it('truncates a very long failure message but keeps the failing check and the answer', async () => {
    const rt = open();
    const d = honestDoc(DOCS[0]);
    d.sheets[0].answers[0].value = 5;
    const r0 = await as(rt, 'worker-1').call('org_doc_publish', { type: DOCS[0], body: d });
    expect(r0.ok).toBe(true);
    const r = await as(rt, 'synthesiser').check({ id: id(DOCS[0]) });
    expect(r.flagged[0].failed.every((x: any) => x.message.length <= 303)).toBe(true);
  });
});

describe('the durable record of each call', () => {
  it('records every call that reaches the host: runs with their counts, refusals with their code', async () => {
    const rt = open();
    await publishAll(rt, 20261004);
    const syn = as(rt, 'synthesiser');
    for (const doc of DOCS) await syn.check({ id: id(doc) });
    await as(rt, 'worker-2').check({ id: id(DOCS[0]) }); // refused: not a reader
    await syn.check({ id: 'nope-1' });
    const c = rt.checks.counts();
    expect(c).toMatchObject({ calls: 10, ran: 8, refused: 2, calls_flagging: 4 });
    expect(c.flagged_answers).toBeGreaterThanOrEqual(4);
    expect(Object.keys(c.by_ref)).toHaveLength(8);
    const recs = rt.checks.records();
    expect(recs.filter((r) => !r.ok).map((r) => r.code)).toEqual(['ACCESS_READ', 'UNKNOWN_DOCUMENT']);
    expect(recs[0]).toMatchObject({ by: 'synthesiser', ok: true, type: DOCS[0], answers: 48 });
    expect(readFileSync(join(rt.dir, 'checks.jsonl'), 'utf8').split('\n').filter(Boolean)).toHaveLength(10);
  });

  it('records a call once however many parts it is read in, and the record survives a reopen', async () => {
    const rt = open();
    const d = honestDoc(DOCS[0]);
    for (const s of d.sheets) for (const a of s.answers) a.value += 1;
    await as(rt, 'worker-1').call('org_doc_publish', { type: DOCS[0], body: d });
    const syn = as(rt, 'synthesiser');
    const first = await syn.check({ id: id(DOCS[0]) });
    for (let p = 2; p <= first.parts; p++) await syn.check({ id: id(DOCS[0]), version: 1, part: p });
    expect(rt.checks.counts()).toMatchObject({ calls: 1, ran: 1, flagged_answers: 48 });
    expect(new CheckJournal(join(rt.dir, 'checks.jsonl')).counts()).toEqual(rt.checks.counts());
  });

  it('a check is not a read and not a state change: the event log and the bodies stay as they were', async () => {
    const rt = open();
    await publishAll(rt);
    const before = rt.store.info();
    const body = readFileSync(rt.store.bodyPath({ section: 'sweep-1', type: DOCS[0], id: id(DOCS[0]) }, 1), 'utf8');
    for (const doc of DOCS) await as(rt, 'synthesiser').check({ id: id(doc) });
    expect(rt.store.info().seq).toBe(before.seq);
    expect(rt.store.info().head_hash).toBe(before.head_hash);
    expect(readFileSync(rt.store.bodyPath({ section: 'sweep-1', type: DOCS[0], id: id(DOCS[0]) }, 1), 'utf8')).toBe(body);
  });

  it('a torn last line is ignored when counting and is not appended after', async () => {
    const rt = open();
    await publishAll(rt);
    const syn = as(rt, 'synthesiser');
    await syn.check({ id: id(DOCS[0]) });
    const file = join(rt.dir, 'checks.jsonl');
    appendFileSync(file, '{"at":"2026-10-04T00:00:00.000Z","by":"synth');
    const reopened = new CheckJournal(file);
    expect(reopened.counts().calls).toBe(1);
    reopened.append({ at: 'x', by: 'synthesiser', id: 'a-1', ok: false, code: 'X' });
    expect(reopened.counts().calls).toBe(2);
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true);
    writeFileSync(file, readFileSync(file, 'utf8')); // unchanged
  });

  it('is not created until the first call', async () => {
    const rt = open();
    await publishAll(rt);
    expect(() => readFileSync(join(rt.dir, 'checks.jsonl'))).toThrow();
    expect(rt.checks.counts().calls).toBe(0);
  });
});

describe('evidence', () => {
  const org = () => {
    const raw = findingsOrg();
    raw.documents.findings.checks = [{ type: 'value_type', is: 'integer' }];
    return raw;
  };

  it('the publish argument evidence is stored verbatim, readable by org_doc_read and counted by org_doc_check', async () => {
    const rt = open(org());
    expect(
      await as(rt, 'researcher').call('org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE }),
    ).toMatchObject({ ok: true });
    const lead = as(rt, 'dev-lead');
    expect((await lead.call('org_doc_read', { id: 'findings-1' })).evidence).toEqual(SOURCE);
    const r = await lead.check({ id: 'findings-1' });
    expect(r).toMatchObject({ ok: true, passed: true, answers: 0, published_evidence: { entries: 1, kinds: { source: 1 } } });
  });

  it('the checks read the per-answer evidence of the body without any sweep-specific wiring', async () => {
    const rt = open();
    const doc = DOCS[2];
    const d = honestDoc(doc);
    d.sheets[1].answers[3].evidence.reverse();
    expect(await as(rt, worker(doc)).call('org_doc_publish', { type: doc, body: d })).toMatchObject({ ok: true });
    const r = await as(rt, 'synthesiser').check({ id: id(doc) });
    expect(r.flagged.map((x: any) => x.answer)).toEqual([`${d.sheets[1].module}/q04`]);
    expect(r.flagged[0].failed.map((x: any) => x.check)).toContain('files_match_evidence');
  });
});
