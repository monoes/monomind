// P3.6: the four org_doc_* tools over a real documents runtime (real store on disk), role-bound, with the
// access matrix, every refusal reason, paging, idempotency and the error table. No daemon, no model.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OrgToolDef } from '../../../src/orgrt/agent-runner.js';
import { STORE_ERROR_CODES } from '../../../src/orgrt/documents/store-types.js';
import { TOOL_ERROR_CODES, errorRemedy } from '../../../src/orgrt/documents/tool-errors.js';
import { documentTools } from '../../../src/orgrt/documents/tools-core.js';
import { openDocumentsRuntime, type DocumentsRuntime } from '../../../src/orgrt/documents/runtime.js';
import { toolInputSchema } from '../../../src/orgrt/tool-fence.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { FINDINGS, SOURCE, findingsOrg } from '../support/doc-defs.js';

const tmp = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'doc-tools-'));
const open = (raw = findingsOrg({ qa: true })): DocumentsRuntime =>
  openDocumentsRuntime({ def: OrgDefSchema.parse(raw), orgDir: tmp(), run: 'run-1' })!;

class Caller {
  readonly tools: OrgToolDef[];
  constructor(
    readonly rt: DocumentsRuntime,
    readonly role: string,
  ) {
    // buildOrgTools marks every tool it returns strict; do the same here
    this.tools = documentTools(rt.forRole(role)).map((t) => ({ ...t, strict: {} }));
  }
  async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const t = this.tools.find((x) => x.name === name)!;
    // as the runner would: validate against the strict schema first
    const parsed = toolInputSchema(t).safeParse(args);
    if (!parsed.success) return { schema_error: parsed.error.issues.map((i) => i.message).join('; ') };
    return JSON.parse((await t.handler(parsed.data)).text);
  }
  publish = (a: Record<string, unknown> = {}) =>
    this.call('org_doc_publish', { type: 'findings', body: FINDINGS, evidence: SOURCE, ...a });
  read = (a: Record<string, unknown>) => this.call('org_doc_read', a);
  list = (a: Record<string, unknown> = {}) => this.call('org_doc_list', a);
  decide = (a: Record<string, unknown>) => this.call('org_doc_decide', a);
}
const as = (rt: DocumentsRuntime, role: string) => new Caller(rt, role);

describe('tool surface', () => {
  it('four tools in a fixed order, strict, with no role argument', () => {
    const t = documentTools(open().forRole('researcher'));
    expect(t.map((x) => x.name)).toEqual(['org_doc_list', 'org_doc_read', 'org_doc_publish', 'org_doc_decide']);
    for (const x of t) {
      expect(Object.keys(x.schema)).not.toContain('role');
      expect(x.strict).toBeUndefined(); // buildOrgTools applies the strict marker to every tool it returns
      expect(x.description.length).toBeGreaterThan(20);
    }
  });

  it('a role argument cannot override the authenticated role (the strict schema refuses it)', async () => {
    const rt = open();
    const r = await as(rt, 'coder').call('org_doc_publish', { type: 'findings', body: FINDINGS, role: 'researcher' });
    expect(r.schema_error).toMatch(/unknown argument "role"/);
    expect(rt.store.info().seq).toBe(0);
  });
});

describe('publish', () => {
  it('happy path: a pending version, receipt with ref, state_seq, waiting consumers and attempts left', async () => {
    const rt = open();
    const r = await as(rt, 'researcher').publish();
    expect(r).toMatchObject({
      ok: true,
      ref: 'findings-1@v1',
      id: 'findings-1',
      version: 1,
      status: 'pending',
      waiting_on: ['development', 'qa'],
      attempts_left: 3,
    });
    expect(r.contract_revision).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof r.state_seq).toBe('number');
  });

  it('schema-invalid publish names every problem and counts an attempt; the cap is final', async () => {
    const rt = open();
    const w = as(rt, 'researcher');
    const bad = await w.publish({ body: { summary: 1, extra: true } });
    expect(bad).toMatchObject({ ok: false, code: 'CONTENT_INVALID', attempts_left: 2 });
    expect(bad.problems.length).toBeGreaterThanOrEqual(2);
    expect(bad.error).toMatch(/does not match its contract/);
    expect(bad.remedy).toBe(errorRemedy('CONTENT_INVALID'));
    await w.publish({ body: {} });
    const third = await w.publish({ body: {} });
    expect(third).toMatchObject({ ok: false, attempts_left: 0 });
    const done = await w.publish();
    expect(done).toMatchObject({ ok: false, code: 'PUBLISH_EXHAUSTED' });
    expect(done.remedy).toMatch(/lead/);
  });

  it('missing required evidence is refused naming the kind', async () => {
    const r = await as(open(), 'researcher').publish({ evidence: undefined });
    expect(r).toMatchObject({ ok: false, code: 'CONTENT_INVALID' });
    expect(JSON.stringify(r.problems)).toMatch(/source/);
  });

  it('wrong producer is refused by rule, with no store event', async () => {
    const rt = open();
    for (const role of ['coder', 'dev-lead', 'boss', 'observer']) {
      const r = await as(rt, role).publish();
      expect(r, role).toMatchObject({ ok: false, code: 'ACCESS_PUBLISH' });
      expect(r.error).toBe(`${role} may not publish "findings": only roles of section research (research-lead, researcher) publish it`);
    }
    expect(rt.store.info().seq).toBe(0);
  });

  it('unknown type lists the types the role may publish', async () => {
    const r = await as(open(), 'researcher').publish({ type: 'nope' });
    expect(r).toMatchObject({ ok: false, code: 'UNKNOWN_TYPE' });
    expect(r.error).toMatch(/findings/);
  });

  it('idempotent retry returns the committed receipt (explicit key and derived key)', async () => {
    const rt = open();
    const w = as(rt, 'researcher');
    const a = await w.publish({ idempotency_key: 'k-1' });
    const b = await w.publish({ idempotency_key: 'k-1' });
    expect(b).toMatchObject({ ok: true, ref: a.ref, replayed: true });
    const c = await w.publish({ idempotency_key: 'k-1', body: { summary: 'different' } });
    expect(c).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    const d1 = await w.publish({ body: { summary: 'derived one' } });
    const d2 = await w.publish({ body: { summary: 'derived one' } });
    expect(d2).toMatchObject({ ok: true, ref: d1.ref, replayed: true });
    expect(rt.store.list()).toHaveLength(2);
  });

  it('a revision supersedes the head; a stale supersedes is refused naming the head', async () => {
    const rt = open();
    const w = as(rt, 'researcher');
    const v1 = await w.publish();
    const v2 = await w.publish({ body: { summary: 'second try' }, supersedes: v1.ref });
    expect(v2).toMatchObject({ ok: true, ref: 'findings-1@v2', supersedes: 'findings-1@v1', status: 'pending' });
    const stale = await w.publish({ body: { summary: 'third try' }, supersedes: v1.ref });
    expect(stale).toMatchObject({ ok: false, code: 'SUPERSEDES_CONFLICT', head: 'findings-1@v2' });
    expect(rt.store.list()[0].versions.map((v) => v.status)).toEqual(['superseded', 'pending']);
  });

  it('an unchanged republish with a note is accepted as a new version', async () => {
    const w = as(open(), 'researcher');
    const v1 = await w.publish();
    const v2 = await w.publish({ supersedes: v1.ref, note: 'republished unchanged after the files were fixed' });
    expect(v2).toMatchObject({ ok: true, version: 2 });
  });
});

describe('read', () => {
  it('returns the body, evidence, decisions and state_seq, and logs a read event with the purpose', async () => {
    const rt = open();
    const p = await as(rt, 'researcher').publish({ note: 'first' });
    const r = await as(rt, 'dev-lead').read({ id: p.id });
    expect(r).toMatchObject({
      ok: true,
      ref: 'findings-1@v1',
      type: 'findings',
      section: 'research',
      by: 'researcher',
      status: 'pending',
      parts: 1,
      part: 1,
      body: FINDINGS,
      evidence: SOURCE,
      note: 'first',
    });
    expect(r.body_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.state_seq).toBe(p.state_seq);
    await as(rt, 'boss').read({ id: p.id });
    await as(rt, 'researcher').read({ id: p.id });
    const events = readFileSync(join(rt.dir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === 'read');
    expect(events.map((e) => [e.by, e.purpose])).toEqual([
      ['dev-lead', 'review'],
      ['boss', 'audit'],
      ['researcher', 'revision'],
    ]);
  });

  it('wrong reader: an outsider is refused by rule; a consuming member sees accepted versions only', async () => {
    const rt = open();
    const p = await as(rt, 'researcher').publish();
    const out = await as(rt, 'observer').read({ id: p.id });
    expect(out).toMatchObject({ ok: false, code: 'ACCESS_READ' });
    expect(out.error).toMatch(/may not read "findings"/);
    const early = await as(rt, 'coder').read({ id: p.id });
    expect(early).toMatchObject({ ok: false, code: 'NOT_ACCEPTED_YET' });
    const explicit = await as(rt, 'coder').read({ id: p.id, version: 1 });
    expect(explicit).toMatchObject({ ok: false, code: 'ACCESS_READ' });
    expect(explicit.error).toMatch(/pending/);
    await as(rt, 'dev-lead').decide({ id: p.id, version: 1, decision: 'accept' });
    await as(rt, 'qa-lead').decide({ id: p.id, version: 1, decision: 'accept' });
    const ok = await as(rt, 'coder').read({ id: p.id });
    expect(ok).toMatchObject({ ok: true, status: 'accepted', body: FINDINGS });
    expect(rt.store.info().seq).toBeGreaterThan(0);
  });

  it('refusals log no read event', async () => {
    const rt = open();
    const p = await as(rt, 'researcher').publish();
    const before = rt.store.info().seq;
    await as(rt, 'observer').read({ id: p.id });
    await as(rt, 'coder').read({ id: p.id });
    await as(rt, 'boss').read({ id: 'findings-9' });
    expect(rt.store.info().seq).toBe(before);
  });

  it('unknown document and version, and bad part values', async () => {
    const rt = open();
    const p = await as(rt, 'researcher').publish();
    expect(await as(rt, 'boss').read({ id: 'findings-9' })).toMatchObject({ ok: false, code: 'UNKNOWN_DOCUMENT' });
    expect(await as(rt, 'boss').read({ id: p.id, version: 7 })).toMatchObject({ ok: false, code: 'UNKNOWN_VERSION' });
    expect(await as(rt, 'boss').read({ id: p.id, version: 1, part: 2 })).toMatchObject({ ok: false, code: 'PART_OUT_OF_RANGE' });
    expect((await as(rt, 'boss').read({ id: p.id, part: 0 })).schema_error).toBeDefined();
  });

  it('pages a long document: page 1 has the digest and outline, part > 1 needs an explicit version, no extra read events', async () => {
    const raw = findingsOrg({ qa: true });
    raw.documents.findings.schema = {
      type: 'object',
      required: ['rows'],
      properties: { rows: { type: 'array', items: { type: 'object' } } },
    };
    raw.documents.findings.evidence = [];
    raw.documents.findings.max_bytes = 400_000;
    const rt = open(raw);
    const rows = Array.from({ length: 400 }, (_, i) => ({ n: i, text: `row "${i}" with \\ quotes and some text to pad it out` }));
    const p = await as(rt, 'researcher').publish({ body: { rows }, evidence: undefined });
    expect(p.ok).toBe(true);
    const lead = as(rt, 'dev-lead');
    const first = await lead.read({ id: p.id });
    expect(first.parts).toBeGreaterThan(2);
    expect(first.outline).toEqual([{ key: 'rows', kind: 'array', items: 400 }]);
    expect(first.body).toBeUndefined();
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(8000);
    const bytes = await lead.call('org_doc_read', { id: p.id, part: 2 });
    expect(bytes).toMatchObject({ ok: false, code: 'PART_NEEDS_VERSION' });
    let text = first.content_part as string;
    for (let part = 2; part <= first.parts; part++) {
      const x = await lead.read({ id: p.id, version: 1, part });
      expect(x).toMatchObject({ ok: true, part, parts: first.parts, ref: 'findings-1@v1' });
      expect(JSON.stringify(x).length).toBeLessThanOrEqual(8000);
      text += x.content_part;
    }
    expect(JSON.parse(text)).toEqual({ body: { rows } });
    const reads = readFileSync(join(rt.dir, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"type":"read"'));
    expect(reads).toHaveLength(1);
  });
});

describe('decide', () => {
  it('accepts per consumer: accepted only once every consuming section accepted', async () => {
    const rt = open();
    const p = await as(rt, 'researcher').publish();
    const a = await as(rt, 'dev-lead').decide({ id: p.id, version: 1, decision: 'accept' });
    expect(a).toMatchObject({ ok: true, consumer: 'development', status: 'pending', waiting_on: ['qa'] });
    const b = await as(rt, 'qa-lead').decide({ id: p.id, version: 1, decision: 'accept' });
    expect(b).toMatchObject({ ok: true, consumer: 'qa', status: 'accepted', waiting_on: [] });
    expect(b.state_seq).toBeGreaterThan(a.state_seq);
  });

  it('one rejection rejects the version and needs a reason', async () => {
    const rt = open();
    const p = await as(rt, 'researcher').publish();
    const noReason = await as(rt, 'dev-lead').decide({ id: p.id, version: 1, decision: 'reject' });
    expect(noReason).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    const r = await as(rt, 'dev-lead').decide({ id: p.id, version: 1, decision: 'reject', reason: 'q3 is wrong' });
    expect(r).toMatchObject({ ok: true, status: 'rejected' });
    const rev = await as(rt, 'researcher').read({ id: p.id });
    expect(rev.decisions.development).toMatchObject({ decision: 'reject', reason: 'q3 is wrong', by: 'dev-lead' });
  });

  it('wrong decider is refused by rule, naming the decision makers', async () => {
    const rt = open();
    const p = await as(rt, 'researcher').publish();
    for (const role of ['coder', 'researcher', 'research-lead', 'boss', 'observer']) {
      const r = await as(rt, role).decide({ id: p.id, version: 1, decision: 'accept' });
      expect(r, role).toMatchObject({ ok: false, code: 'ACCESS_DECIDE' });
      expect(r.error).toMatch(/dev-lead \(lead of development\)/);
    }
    expect(rt.store.list()[0].versions[0].status).toBe('pending');
  });

  it('idempotent retry, derived key, identical repeat is a no-op, reversal refused', async () => {
    const rt = open();
    const p = await as(rt, 'researcher').publish();
    const lead = as(rt, 'dev-lead');
    const a = await lead.decide({ id: p.id, version: 1, decision: 'accept', idempotency_key: 'd-1' });
    const b = await lead.decide({ id: p.id, version: 1, decision: 'accept', idempotency_key: 'd-1' });
    expect(b).toMatchObject({ ok: true, replayed: true, seq: a.seq });
    const c = await lead.decide({ id: p.id, version: 1, decision: 'accept' });
    expect(c).toMatchObject({ ok: true, noop: true });
    const d = await lead.decide({ id: p.id, version: 1, decision: 'reject', reason: 'changed my mind' });
    expect(d).toMatchObject({ ok: false, code: 'REVERSAL_REFUSED' });
  });

  it('a superseded version cannot be decided; expected_state_seq is a compare-and-set', async () => {
    const rt = open();
    const w = as(rt, 'researcher');
    const v1 = await w.publish();
    const v2 = await w.publish({ body: { summary: 'second' }, supersedes: v1.ref });
    const lead = as(rt, 'dev-lead');
    expect(await lead.decide({ id: v1.id, version: 1, decision: 'accept' })).toMatchObject({ ok: false, code: 'SUPERSEDED' });
    const stale = await lead.decide({ id: v1.id, version: 2, decision: 'accept', expected_state_seq: v1.state_seq });
    expect(stale).toMatchObject({ ok: false, code: 'STATE_SEQ_CONFLICT' });
    const ok = await lead.decide({ id: v1.id, version: 2, decision: 'accept', expected_state_seq: v2.state_seq });
    expect(ok).toMatchObject({ ok: true });
  });

  it('unknown document and version', async () => {
    const rt = open();
    const p = await as(rt, 'researcher').publish();
    expect(await as(rt, 'dev-lead').decide({ id: 'findings-9', version: 1, decision: 'accept' })).toMatchObject({ ok: false, code: 'UNKNOWN_DOCUMENT' });
    expect(await as(rt, 'dev-lead').decide({ id: p.id, version: 4, decision: 'accept' })).toMatchObject({ ok: false, code: 'UNKNOWN_VERSION' });
  });
});

describe('list', () => {
  it('shows each role the types and documents it may see; schemas only to producers', async () => {
    const rt = open();
    const p = await as(rt, 'researcher').publish();
    const prod = await as(rt, 'researcher').list();
    expect(prod.types).toEqual([
      expect.objectContaining({ type: 'findings', role: 'producer', section: 'research', consumers: ['development', 'qa'], attempts_left: 3 }),
    ]);
    expect(prod.types[0].schema).toMatchObject({ type: 'object', required: ['summary'] });
    expect(prod.types[0].evidence_required).toEqual([{ kind: 'source', verify: 'cited', min: 1 }]);
    expect(prod.documents).toEqual([
      expect.objectContaining({ id: p.id, type: 'findings', section: 'research', head: expect.objectContaining({ version: 1, status: 'pending' }) }),
    ]);
    const lead = await as(rt, 'dev-lead').list();
    expect(lead.types[0]).toMatchObject({ type: 'findings', role: 'consumer-lead' });
    expect(lead.types[0].schema).toBeUndefined();
    expect(lead.documents).toHaveLength(1);
    const member = await as(rt, 'coder').list();
    expect(member.types[0]).toMatchObject({ role: 'consumer' });
    expect(member.documents).toEqual([]); // nothing accepted yet
    const outsider = await as(rt, 'observer').list();
    expect(outsider).toMatchObject({ ok: true, types: [], documents: [] });
    const root = await as(rt, 'boss').list();
    expect(root.types[0]).toMatchObject({ role: 'root' });
    expect(root.documents).toHaveLength(1);
  });

  it('filters by type, section and status', async () => {
    const rt = open();
    await as(rt, 'researcher').publish();
    const boss = as(rt, 'boss');
    expect((await boss.list({ type: 'findings' })).documents).toHaveLength(1);
    expect((await boss.list({ type: 'other' })).documents).toHaveLength(0);
    expect((await boss.list({ section: 'development' })).documents).toHaveLength(0);
    expect((await boss.list({ status: 'pending' })).documents).toHaveLength(1);
    expect((await boss.list({ status: 'accepted' })).documents).toHaveLength(0);
  });

  it('pages with a cursor bound to the caller, the filter and the listing; a mismatch is refused', async () => {
    const raw = findingsOrg();
    raw.documents.findings.max_publish_attempts = 50;
    const rt = open(raw);
    const w = as(rt, 'researcher');
    for (let i = 0; i < 70; i++) await w.publish({ body: { summary: `finding number ${i} ${'x'.repeat(80)}` } });
    const lead = as(rt, 'research-lead');
    const seen: string[] = [];
    let page = await lead.list();
    for (let guard = 0; guard < 20; guard++) {
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(8000);
      seen.push(...page.documents.map((d: any) => d.id));
      if (!page.next_cursor) break;
      page = await lead.list({ cursor: page.next_cursor });
    }
    expect(new Set(seen).size).toBe(70);
    const first = await lead.list();
    expect(first.next_cursor).toBeDefined();
    expect(await as(rt, 'boss').list({ cursor: first.next_cursor })).toMatchObject({ ok: false, code: 'CURSOR_INVALID' });
    expect(await lead.list({ cursor: first.next_cursor, type: 'findings' })).toMatchObject({ ok: false, code: 'CURSOR_INVALID' });
    await w.publish({ body: { summary: 'a new finding that changes the listing' } });
    expect(await lead.list({ cursor: first.next_cursor })).toMatchObject({ ok: false, code: 'CURSOR_INVALID' });
    expect(await lead.list({ cursor: 'garbage' })).toMatchObject({ ok: false, code: 'CURSOR_INVALID' });
  });
});

describe('error table', () => {
  it('every store error code and every tool error code has a remedy', () => {
    for (const c of [...STORE_ERROR_CODES, ...TOOL_ERROR_CODES]) expect(errorRemedy(c).length, c).toBeGreaterThan(20);
  });

  it('a store failure becomes {ok:false, code, error, remedy} (a corrupt store refuses)', async () => {
    const rt = open();
    await as(rt, 'researcher').publish();
    const sealed = rt.store as unknown as { corrupt?: unknown };
    sealed.corrupt = { code: 'STORE_CORRUPT', message: 'forced' };
    const r = await as(rt, 'researcher').publish({ body: { summary: 'after corruption' } });
    expect(r).toMatchObject({ ok: false, code: 'STORE_CORRUPT' });
    expect(r.error).toMatch(/corrupt/);
    expect(r.remedy).toBe(errorRemedy('STORE_CORRUPT'));
  });
});
