// P3.8 parity: the runtime publication notice and all-available message (packages/@monomind/cli/src/orgrt/documents/
// notice.ts) against the harness prototype text that sweep-3 v2 measured (notice.ts here). The runtime derives its
// text from a real store and event log; the prototype builds it from its own contract and version records. The
// comparison normalises the two intended differences: the tool prefix (pilot__doc_* -> org_doc_*) and the contract
// naming (the prototype names a contract by title, a runtime contract has no title and is named by type and
// revision, spec 6.2 (c)). Everything else, sentence for sentence, must be equal. No model, no network.
// @ts-nocheck: the prototype modules are loosely typed fixtures
import { describe, expect, it } from 'vitest';
import {
  briefBinding,
  must,
  open,
  pub,
  tickingClock,
  tmp,
} from '../../../../packages/@monomind/cli/__tests__/orgrt/documents/store-support.js';
import { NoticeEngine } from '../../../../packages/@monomind/cli/src/orgrt/documents/notices.js';
import { allAvailableNotice, publishedNotice } from './notice.js';

const unify = (s: string) =>
  s.replace(/pilot__doc_/g, 'org_doc_').replace(/\(contract: [^)]*\)/, '(contract: C)');

const plan = {
  ...briefBinding({}, [{ id: 'writing', deciders: ['writer'] }]),
  contract: { type: 'plan', schema: briefBinding().contract.schema, max_publish_attempts: 3 },
};

async function runtime(bindings = [briefBinding()]) {
  const dir = tmp('p38-parity-');
  const store = open(dir, { bindings });
  const engine = new NoticeEngine({ dir, store, now: tickingClock() });
  const sent: { to: string; subject: string; body: string }[] = [];
  engine.start({
    deliver: async (to, subject, body) => (sent.push({ to, subject, body }), `delivered to ${to}`),
  });
  return { store, engine, sent };
}
const proto = (over = {}) => ({
  id: 'brief-1',
  title: 'T',
  producer: 'researcher',
  consumers: ['writer', 'reviewer'],
  ...over,
});

describe('the publish notice: runtime text equals the measured prototype text', () => {
  it('first publish, without and with checks', async () => {
    for (const checks of [[], [{ type: 'files_match_evidence' }]]) {
      const r = await runtime([briefBinding({ checks })]);
      must(r.store.publish(pub()));
      await r.engine.idle();
      const want = publishedNotice(proto({ checks }), 1, 'writer', []);
      const got = r.sent.find((m) => m.to === 'writer' && m.subject.startsWith('document ready'));
      expect(got.subject).toBe(want.subject);
      expect(unify(got.body)).toBe(unify(want.body));
    }
  });

  it.each([
    ['not decided', undefined],
    ['already accepted', 'accept'],
    ['already rejected', 'reject'],
  ])('a republish over a version the consumer had %s', async (_name, decision) => {
    const r = await runtime();
    const v1 = must(r.store.publish(pub()));
    if (decision)
      must(
        r.store.decide({
          role: 'writer',
          id: 'brief-1',
          version: 1,
          decision,
          ...(decision === 'reject' ? { reason: 'no' } : {}),
          idempotency_key: 'k-d',
        }),
      );
    must(r.store.publish(pub({ supersedes: v1.ref })));
    await r.engine.idle();
    const earlier = [{ version: 1, decisions: decision ? { writer: { decision } } : {} }];
    const want = publishedNotice(proto(), 2, 'writer', earlier);
    const got = r.sent.find((m) => m.to === 'writer' && m.subject === 'document ready: brief-1 v2');
    expect(got.subject).toBe(want.subject);
    expect(unify(got.body)).toBe(unify(want.body));
  });
});

describe('the all-available message: runtime text equals the measured prototype text', () => {
  it('lists every id with its version, with and without checks', async () => {
    const r = await runtime([briefBinding({}, [{ id: 'writing', deciders: ['writer'] }]), plan]);
    must(r.store.publish(pub()));
    must(r.store.publish(pub({ type: 'plan' })));
    await r.engine.idle();
    const got = r.sent.find(
      (m) => m.to === 'writer' && m.subject === 'all documents are available',
    );
    const want = allAvailableNotice('writer', [
      { c: proto({ id: 'brief-1' }), latest: 1 },
      { c: proto({ id: 'plan-1' }), latest: 1 },
    ]);
    expect(got.subject).toBe(want.subject);
    expect(unify(got.body)).toBe(unify(want.body));
    const withChecks = await runtime([
      briefBinding({ checks: [{ type: 'files_match_evidence' }] }),
    ]);
    must(withChecks.store.publish(pub()));
    await withChecks.engine.idle();
    const gotC = withChecks.sent.find(
      (m) => m.to === 'writer' && m.subject === 'all documents are available',
    );
    const wantC = allAvailableNotice('writer', [
      { c: proto({ checks: [{ type: 'files_match_evidence' }] }), latest: 1 },
    ]);
    expect(unify(gotC.body)).toBe(unify(wantC.body));
  });
});
