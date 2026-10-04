// P3.6 parity: the runtime org_doc_* tools (packages/@monomind/cli/src/orgrt/documents/) against the prototype
// pilot__doc_* tools that were measured (tools.ts here), driven through their real handlers on the flows the
// sweeps ran, over the committed parallel-sweep-3 contracts: publish, read, reject, republish, accept, list, and
// the refusals a role met. Each step compares what a role can observe. Where the spec intentionally differs from
// the prototype (13.1.2 items 2, 4, 5; 6.1 result bounds) a test below says so and pins the runtime's behaviour.
// No model, no corpus, no network.
// @ts-nocheck: the prototype modules are loosely typed fixtures
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { sweepOrg } from '../../../../packages/@monomind/cli/__tests__/orgrt/support/doc-defs.js';
import { openDocumentsRuntime } from '../../../../packages/@monomind/cli/src/orgrt/documents/runtime.js';
import { documentTools } from '../../../../packages/@monomind/cli/src/orgrt/documents/tools-core.js';
import { OrgDefSchema } from '../../../../packages/@monomind/cli/src/orgrt/types.js';
import { HandoffStore } from './store.js';
import { pilotTools } from './tools.js';

const here = dirname(fileURLToPath(import.meta.url));
const V1 = JSON.parse(readFileSync(join(here, 'parallel-sweep-3.pilot.json'), 'utf8')).contracts;
const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'tools-parity-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const sheet = (m: string, w: number) => ({
  module: m,
  answers: Array.from({ length: 12 }, (_, qi) => ({
    q: `q${String(qi + 1).padStart(2, '0')}`,
    value: 1000 * w + 10 * qi + Number(m.slice(1)),
    files: Array.from({ length: 4 + (qi % 4) }, (_, i) => `${m}/f${(qi * 7 + i * 3 + w) % 50}.js`),
  })),
});
const docOf = (k: number) => ({
  worker: `worker-${k}`,
  sheets: [1, 2, 3, 4].map((i) => sheet(`m${4 * (k - 1) + i}`, k)),
});

/** One scenario, both toolsets: a call goes to both and returns both parsed results. */
function pair() {
  const proto = new HandoffStore(join(mkdtempSync(join(root, 'p-')), 'proto'), V1);
  const rt = openDocumentsRuntime({
    def: OrgDefSchema.parse(sweepOrg()),
    orgDir: mkdtempSync(join(root, 'r-')),
    run: 'parity',
  })!;
  const cache = new Map();
  const tools = (kind: 'p' | 'r', role: string) => {
    const k = `${kind}:${role}`;
    if (!cache.has(k))
      cache.set(k, kind === 'p' ? pilotTools(proto, role) : documentTools(rt.forRole(role)));
    return cache.get(k);
  };
  const call = async (kind, role, name, args) => {
    const t = tools(kind, role).find((x) => x.name === name);
    return JSON.parse((await t.handler(args)).text);
  };
  const head: Record<string, string> = {};
  return {
    proto,
    rt,
    async publish(role, doc, content, note?) {
      const p = await call('p', role, 'pilot__doc_publish', { doc_id: doc, content });
      const r = await call('r', role, 'org_doc_publish', {
        type: doc,
        body: content,
        ...(head[doc] ? { supersedes: head[doc] } : {}),
        ...(note ? { note } : {}),
      });
      if (r.ok) head[doc] = r.ref;
      return { p, r };
    },
    async read(role, doc, version?) {
      const p = await call('p', role, 'pilot__doc_read', {
        doc_id: doc,
        ...(version ? { version } : {}),
      });
      const r = await call('r', role, 'org_doc_read', {
        id: `${doc}-1`,
        ...(version ? { version } : {}),
      });
      return { p, r };
    },
    async decide(role, doc, version, decision, reason?) {
      const p = await call('p', role, 'pilot__doc_decide', {
        doc_id: doc,
        version,
        decision,
        ...(reason ? { reason } : {}),
      });
      const r = await call('r', role, 'org_doc_decide', {
        id: `${doc}-1`,
        version,
        decision,
        ...(reason ? { reason } : {}),
      });
      return { p, r };
    },
    async list(role) {
      return {
        p: await call('p', role, 'pilot__doc_list', {}),
        r: await call('r', role, 'org_doc_list', {}),
      };
    },
  };
}
const same = ({ p, r }) => expect(r.ok, `${JSON.stringify(p)} vs ${JSON.stringify(r)}`).toBe(p.ok);

describe('the sweep-3 flow through the tools: publish -> read -> reject -> republish -> accept', () => {
  it('gives the same observable results step by step over the eight committed contracts', async () => {
    const s = pair();
    const docs = V1.map((c) => c.id);
    for (const [i, id] of docs.entries()) {
      const x = await s.publish(`worker-${i + 1}`, id, docOf(i + 1));
      same(x);
      expect([x.r.version, x.r.status]).toEqual([x.p.version, x.p.status]);
    }
    for (const id of docs) {
      const { p, r } = await s.read('synthesiser', id);
      same({ p, r });
      expect(r.body).toEqual(p.doc.content);
      expect([r.version, r.status]).toEqual([p.doc.version, p.doc.status]);
    }
    for (const [i, id] of docs.entries()) {
      const x =
        i === 1
          ? await s.decide('synthesiser', id, 1, 'reject', 'm6 q04 differs')
          : await s.decide('synthesiser', id, 1, 'accept');
      same(x);
      expect([x.r.status, x.r.waiting_on]).toEqual([x.p.status, x.p.waiting_on]);
    }
    const re = await s.publish('worker-2', docs[1], docOf(2), 'files fixed');
    same(re);
    expect([re.r.version, re.r.status]).toEqual([re.p.version, re.p.status]);
    expect(await s.decide('synthesiser', docs[1], 1, 'accept')).toMatchObject({
      p: { ok: false },
      r: { ok: false },
    });
    await s.read('synthesiser', docs[1], 2); // the runtime refuses a decision before the version was read (P3.16b)
    const acc = await s.decide('synthesiser', docs[1], 2, 'accept');
    same(acc);
    expect(acc.r.status).toBe('accepted');
    const final = await s.read('synthesiser', docs[1]);
    expect([final.r.version, final.r.status]).toEqual([final.p.doc.version, final.p.doc.status]);
    expect(final.r.body).toEqual(final.p.doc.content);
  });

  it('refuses the same bad publishes: a value of the wrong type, an extra field, a missing field, a non-producer', async () => {
    const s = pair();
    const id = V1[0].id;
    const bad = docOf(1);
    bad.sheets[0].answers[0].value = 'x';
    for (const [role, body] of [
      ['worker-1', bad],
      ['worker-1', { ...docOf(1), extra: 1 }],
      ['worker-1', { worker: 'worker-1' }],
      ['worker-2', docOf(1)],
    ]) {
      const x = await s.publish(role, id, body);
      expect(x.p.ok).toBe(false);
      expect(x.r.ok).toBe(false);
    }
    const x = await s.publish('worker-1', id, { worker: 'worker-1' });
    expect(x.r.problems.map((p) => p.path).sort()).toEqual(
      (x.p.problems ?? []).map((m) => m.split(':')[0]).sort(),
    );
    // the publish attempt cap counts the same: four refusals exhaust a max_attempts 4 contract in both
    const t = pair();
    for (let i = 0; i < 4; i++) await t.publish('worker-1', id, { worker: 'worker-1' });
    const last = await t.publish('worker-1', id, docOf(1));
    expect(last.p.ok).toBe(false);
    expect(last.r).toMatchObject({ ok: false, code: 'PUBLISH_EXHAUSTED' });
  });

  it('the producer, the consumer and the schema are listed to the same roles', async () => {
    const s = pair();
    const prod = await s.list('worker-1');
    expect(prod.p.documents.map((d) => d.doc)).toEqual([V1[0].id]);
    expect(prod.r.types.map((t) => t.type)).toEqual([V1[0].id]);
    expect(prod.r.types[0].schema).toEqual(prod.p.documents[0].schema);
    const syn = await s.list('synthesiser');
    expect(syn.p.documents).toHaveLength(8);
    expect(syn.r.types).toHaveLength(8);
    const other = await s.list('worker-3');
    expect(other.p.documents.map((d) => d.doc)).toEqual([V1[2].id]);
    expect(other.r.types.map((t) => t.type)).toEqual([V1[2].id]);
  });
});

describe('intentional differences from the prototype (spec 13.1.2, 6.1)', () => {
  it('a role that neither produces nor consumes a document is refused in both (the runtime names the rule)', async () => {
    const s = pair();
    await s.publish('worker-1', V1[0].id, docOf(1));
    const x = await s.read('worker-3', V1[0].id);
    expect(x.p.ok).toBe(false); // worker-3 is neither producer nor consumer in either
    expect(x.r).toMatchObject({ ok: false, code: 'ACCESS_READ' });
  });

  it('the runtime names documents <type>-<n> and results carry state_seq, refs and codes the prototype has not', async () => {
    const s = pair();
    const x = await s.publish('worker-1', V1[0].id, docOf(1));
    expect(x.p).toEqual({ ok: true, version: 1, status: 'pending' });
    expect(x.r).toMatchObject({
      ok: true,
      ref: `${V1[0].id}-1@v1`,
      id: `${V1[0].id}-1`,
      waiting_on: ['synthesis'],
      attempts_left: 4,
    });
    expect(typeof x.r.state_seq).toBe('number');
    const bad = await s.publish('worker-1', V1[1].id, { worker: 'worker-9' });
    expect(bad.r).toMatchObject({ ok: false, code: 'ACCESS_PUBLISH' });
    expect(typeof bad.p.error).toBe('string');
    expect(typeof bad.r.error).toBe('string');
    expect(bad.r.remedy.length).toBeGreaterThan(10);
  });

  it('the runtime refuses a decision on a version the decider has not read (every part of it); the prototype accepted it (P3.16b)', async () => {
    const s = pair();
    await s.publish('worker-1', V1[0].id, docOf(1));
    const x = await s.decide('synthesiser', V1[0].id, 1, 'accept');
    expect(x.p.ok).toBe(true);
    expect(x.r).toMatchObject({ ok: false, code: 'UNREAD_PARTS', unread_parts: [1] });
    await s.read('synthesiser', V1[0].id);
    expect((await s.decide('synthesiser', V1[0].id, 1, 'accept')).r.ok).toBe(true);
  });

  it('the runtime bounds a result to 8,000 characters and pages the rest; the prototype returned the whole document', async () => {
    const s = pair();
    const big = docOf(1);
    big.sheets.forEach((sh) =>
      sh.answers.forEach((a) => (a.files = a.files.map((f) => `${f}${'x'.repeat(30)}`))),
    );
    const x = await s.publish('worker-1', V1[0].id, big);
    expect(x.r.ok).toBe(true);
    const r = await s.read('synthesiser', V1[0].id);
    expect(r.p.doc.content).toEqual(big);
    expect(r.r.parts).toBeGreaterThan(1);
    let text = r.r.content_part;
    expect(JSON.stringify(r.r).length).toBeLessThanOrEqual(8000);
    for (let part = 2; part <= r.r.parts; part++) {
      const y = await (async () => {
        const t = documentTools(s.rt.forRole('synthesiser')).find((z) => z.name === 'org_doc_read');
        return JSON.parse((await t.handler({ id: `${V1[0].id}-1`, version: 1, part })).text);
      })();
      expect(JSON.stringify(y).length).toBeLessThanOrEqual(8000);
      text += y.content_part;
    }
    expect(JSON.parse(text).body).toEqual(big);
  });
});
