// P4.7: the freeze of a spent review cycle and the root's decision, through the real documents runtime and the real
// tool handlers (no daemon, no model). A publish that supersedes a frozen thread is refused with REWORK_EXHAUSTED,
// uncounted; a new document of the type is still allowed; the root (and only the root, and only on a frozen head)
// decides; a reload that raises the cap thaws the thread and one that lowers it freezes it, from facts each time.
import { mkdtempSync } from '../../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OrgToolDef } from '../../../src/orgrt/agent-runner.js';
import { type DocumentsRuntime, openDocumentsRuntime } from '../../../src/orgrt/documents/runtime.js';
import { reloadReworkCaps } from '../../../src/orgrt/documents/rework.js';
import { errorRemedy } from '../../../src/orgrt/documents/tool-errors.js';
import { documentTools } from '../../../src/orgrt/documents/tools-core.js';
import { toolInputSchema } from '../../../src/orgrt/tool-fence.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { FINDINGS, SOURCE, findingsOrg } from '../support/doc-defs.js';
import { readAllParts } from '../support/doc-runner.js';

const tmp = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'p47-guard-'));

function org(cap?: number) {
  const raw = findingsOrg();
  if (cap !== undefined) raw.sections.development.max_rework_rounds = cap;
  const def = OrgDefSchema.parse(raw);
  const rt = openDocumentsRuntime({ def, orgDir: tmp(), run: 'run-1' }) as DocumentsRuntime;
  return { rt, def, raw };
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
  publish = (a: Record<string, unknown> = {}) => this.call('org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE, ...a });
  decide = (a: Record<string, unknown>) => this.call('org_doc_decide', a);
  /** Read every part, then decide (P3.16b). */
  decideRead = async (a: Record<string, unknown>) => {
    await readAllParts((n, x) => this.call(n, x), { id: a.id as string, version: a.version as number });
    return this.decide(a);
  };
}
const as = (rt: DocumentsRuntime, role: string) => new Caller(rt, role);

/** findings-1 rejected by dev-lead `rounds` times; each rejected version is superseded by a new one. */
async function rejectRounds(rt: DocumentsRuntime, rounds: number) {
  const producer = as(rt, 'researcher');
  const lead = as(rt, 'dev-lead');
  expect(await producer.publish()).toMatchObject({ ok: true });
  for (let v = 1; v <= rounds; v++) {
    expect(await lead.decideRead({ id: 'findings-1', version: v, decision: 'reject', reason: `round ${v} not enough` })).toMatchObject({ ok: true, status: 'rejected' });
    if (v < rounds) expect(await producer.publish({ supersedes: `findings-1@v${v}`, body: { summary: `revised ${v}` } })).toMatchObject({ ok: true });
  }
}
const used = (rt: DocumentsRuntime) => rt.store.attempts('findings');

describe('the freeze', () => {
  it('a cap of 2: after the first rejection the producer may revise; after the second the revision is refused with REWORK_EXHAUSTED', async () => {
    const { rt } = org(2);
    await rejectRounds(rt, 1);
    expect(await as(rt, 'researcher').publish({ supersedes: 'findings-1@v1', body: { summary: 'a better one' } })).toMatchObject({ ok: true, ref: 'findings-1@v2' });
    await as(rt, 'dev-lead').decideRead({ id: 'findings-1', version: 2, decision: 'reject', reason: 'still no' });
    const r = await as(rt, 'researcher').publish({ supersedes: 'findings-1@v2', body: { summary: 'a third try' } });
    expect(r).toMatchObject({ ok: false, code: 'REWORK_EXHAUSTED', guard_code: 'REWORK_EXHAUSTED' });
  });

  it('the refusal text and remedy (golden): the thread, the cap, who decides and who to wait for', async () => {
    const { rt } = org(2);
    await rejectRounds(rt, 2);
    const r = await as(rt, 'researcher').publish({ supersedes: 'findings-1@v2' });
    expect(r.error).toBe(
      '"findings-1" cannot be revised: its review cycle with development is spent (2 of 2 rework rounds, sections.development.max_rework_rounds), so the thread is frozen and boss decides it (accept it, raise the cap and reload, or leave it closed). Wait for boss or your section lead; do not publish it again.',
    );
    expect(r.remedy).toBe(
      'This document is frozen because its review cycle reached max_rework_rounds: do not publish a revision of it. Tell your section lead and wait for the root, who decides it (accepts it, raises the cap and reloads, or leaves it closed).',
    );
    expect(r.remedy).toBe(errorRemedy('REWORK_EXHAUSTED'));
  });

  it('the refusal is NOT counted: attempts and consistency refusals are unchanged, even for a malformed body; nothing is committed', async () => {
    const { rt } = org(2);
    await rejectRounds(rt, 2);
    const before = { a: used(rt), seq: rt.store.info().seq };
    const researcher = as(rt, 'researcher');
    for (let i = 0; i < 5; i++) {
      expect(await researcher.publish({ supersedes: 'findings-1@v2', body: { summary: `again ${i}` } })).toMatchObject({ ok: false, code: 'REWORK_EXHAUSTED' });
    }
    expect(await researcher.publish({ supersedes: 'findings-1@v2', body: {} })).toMatchObject({ ok: false, code: 'REWORK_EXHAUSTED' }); // would be CONTENT_INVALID, which counts
    expect(await researcher.publish({ supersedes: 'findings-1@v2', body: { summary: 'x'.repeat(2_000_000) } })).toMatchObject({ ok: false, code: 'REWORK_EXHAUSTED' });
    expect(used(rt)).toEqual(before.a);
    expect(rt.store.info().seq).toBe(before.seq);
    // a refusal for another reason still counts, as before: the freeze did not change the counters
    expect(await researcher.publish({ body: {} })).toMatchObject({ ok: false, code: 'CONTENT_INVALID' });
    expect((used(rt) as { used: number }).used).toBe((before.a as { used: number }).used + 1);
  });

  it('a new document of the type is still allowed, and so is a stale supersedes that is not about the frozen head', async () => {
    const { rt } = org(2);
    await rejectRounds(rt, 2);
    expect(await as(rt, 'researcher').publish({ body: { summary: 'a different finding' } })).toMatchObject({ ok: true, ref: 'findings-2@v1' });
    // the store's own conflict refusal for a non-head reference comes first for the same document: the freeze names the head only
    expect(await as(rt, 'researcher').publish({ supersedes: 'findings-1@v1' })).toMatchObject({ ok: false, code: 'SUPERSEDES_CONFLICT' });
  });

  it('a thread with no cap is never frozen however many rounds, and a section with a cap does not freeze another', async () => {
    const { rt } = org();
    await rejectRounds(rt, 4);
    expect(await as(rt, 'researcher').publish({ supersedes: 'findings-1@v4' })).toMatchObject({ ok: true });
    const withQa = findingsOrg({ qa: true });
    withQa.sections.qa.max_rework_rounds = 1;
    const rt2 = openDocumentsRuntime({ def: OrgDefSchema.parse(withQa), orgDir: tmp(), run: 'run-1' }) as DocumentsRuntime;
    await rejectRounds(rt2, 3); // development rejects thrice, qa never
    expect(await as(rt2, 'researcher').publish({ supersedes: 'findings-1@v3' })).toMatchObject({ ok: true });
  });

  it('the guard exists only when some section declares a cap', () => {
    expect(org().rt.store.guards).toHaveLength(0);
    expect(org(2).rt.store.guards).toHaveLength(1);
  });
});

describe('the root decides a spent thread', () => {
  it('the root accepts the frozen head: accepted, the thread thaws, the producer may revise an accepted version', async () => {
    const { rt } = org(2);
    await rejectRounds(rt, 2);
    const boss = as(rt, 'boss');
    const r = await boss.decideRead({ id: 'findings-1', version: 2, decision: 'accept' });
    expect(r).toMatchObject({ ok: true, version: 2, consumer: 'development', decision: 'accept', status: 'accepted' });
    expect(rt.store.list({ id: 'findings-1' })[0]).toMatchObject({ head: { version: 2, status: 'accepted' }, rework: { development: 1 } });
    expect(rt.reworkReport()).toMatchObject([{ doc: 'findings-1', consumer: 'development', rounds: 1, exhausted: false, frozen: false }]);
    expect(await as(rt, 'researcher').publish({ supersedes: 'findings-1@v2', body: { summary: 'a post-accept revision' } })).toMatchObject({ ok: true });
  });

  it('a root reject confirms the rejection (no event) and the thread stays frozen', async () => {
    const { rt } = org(2);
    await rejectRounds(rt, 2);
    const seq = rt.store.info().seq;
    expect(await as(rt, 'boss').decide({ id: 'findings-1', version: 2, decision: 'reject', reason: 'closing it' })).toMatchObject({ ok: true, noop: true, status: 'rejected' });
    expect(rt.store.info().seq).toBe(seq);
    expect(await as(rt, 'researcher').publish({ supersedes: 'findings-1@v2' })).toMatchObject({ code: 'REWORK_EXHAUSTED' });
  });

  it('only the root: the producer, its lead, the consumer lead (a reversal) and a role outside the sections are refused', async () => {
    const { rt } = org(2);
    await rejectRounds(rt, 2);
    for (const role of ['researcher', 'research-lead', 'coder', 'observer'])
      expect(await as(rt, role).decide({ id: 'findings-1', version: 2, decision: 'accept' }), role).toMatchObject({ ok: false, code: 'ACCESS_DECIDE' });
    expect(await as(rt, 'dev-lead').decide({ id: 'findings-1', version: 2, decision: 'accept' })).toMatchObject({ ok: false, code: 'REVERSAL_REFUSED' });
  });

  it('only a frozen one: below the cap, on an older version, or with no cap, the root is refused as before', async () => {
    const one = org(2);
    await rejectRounds(one.rt, 1);
    expect(await as(one.rt, 'boss').decide({ id: 'findings-1', version: 1, decision: 'accept' })).toMatchObject({ ok: false, code: 'ACCESS_DECIDE' });
    const two = org(2);
    await rejectRounds(two.rt, 2);
    expect(await as(two.rt, 'boss').decide({ id: 'findings-1', version: 1, decision: 'accept' })).toMatchObject({ ok: false, code: 'ACCESS_DECIDE' });
    const none = org();
    await rejectRounds(none.rt, 3);
    expect(await as(none.rt, 'boss').decide({ id: 'findings-1', version: 3, decision: 'accept' })).toMatchObject({ ok: false, code: 'ACCESS_DECIDE' });
  });

  it('the refusal text for a root outside the rule is the existing one (byte for byte)', async () => {
    const { rt } = org(2);
    await rejectRounds(rt, 1);
    const r = await as(rt, 'boss').decide({ id: 'findings-1', version: 1, decision: 'accept' });
    expect(r.error).toBe('boss may not decide "findings": only dev-lead (lead of development) decides');
  });
});

describe('a reload moves the cap, and the freeze follows the facts', () => {
  const next = (raw: Record<string, any>, cap?: number) => {
    const c = JSON.parse(JSON.stringify(raw));
    if (cap === undefined) delete c.sections.development.max_rework_rounds;
    else c.sections.development.max_rework_rounds = cap;
    return OrgDefSchema.parse(c);
  };

  it('raising the cap unfreezes a thread whose rounds are now below it; lowering it freezes it again', async () => {
    const { rt, def, raw } = org(2);
    await rejectRounds(rt, 2);
    const researcher = as(rt, 'researcher');
    expect(await researcher.publish({ supersedes: 'findings-1@v2' })).toMatchObject({ code: 'REWORK_EXHAUSTED' });
    expect(reloadReworkCaps(def, next(raw, 3), rt)).toEqual(['sections.development.max_rework_rounds']);
    expect(rt.reworkReport()).toMatchObject([{ rounds: 2, cap: 3, exhausted: false, frozen: false }]);
    expect(await researcher.publish({ supersedes: 'findings-1@v2', body: { summary: 'one more go' } })).toMatchObject({ ok: true, ref: 'findings-1@v3' });
    await as(rt, 'dev-lead').decideRead({ id: 'findings-1', version: 3, decision: 'reject', reason: 'third no' });
    expect(await researcher.publish({ supersedes: 'findings-1@v3' })).toMatchObject({ code: 'REWORK_EXHAUSTED' });
    expect(reloadReworkCaps(def, next(raw, 4), rt)).toHaveLength(1);
    expect(await researcher.publish({ supersedes: 'findings-1@v3', body: { summary: 'a fourth' } })).toMatchObject({ ok: true });
    expect(reloadReworkCaps(def, next(raw, 1), rt)).toHaveLength(1); // 3 rounds already: frozen on the spot
    expect(await researcher.publish({ supersedes: 'findings-1@v4' })).toMatchObject({ code: 'REWORK_EXHAUSTED' });
  });

  it('removing the cap thaws the thread; a reload that changes nothing reports nothing', async () => {
    const { rt, def, raw } = org(2);
    await rejectRounds(rt, 2);
    expect(reloadReworkCaps(def, next(raw, 2), rt)).toEqual([]);
    expect(reloadReworkCaps(def, next(raw), rt)).toEqual(['sections.development.max_rework_rounds']);
    expect(await as(rt, 'researcher').publish({ supersedes: 'findings-1@v2', body: { summary: 'no cap now' } })).toMatchObject({ ok: true });
  });

  it('the first cap added by a reload installs the enforcement then, once', async () => {
    const { rt, def, raw } = org();
    await rejectRounds(rt, 2);
    expect(rt.store.guards).toHaveLength(0);
    expect(reloadReworkCaps(def, next(raw, 2), rt)).toHaveLength(1);
    expect(rt.store.guards).toHaveLength(1);
    expect(await as(rt, 'researcher').publish({ supersedes: 'findings-1@v2' })).toMatchObject({ code: 'REWORK_EXHAUSTED' });
    reloadReworkCaps(def, next(raw, 5), rt);
    reloadReworkCaps(def, next(raw, 2), rt);
    expect(rt.store.guards).toHaveLength(1);
  });
});
