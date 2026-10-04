// P4.8: a declared loop enforced, through the real documents runtime and the real tool handlers (no daemon, no model).
// The lineage is built through the real store with `inputs`, so each state is one the store committed. Pinned here:
// the inputs lookup (inputs from the other loop section count as a return, non-loop types and unresolved refs are
// ignored, one read per version), exhaustion at exactly max_rounds over a three-document lineage, the refusal text,
// that only a RETURN is refused, the notice (texts, recipients, once), the root's decide rule, and a reload that
// raises or lowers max_rounds.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OrgToolDef } from '../../../src/orgrt/agent-runner.js';
import { KIND_LOOP_EXHAUSTED } from '../../../src/orgrt/documents/notice.js';
import { reloadLoopRounds, storeInputsOf } from '../../../src/orgrt/documents/loop-run.js';
import { type DocumentsRuntime, openDocumentsRuntime } from '../../../src/orgrt/documents/runtime.js';
import { errorRemedy } from '../../../src/orgrt/documents/tool-errors.js';
import { documentTools } from '../../../src/orgrt/documents/tools-core.js';
import { toolInputSchema } from '../../../src/orgrt/tool-fence.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { readAllParts } from '../support/doc-runner.js';
import { SUMMARY, loopOrg } from '../support/loop-defs.js';

const tmp = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'p48-run-'));

function org(max: number | null = 2) {
  const def = OrgDefSchema.parse(loopOrg(max));
  const rt = openDocumentsRuntime({ def, orgDir: tmp(), run: 'run-1' }) as DocumentsRuntime;
  return { rt, def };
}

class Caller {
  readonly tools: OrgToolDef[];
  constructor(rt: DocumentsRuntime, role: string) {
    this.tools = documentTools(rt.forRole(role)).map((t) => ({ ...t, strict: {} }));
  }
  async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const t = this.tools.find((x) => x.name === name)!;
    const parsed = toolInputSchema(t).safeParse(args);
    if (!parsed.success) return { schema_error: parsed.error.issues.map((i) => i.message).join('; ') };
    return JSON.parse((await t.handler(parsed.data)).text);
  }
  publish = (type: string, a: Record<string, unknown> = {}) => this.call('org_doc_publish', { type, body: SUMMARY(`a ${type}`), ...a });
  decide = async (a: Record<string, unknown>) => {
    await readAllParts((n, x) => this.call(n, x), { id: a.id as string, version: a.version as number });
    return this.call('org_doc_decide', a);
  };
}
const as = (rt: DocumentsRuntime, role: string) => new Caller(rt, role);
const report = (rt: DocumentsRuntime) => rt.loopReport();
const loopNotices = (rt: DocumentsRuntime) => rt.notices!.notices().filter((n) => n.kind === KIND_LOOP_EXHAUSTED);

/** research -> review -> revise -> review: build-1 (v1..v3), report-1 and report-2: a lineage of three documents. */
async function threeDocumentLoop(rt: DocumentsRuntime, stopAfter = 5) {
  const coder = as(rt, 'coder');
  const qa = as(rt, 'qa-lead');
  const steps = [
    () => coder.publish('build'),
    () => qa.publish('report', { inputs: ['build-1@v1'] }),
    () => coder.publish('build', { supersedes: 'build-1@v1', inputs: ['report-1@v1'] }),
    () => qa.publish('report', { inputs: ['build-1@v2'] }),
    () => coder.publish('build', { supersedes: 'build-1@v2', inputs: ['report-2@v1'] }),
  ];
  const out: any[] = [];
  for (const s of steps.slice(0, stopAfter)) out.push(await s());
  return out;
}

describe('the inputs lookup', () => {
  it('reads inputs from the version body through the store, once per version', async () => {
    const { rt } = org();
    await threeDocumentLoop(rt, 3);
    let reads = 0;
    const lookup = storeInputsOf({ peek: (id, v) => (reads++, rt.store.peek(id, v)) });
    expect(lookup('report-1@v1')).toEqual(['build-1@v1']);
    expect(lookup('build-1@v2')).toEqual(['report-1@v1']);
    expect(lookup('build-1@v1')).toEqual([]);
    expect(reads).toBe(3);
    lookup('report-1@v1');
    lookup('build-1@v2');
    expect(reads).toBe(3);
  });

  it('a ref that is not a version, or a version that does not exist, has no inputs and nothing throws', async () => {
    const { rt } = org();
    const lookup = storeInputsOf({ peek: (id, v) => rt.store.peek(id, v) });
    expect(lookup('nonsense')).toBeUndefined();
    expect(lookup('build-9@v1')).toBeUndefined();
    expect(lookup('build-1@v7')).toBeUndefined();
  });

  it('inputs from the other loop section count as a return; non-loop types and unresolved refs do not', async () => {
    const { rt } = org(5);
    const coder = as(rt, 'coder');
    const qa = as(rt, 'qa-lead');
    await coder.publish('build'); // build-1@v1
    await coder.publish('memo'); // memo-1@v1: a type of development that is not a loop type
    await qa.publish('report', { inputs: ['build-1@v1'] }); // report-1@v1
    // revises on a memo of its own section and on a ref that does not exist: no return
    await coder.publish('build', { supersedes: 'build-1@v1', inputs: ['memo-1@v1', 'report-9@v9'] });
    expect(report(rt)[0]).toMatchObject({ first: 'build-1@v1', rounds: 0 });
    // revises on the report of the other section: one return
    await coder.publish('build', { supersedes: 'build-1@v2', inputs: ['report-1@v1'] });
    expect(report(rt)[0]).toMatchObject({ rounds: 1, exhausted: false, versions: ['build-1@v1', 'report-1@v1', 'build-1@v2', 'build-1@v3'] });
    expect(report(rt)).toHaveLength(1); // the memo is in no lineage
  });
});

describe('exhaustion at exactly max_rounds', () => {
  it('two returns over three documents exhaust a cap of two, and not one publish earlier', async () => {
    const { rt } = org(2);
    await threeDocumentLoop(rt, 3);
    expect(report(rt)[0]).toMatchObject({ rounds: 1, max_rounds: 2, exhausted: false });
    const qa = as(rt, 'qa-lead');
    await qa.publish('report', { inputs: ['build-1@v2'] });
    expect(report(rt)[0]).toMatchObject({ rounds: 1, exhausted: false });
    const last = await as(rt, 'coder').publish('build', { supersedes: 'build-1@v2', inputs: ['report-2@v1'] });
    expect(last).toMatchObject({ ok: true, ref: 'build-1@v3' });
    expect(report(rt)[0]).toMatchObject({ rounds: 2, exhausted: true, exhausted_seq: last.seq, origin: 'development', between: ['development', 'qa'] });
    expect(report(rt)[0].versions).toEqual(['build-1@v1', 'report-1@v1', 'build-1@v2', 'report-2@v1', 'build-1@v3']);
  });

  it('round three is refused with LOOP_EXHAUSTED: the text, the remedy, nothing committed, nothing counted', async () => {
    const { rt } = org(2);
    await threeDocumentLoop(rt);
    const coder = as(rt, 'coder');
    const before = rt.store.info().seq;
    const r = await coder.publish('build', { supersedes: 'build-1@v3', inputs: ['report-2@v1'] });
    expect(r).toMatchObject({ ok: false, code: 'LOOP_EXHAUSTED', guard_code: 'LOOP_EXHAUSTED' });
    expect(r.error).toBe(
      'This publish would be round 3 of loops[0] (development and qa), and the loop is spent: its 2 rounds (loops[0].max_rounds) are used, so no further return of the cycle to development is accepted and boss decides it (accept the last version, raise max_rounds and reload, or leave it closed). Wait for boss or your section lead; do not publish it again.',
    );
    expect(r.remedy).toBe(
      'This publish would be another round of a loop that has used its max_rounds: do not publish it. Tell your section lead and wait for the root, who decides it (accepts the last version, raises max_rounds and reloads, or leaves it closed).',
    );
    expect(r.remedy).toBe(errorRemedy('LOOP_EXHAUSTED'));
    expect(rt.store.info().seq).toBe(before);
    expect(rt.store.attempts('build')).toMatchObject({ used: 0 });
    // a revision with no new input from qa and no rejection is not a return; neither is a new document with no inputs
    expect(await coder.publish('build', { supersedes: 'build-1@v3' })).toMatchObject({ ok: true, ref: 'build-1@v4' });
    expect(await coder.publish('build', { body: SUMMARY('a different build') })).toMatchObject({ ok: true, ref: 'build-2@v1' });
  });

  it('only a return is refused: qa can still review the last round and publish another report', async () => {
    const { rt } = org(2);
    await threeDocumentLoop(rt);
    const qa = as(rt, 'qa-lead');
    expect(await qa.publish('report', { inputs: ['build-1@v3'] })).toMatchObject({ ok: true, ref: 'report-3@v1' });
    expect(await qa.decide({ id: 'build-1', version: 3, decision: 'accept' })).toMatchObject({ ok: true, status: 'accepted' });
    expect(report(rt)[0]).toMatchObject({ rounds: 2, exhausted: true });
  });

  it('a rejection with no inputs is a return too: cap two over a rework chain', async () => {
    const { rt } = org(2);
    const coder = as(rt, 'coder');
    const qa = as(rt, 'qa-lead');
    await coder.publish('build');
    await qa.decide({ id: 'build-1', version: 1, decision: 'reject', reason: 'no' });
    expect(await coder.publish('build', { supersedes: 'build-1@v1' })).toMatchObject({ ok: true });
    await qa.decide({ id: 'build-1', version: 2, decision: 'reject', reason: 'still no' });
    expect(await coder.publish('build', { supersedes: 'build-1@v2' })).toMatchObject({ ok: true, ref: 'build-1@v3' });
    expect(report(rt)[0]).toMatchObject({ rounds: 2, exhausted: true });
    await qa.decide({ id: 'build-1', version: 3, decision: 'reject', reason: 'never' });
    expect(await coder.publish('build', { supersedes: 'build-1@v3' })).toMatchObject({ ok: false, code: 'LOOP_EXHAUSTED' });
  });

  it('a type outside the loop is untouched by an exhausted loop', async () => {
    const { rt } = org(2);
    await threeDocumentLoop(rt);
    expect(await as(rt, 'coder').publish('memo', { inputs: ['report-2@v1'] })).toMatchObject({ ok: true });
  });
});

describe('the escalation notice', () => {
  it('is owed at the first rejection of the head of an exhausted lineage: the root in full, both leads a copy, once', async () => {
    const { rt } = org(2);
    await threeDocumentLoop(rt);
    expect(loopNotices(rt)).toEqual([]); // the cap is reached, the last round is still under review: nothing owed
    await as(rt, 'qa-lead').decide({ id: 'build-1', version: 3, decision: 'reject', reason: 'the tests still fail' });
    const ns = loopNotices(rt);
    expect(ns.map((n) => [n.to, n.audience])).toEqual([
      ['boss', undefined],
      ['dev-lead', 'lead'],
      ['qa-lead', 'lead'],
    ]);
    expect(ns[0].subject).toBe('loop exhausted: loops[0] (development, qa)');
    expect(ns[0].body).toBe(
      'The loop loops[0] (development and qa), document types build, report, is spent: the lineage that started at build-1@v1 has come back to development 2 times, which is max_rounds 2 (loops[0].max_rounds). Last rejection: build-1@v3, by qa-lead for qa: the tests still fail The loop is frozen: development cannot publish another round (a revision of a version that qa rejected, or a document built on one from another section of the loop, is refused). You decide. Options: (1) raise the cap: set loops[0].max_rounds higher in the org definition and reload it, and development may go another round; (2) decide the document yourself: org_doc_decide on build-1 version 3 with decision "accept" (it replaces qa\'s rejection and ends the loop); (3) reassign the work to another role or section; (4) close the loop: leave it frozen (org_doc_decide with decision "reject" confirms the rejection).',
    );
    expect(ns[1].subject).toBe('loop exhausted: loops[0] (development, qa) (copy)');
    expect(ns[1].body).toBe(
      'The loop loops[0] (development and qa) is spent: 2 returns, its max_rounds of 2. Last rejection (build-1@v3, qa-lead for qa): the tests still fail The loop is frozen and the root decides; do not publish another round.',
    );
    expect(new Set(ns.map((n) => n.key)).size).toBe(3);
    expect(ns.every((n) => n.key.startsWith('l:0|build-1@v1|2@'))).toBe(true);
    // a second rejection event on the same lineage (a later report) owes nothing more
    await as(rt, 'dev-lead').decide({ id: 'report-2', version: 1, decision: 'reject', reason: 'unclear' });
    expect(loopNotices(rt)).toHaveLength(3);
  });

  it('a last round that is accepted ends the loop cleanly and escalates nothing', async () => {
    const { rt } = org(2);
    await threeDocumentLoop(rt);
    await as(rt, 'qa-lead').decide({ id: 'build-1', version: 3, decision: 'accept' });
    expect(loopNotices(rt)).toEqual([]);
  });

  it('nothing is owed below the cap: a rejection of round one escalates nothing', async () => {
    const { rt } = org(3);
    await threeDocumentLoop(rt);
    await as(rt, 'qa-lead').decide({ id: 'build-1', version: 3, decision: 'reject', reason: 'no' });
    expect(report(rt)[0]).toMatchObject({ rounds: 2, exhausted: false });
    expect(loopNotices(rt)).toEqual([]);
  });
});

describe('the root decides a frozen loop', () => {
  it('only the root, only the head, only after a loop section rejected it; accept replaces the rejection', async () => {
    const { rt } = org(2);
    await threeDocumentLoop(rt);
    const boss = as(rt, 'boss');
    expect(await boss.decide({ id: 'build-1', version: 3, decision: 'accept' })).toMatchObject({ ok: false, code: 'ACCESS_DECIDE' }); // no rejection yet
    await as(rt, 'qa-lead').decide({ id: 'build-1', version: 3, decision: 'reject', reason: 'no' });
    expect(await boss.decide({ id: 'build-1', version: 2, decision: 'accept' })).toMatchObject({ ok: false, code: 'ACCESS_DECIDE' }); // not the head
    expect(await as(rt, 'dev-lead').decide({ id: 'build-1', version: 3, decision: 'accept' })).toMatchObject({ ok: false }); // not a decider of build
    expect(await boss.decide({ id: 'build-1', version: 3, decision: 'accept' })).toMatchObject({ ok: true, decision: 'accept', consumer: 'qa', status: 'accepted' });
    expect(rt.store.list({ id: 'build-1' })[0].head).toMatchObject({ version: 3, status: 'accepted' });
  });

  it('with no loop declared the root has no such right', async () => {
    const def = OrgDefSchema.parse(loopOrg(null, (r) => {
      r.sections.qa.publishes = [];
      r.sections.development.consumes = [];
      delete r.documents.report;
    }));
    const rt = openDocumentsRuntime({ def, orgDir: tmp(), run: 'run-1' }) as DocumentsRuntime;
    await as(rt, 'coder').publish('build');
    await as(rt, 'qa-lead').decide({ id: 'build-1', version: 1, decision: 'reject', reason: 'no' });
    expect(await as(rt, 'boss').decide({ id: 'build-1', version: 1, decision: 'accept' })).toMatchObject({ ok: false, code: 'ACCESS_DECIDE' });
    expect(rt.loopReport()).toEqual([]);
  });
});

describe('a reload that moves max_rounds', () => {
  it('raising it thaws the loop at once; lowering it freezes it again, from facts each time', async () => {
    const { rt, def } = org(2);
    await threeDocumentLoop(rt);
    const coder = as(rt, 'coder');
    const ask = () => coder.publish('build', { supersedes: 'build-1@v3', inputs: ['report-2@v1'] });
    expect(await ask()).toMatchObject({ ok: false, code: 'LOOP_EXHAUSTED' });
    expect(reloadLoopRounds(def, OrgDefSchema.parse(loopOrg(3)), rt)).toEqual(['loops[0].max_rounds']);
    expect(report(rt)[0]).toMatchObject({ rounds: 2, max_rounds: 3, exhausted: false });
    expect(await ask()).toMatchObject({ ok: true, ref: 'build-1@v4' });
    expect(report(rt)[0]).toMatchObject({ rounds: 3, exhausted: true });
    reloadLoopRounds(def, OrgDefSchema.parse(loopOrg(1)), rt);
    expect(report(rt)[0]).toMatchObject({ max_rounds: 1, exhausted: true });
    expect(await coder.publish('build', { supersedes: 'build-1@v4', inputs: ['report-2@v1'] })).toMatchObject({ ok: false, code: 'LOOP_EXHAUSTED' });
  });

  it('only max_rounds moves: a changed between or types is not applied, and a reload with no change reports none', () => {
    const live = OrgDefSchema.parse(loopOrg(2));
    expect(reloadLoopRounds(live, OrgDefSchema.parse(loopOrg(2)), undefined)).toEqual([]);
    expect(reloadLoopRounds(live, OrgDefSchema.parse(loopOrg(2, (r) => (r.loops[0].types = ['build']))), undefined)).toEqual([]);
    expect(reloadLoopRounds(live, OrgDefSchema.parse(loopOrg(null)), undefined)).toEqual([]);
    expect((live as any).loops[0]).toEqual({ between: ['development', 'qa'], types: ['build', 'report'], max_rounds: 2 });
    expect(reloadLoopRounds(live, OrgDefSchema.parse(loopOrg(7)), undefined)).toEqual(['loops[0].max_rounds']);
    expect((live as any).loops[0].max_rounds).toBe(7);
  });

  it('a lowered cap owes the notice for a rejection that was already committed', async () => {
    const { rt, def } = org(3);
    await threeDocumentLoop(rt);
    await as(rt, 'qa-lead').decide({ id: 'build-1', version: 3, decision: 'reject', reason: 'no' });
    expect(loopNotices(rt)).toEqual([]);
    reloadLoopRounds(def, OrgDefSchema.parse(loopOrg(2)), rt);
    expect(loopNotices(rt).map((n) => n.to)).toEqual(['boss', 'dev-lead', 'qa-lead']);
    expect(loopNotices(rt)[0].key).toMatch(/^l:0\|build-1@v1\|2@\d+:boss$/);
  });
});

describe('a definition with no loop', () => {
  it('has no loop enforcement: no guard, no report, no notice', async () => {
    const def = OrgDefSchema.parse(loopOrg(null, (r) => {
      r.sections.qa.publishes = [];
      r.sections.development.consumes = [];
      delete r.documents.report;
    }));
    const rt = openDocumentsRuntime({ def, orgDir: tmp(), run: 'run-1' }) as DocumentsRuntime;
    const coder = as(rt, 'coder');
    for (let v = 1; v <= 6; v++) expect(await coder.publish('build', v === 1 ? {} : { supersedes: `build-1@v${v - 1}` })).toMatchObject({ ok: true });
    expect(rt.loopReport()).toEqual([]);
  });
});

describe('a log written before loops were declared', () => {
  it('replays unchanged under a declared loop: the event schema carries no new field, so the old log is the new log', async () => {
    const orgDir = tmp();
    const old = openDocumentsRuntime({ def: OrgDefSchema.parse(loopOrg(null)), orgDir, run: 'run-1' }) as DocumentsRuntime;
    const coder = as(old, 'coder');
    const qa = as(old, 'qa-lead');
    await coder.publish('build');
    await qa.publish('report', { inputs: ['build-1@v1'] });
    await coder.publish('build', { supersedes: 'build-1@v1', inputs: ['report-1@v1'] });
    await qa.publish('report', { inputs: ['build-1@v2'] });
    await coder.publish('build', { supersedes: 'build-1@v2', inputs: ['report-2@v1'] });
    await qa.decide({ id: 'build-1', version: 3, decision: 'reject', reason: 'no' });
    expect(old.loopReport()).toEqual([]); // no loop declared: nothing counted, nothing refused
    expect(await coder.publish('build', { supersedes: 'build-1@v3', inputs: ['report-2@v1'] })).toMatchObject({ ok: true, ref: 'build-1@v4' });
    old.close();
    const events = readFileSync(join(orgDir, 'docs', 'run-1', 'events.jsonl'), 'utf8');
    expect(events).not.toMatch(/"inputs"/); // inputs live in the body files only

    const again = openDocumentsRuntime({ def: OrgDefSchema.parse(loopOrg(2)), orgDir, run: 'run-1' }) as DocumentsRuntime;
    expect(readFileSync(join(orgDir, 'docs', 'run-1', 'events.jsonl'), 'utf8')).toBe(events); // reopening wrote nothing
    expect(again.loopReport()[0]).toMatchObject({ rounds: 3, exhausted: true, versions: ['build-1@v1', 'report-1@v1', 'build-1@v2', 'report-2@v1', 'build-1@v3', 'build-1@v4'] });
    expect(loopNotices(again).map((n) => n.to)).toEqual(['boss', 'dev-lead', 'qa-lead']); // the committed rejection of v3 is owed now
    expect(await as(again, 'coder').publish('build', { supersedes: 'build-1@v4', inputs: ['report-2@v1'] })).toMatchObject({ ok: false, code: 'LOOP_EXHAUSTED' });
  });
});
