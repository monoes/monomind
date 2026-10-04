// P3.15: the INTENTIONAL differences between the harness hand-off layer and the runtime document tools, as a table with a
// reason for each (the spec's own decisions, 13.1.2) and an executable check, so the table cannot rot and nothing the parity
// test (handoff-runtime-mode.test.ts) treats as equal is hiding a difference. A difference not in this table is a parity bug.
// @ts-nocheck: loosely typed fixtures
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFiles } from '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/mini-org.js';
import {
  call,
  useWorld,
} from '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/scripted.js';
import { faultInjector, planFaults } from './fault-injection.js';
import { pilotOrgDef, RELAY_SENDER } from './harness.js';
import { crossSectionRefusal } from './routing.js';
import { RUNTIME_SENDER, runtimeOrgDef } from './runtime-def.js';
import {
  bumped,
  HarnessWorld,
  harnessTools,
  honest,
  idOf,
  isPartRead,
  miniContracts,
  miniRouting,
  miniTrial,
  partReads,
  runHarness,
  runRuntime,
  runtimeMiniDef,
  W1,
  W2,
} from './runtime-trial-support.js';
// @ts-expect-error plain .mjs module
import { trialView } from './runtime-view.mjs';

export const DIFFERENCES = [
  {
    id: 'ids',
    harness: 'a document is its contract id (module-sheets-w1)',
    runtime: 'ids are <type>-<n> (module-sheets-w1-1), issued at the first publish',
    reason: 'spec 13.1.2 (2): follows the spec, revisions pin supersedes id@vN',
  },
  {
    id: 'sender',
    harness: 'notices and relays are sent as pilot-relay',
    runtime: 'they are sent as org-docs, which the section map never refuses',
    reason: 'spec 13.1.2 decision 9: the runtime sender is not a role of the org',
  },
  {
    id: 'copy-recipient',
    harness: 'the short copy of a relay goes to the roles the variant names (the root, lead)',
    runtime: 'it goes to the lead of the producing section, or the root when the producer leads',
    reason:
      "P3.9 / open item 17: the section lead is who reassigns; in sweep-3 worker-2 is a member of worker-1's section",
  },
  {
    id: 'message-text',
    harness: 'rejection and notice texts name the contract by title and say pilot__doc_*',
    runtime:
      'they name it by type and revision and say org_doc_*; the rejection adds the rework round',
    reason:
      'a runtime contract has no title (spec 6.2 (c)); the reason, document and version are in both',
  },
  {
    id: 'attempt-accounting',
    harness: 'every publish, accepted or refused, uses one of max_attempts',
    runtime:
      'only a refused publish uses a max_publish_attempts attempt; a consistency refusal uses a separate budget in both',
    reason:
      'spec 6.2: attempts count refusals under the contract revision; the manifest numbers carry over as caps on refusals',
  },
  {
    id: 'paging',
    harness: 'org doc_read returns the whole body',
    runtime:
      'org_doc_read returns a body over 8,000 characters in parts the caller fetches (part: n)',
    reason:
      'spec 6.1: a tool result is bounded; the follow-up reads are not extra reads in the record',
  },
  {
    id: 'size-limit',
    harness: 'a version may hold max_chars (30,000 for v2) characters of JSON',
    runtime: 'a version may hold 1 MiB; max_chars is not carried over',
    reason: "spec 13.1.2 decision 3: the size limit is the spec's 1 MiB per version",
  },
  {
    id: 'check-result',
    harness: 'doc_check: passed is a count of answers that pass',
    runtime:
      'org_doc_check: passed is the verdict (true when nothing is flagged); the flagged list is paged',
    reason:
      'spec 6.1 result shape; the flagged answers and the checks that failed them are equal (parity test)',
  },
  {
    id: 'access',
    harness: 'only the named producer publishes and reads; only a named consumer decides',
    runtime:
      'any role of the producing section publishes and reads; the consuming lead decides; other consuming members read accepted versions',
    reason: 'spec 13.1.2 (5): static section rules instead of per-role grants',
  },
  {
    id: 'revision',
    harness: 'one document per contract: a second publish replaces the pending version',
    runtime:
      'a revision names the head it supersedes (supersedes: id@vN); a publish without it opens a NEW document of the type (<type>-2), which the consumer is told about as another document',
    reason:
      'spec 13.1.2 (2): ids are issued at the first publish, a revision pins its head; the role text and the relay carry the supersedes argument',
  },
  {
    id: 'recorded-refusals',
    harness: 'every call is in pilot-events.jsonl, a refused read and check included',
    runtime:
      'events.jsonl holds committed events and counted refusals only; a refused read or check, and an accept refused for a changed file, leave no event (the last is read from the relay obligation)',
    reason: 'spec 6.2: the log is the state, not a call log',
  },
  {
    id: 'fault-injection',
    harness: 'a publish-time injector may change the body a consumer reads (fault-injection.ts)',
    runtime:
      'none: bodies are immutable and hash-checked; a switch-on trial is a no-fault trial and its fault measures are n/a unless a test-only fault record is supplied',
    reason:
      'the injector is test-only and must not enter product code; a wrapper on the tool arguments would run before the deliverable guard and so change what is measured',
  },
  {
    id: 'role-text',
    harness: 'a placeholder tool provider and one responsibilities line per sectioned role',
    runtime: 'no provider; the runtime adds its own document block to the role prompt (P3.12)',
    reason: 'spec 13.1.8: the attach mechanism is not a model for the runtime',
  },
  {
    id: 'event-shapes',
    harness: 'pilot-store.json (state) and pilot-events.jsonl (call log)',
    runtime:
      'events.jsonl (hash-chained, derives the state), notices.jsonl (delivery journal), checks.jsonl, bus doc-* events; read through runtime-view.mjs',
    reason: 'spec 13.1.2 (8): event sourcing',
  },
  {
    id: 'refusal-text',
    harness:
      'cross-section send: "Refused: ... pilot__doc_publish"; recorded as a send-refused store event',
    runtime:
      'cross-section send: "REFUSED: ... org_doc_publish, or raise it with the root, who can reach any section"; audited on the bus as cross-section-refused',
    reason:
      'tool names, and the root sentence: the harness keeps the measured text that points at a lead-to-lead path, the runtime text no longer does (open item 25, P4.9); the allow/refuse decisions are equal (parity test)',
  },
  {
    id: 'phase4-keys',
    harness:
      'none of the Phase 4 keys exist: no single writer, no section budget, no rework cap, no loop, no lead rights; a harness trial has no budget, escalation or writer records',
    runtime:
      'writes, budget, max_rework_rounds and loops act in the real daemon; a variant may carry them (a phase4 block, default off) only on the r switch, and the trial reads with a phase4 block of counts when their records exist',
    reason:
      'Phase 4 is runtime-only (spec 13.2): building the keys into the prototype would measure a different thing, and no committed manifest declares them (runtime-def-phase4.test.ts, handoff-runtime-phase4.test.ts)',
  },
];

const proved = new Set<string>();
const prove = (id: string) => proved.add(id);
const world = useWorld('p315-diff');
const tmp = (tag: string) => mkdtempSync(join(process.env.TMPDIR ?? '/var/tmp', `${tag}-`));

describe('the table', () => {
  it('lists each difference once, with a reason', () => {
    expect(new Set(DIFFERENCES.map((d) => d.id)).size).toBe(DIFFERENCES.length);
    for (const d of DIFFERENCES)
      expect(
        [d.harness, d.runtime, d.reason].every((t) => t.length > 20),
        d.id,
      ).toBe(true);
  });
});

describe('differences shown by the faulty miniature loop run on both layers', () => {
  it('ids, sender, copy recipient, message text, attempt accounting, paging, size limit, event shapes, role text', async () => {
    const h = await runHarness(tmp('p315-dh'));
    const r = await runRuntime(world);
    // ids
    expect(h.w.store.contracts().map((c) => c.id)).toContain(W1);
    expect(r.docs.store.list().map((d) => d.id)).toContain(idOf(W1));
    prove('ids');
    // sender
    const rt = (to: string, subject: RegExp) => r.runner.texts(to).find((t) => subject.test(t));
    expect(rt('worker-1', /subject: document rejected/)).toMatch(/^\[message from org-docs\]/);
    expect(RUNTIME_SENDER).toBe('org-docs');
    expect(RELAY_SENDER).toBe('pilot-relay');
    prove('sender');
    // copy recipient: worker-2's rejection is copied to worker-1 (the section lead) on the runtime, to the root on the harness
    const copies = (told: string[]) =>
      told.filter((s) => /document rejected: module-sheets-w2/.test(s));
    expect(
      r.runner.subjects('worker-1').filter((s) => /module-sheets-w2-1 v1 \(copy\)/.test(s)),
    ).toHaveLength(1);
    expect(
      r.runner.subjects('lead').filter((s) => /module-sheets-w2-1 v1 \(copy\)/.test(s)),
    ).toHaveLength(0);
    expect(copies(h.w.received.filter((m) => m.to === 'lead').map((m) => m.subject))).toHaveLength(
      1,
    );
    expect(
      copies(h.w.received.filter((m) => m.to === 'worker-1').map((m) => m.subject)),
    ).toHaveLength(0);
    prove('copy-recipient');
    // message text: both carry the reason, the document and the version; the runtime names the revision and says org_doc_*
    const hText = h.w.received.find((m) => m.to === 'worker-1' && /rejected/.test(m.subject)).body;
    const rText = rt('worker-1', /subject: document rejected/);
    for (const t of [hText, rText]) expect(t).toContain('value_matches_chain');
    expect(hText).toContain('pilot__doc_publish');
    expect(hText).toContain('(contract: ');
    expect(rText).toContain('org_doc_publish');
    expect(rText).toMatch(/contract: module-sheets-w1 [0-9a-f]{12}\)/);
    expect(rText).not.toContain('pilot__');
    prove('message-text');
    // attempt accounting: the harness counts the three successful publishes of worker-1's document, the runtime none of them
    expect(h.w.store.attempts(W1)).toBe(3);
    expect(r.docs.store.attempts(W1)).toMatchObject({ used: 0, refusals_used: 0 });
    expect(r.docs.store.attempts(W2)).toMatchObject({ used: 0, refusals_used: 1 }); // the consistency refusal, counted apart
    prove('attempt-accounting');
    // paging: the runtime body comes in parts (the extra reads are not reads in the record); the harness returns it whole
    expect(partReads(r.trace)).toBeGreaterThan(0);
    expect(partReads(h.w.trace)).toBe(0);
    const part1 = r.trace.find((t) => t.tool === 'org_doc_read' && t.res.ok && !isPartRead(t)).res;
    expect(part1.parts).toBeGreaterThan(1);
    expect(trialView(r.d.root).events.filter((e) => e.kind === 'read').length).toBe(
      trialView(h.w.root).events.filter((e) => e.kind === 'read').length,
    );
    prove('paging');
    // size limit: the harness contract bounds characters, the runtime one is the 1 MiB default
    expect(miniContracts()[0].max_chars).toBe(30000);
    expect(r.docs.store.contracts().map((c) => c.contract.max_bytes)).toEqual([
      1048576, 1048576, 1048576,
    ]);
    prove('size-limit');
    // event shapes
    const hv = trialView(h.w.root);
    expect(hv.source).toBe('harness');
    const { readdirSync, readFileSync } = await import('node:fs');
    expect(readdirSync(join(h.w.root, 'pilot-state')).sort()).toEqual([
      'pilot-events.jsonl',
      'pilot-store.json',
    ]);
    expect(readdirSync(r.docs.dir)).toEqual(
      expect.arrayContaining(['events.jsonl', 'notices.jsonl', 'checks.jsonl']),
    );
    const first = JSON.parse(readFileSync(join(r.docs.dir, 'events.jsonl'), 'utf8').split('\n')[0]);
    expect(first).toMatchObject({ seq: 1, prev: '0'.repeat(64), type: expect.any(String) });
    prove('event-shapes');
    // role text: the harness definition carries the placeholder provider and a line; the runtime one neither, and the role prompt has the runtime block
    const rtDef = runtimeMiniDef('/x');
    const harnessDef = pilotOrgDef(
      { name: 'x', roles: rtDef.roles.map((x) => ({ id: x.id, responsibilities: [] })) },
      miniTrial('harness'),
    );
    expect(harnessDef.roles.find((x) => x.id === 'worker-1').tool_providers[0].name).toBe('pilot');
    expect(harnessDef.roles.find((x) => x.id === 'worker-1').responsibilities.join(' ')).toContain(
      'pilot__doc_publish',
    );
    expect(rtDef.roles.some((x) => x.tool_providers)).toBe(false);
    expect(r.runner.systemPrompts.get('worker-1')).toContain('org_doc_publish');
    expect(r.runner.systemPrompts.get('worker-1')).not.toContain('pilot__');
    prove('role-text');
  }, 90000);
});

describe('differences that need their own small scenario', () => {
  it('check result shape, access, revision, recorded refusals and the injector', async () => {
    const { Scripted } = await import(
      '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/scripted.js'
    );
    const { setOrgSignatureEnforcement } = await import(
      '../../../../packages/@monomind/cli/src/orgrt/org-signature-enforcement.js'
    );
    setOrgSignatureEnforcement(false);
    const runner = new Scripted();
    const { d, name, docs } = await world.start(runtimeMiniDef(world.root), { runner });
    const hroot = tmp('p315-ds');
    const hw = new HarnessWorld(hroot);
    const ws = (root: string) => join(root, 'workspace');
    const [rw1, rw2, rw3, rsyn] = await Promise.all(
      ['worker-1', 'worker-2', 'worker-3', 'synthesiser'].map((r) => runner.toolsOf(d, name, r)),
    );
    const hh = (role: string) => harnessTools(hw.store, role);
    writeFiles(ws(hroot), honest(W1));
    writeFiles(ws(world.root), honest(W1));

    // revision: the harness takes a second publish as the new version of the document; the runtime opens a second document of
    // the type unless the publish names the head it supersedes
    expect(await call(rw1, 'org_doc_publish', { type: W1, body: honest(W1) })).toMatchObject({
      ok: true,
      id: idOf(W1),
    });
    expect(
      await call(hh('worker-1'), 'org_doc_publish', { type: W1, body: honest(W1) }),
    ).toMatchObject({ ok: true });
    writeFiles(ws(hroot), bumped(W1));
    writeFiles(ws(world.root), bumped(W1));
    expect(await call(rw1, 'org_doc_publish', { type: W1, body: bumped(W1) })).toMatchObject({
      ok: true,
      id: `${W1}-2`,
      version: 1,
    });
    expect(
      await call(hh('worker-1'), 'org_doc_publish', { type: W1, body: bumped(W1) }),
    ).toMatchObject({ ok: true, version: 2 });
    expect(docs.store.list().map((x) => x.id)).toEqual([idOf(W1), `${W1}-2`]);
    prove('revision');

    // access: worker-2 (a member of worker-1's section) reads and publishes worker-1's type on the runtime, not on the harness
    expect(await call(rw2, 'org_doc_read', { id: idOf(W1) })).toMatchObject({ ok: true });
    expect(await call(hh('worker-2'), 'org_doc_read', { id: W1 })).toMatchObject({ ok: false });
    expect(
      await call(hh('worker-2'), 'org_doc_publish', { type: W1, body: bumped(W1) }),
    ).toMatchObject({ ok: false });
    expect(
      await call(rw2, 'org_doc_publish', {
        type: W1,
        body: bumped(W1),
        supersedes: `${idOf(W1)}@v1`,
      }),
    ).toMatchObject({ ok: true, version: 2 });
    prove('access');

    // check result shape: passed is a count on the harness, a verdict on the runtime (the flagged answers are equal)
    const rc = await call(rsyn, 'org_doc_check', { id: idOf(W1), version: 2 });
    const hc = hw.store.check('synthesiser', W1, 2);
    expect(typeof rc.passed).toBe('boolean');
    expect(rc.passed).toBe(true);
    expect(typeof hc.passed).toBe('number');
    expect(hc.passed).toBe(hc.answers);
    prove('check-result');

    // recorded refusals: a refused read is an event on the harness, none on the runtime
    await docs.notices.idle(); // the notices of the publishes above are delivered asynchronously
    const before = trialView(world.root).events.length;
    const refusedReads = (root: string) =>
      trialView(root).events.filter((e) => e.kind === 'read' && !e.ok).length;
    const hbefore = refusedReads(hroot);
    expect(await call(rw3, 'org_doc_read', { id: idOf(W1) })).toMatchObject({ ok: false });
    expect(await call(hh('worker-3'), 'org_doc_read', { id: W1 })).toMatchObject({ ok: false });
    expect(trialView(world.root).events.length).toBe(before);
    expect(refusedReads(hroot)).toBe(hbefore + 1);
    expect(refusedReads(world.root)).toBe(0);
    prove('recorded-refusals');

    // fault injection: the harness store can change a body at its first publish; the runtime store returns exactly what was published
    const injected = new (await import('./store.js')).HandoffStore(
      join(tmp('p315-di'), 'pilot-state'),
      miniContracts(),
      undefined,
      faultInjector(
        planFaults(
          20261004,
          miniContracts().map((c) => c.id),
          ['wrong-value-q05'],
        ),
      ),
      { workspace: ws(hroot) },
    );
    const sent = honest(W1);
    writeFiles(ws(hroot), sent);
    injected.publish('worker-1', W1, sent);
    expect(injected.read('synthesiser', W1).doc.content).not.toEqual(sent);
    expect(docs.store.peek(idOf(W1), 1).body).toEqual(sent);
    expect('injector' in docs.store).toBe(false);
    prove('fault-injection');
    expect(runner.errors).toEqual([]);
  }, 60000);

  it('cross-section refusal text and its record', async () => {
    const { Scripted } = await import(
      '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/scripted.js'
    );
    const { setOrgSignatureEnforcement } = await import(
      '../../../../packages/@monomind/cli/src/orgrt/org-signature-enforcement.js'
    );
    setOrgSignatureEnforcement(false);
    const runner = new Scripted();
    const { d, name, running } = await world.start(runtimeMiniDef(world.root), { runner });
    const w1 = await runner.toolsOf(d, name, 'worker-1');
    const text = (
      await w1
        .find((t) => t.name === 'org_send')
        .handler({ to: 'worker-3', subject: 's', message: 'm' })
    ).text;
    const hText = crossSectionRefusal(miniRouting(), 'worker-1', 'worker-3');
    expect(hText).toMatch(/^Refused: .*pilot__doc_publish/);
    expect(text).toMatch(
      /^REFUSED: .*org_doc_publish.*raise it with the root, who can reach any section/,
    );
    expect(running.busEvents().filter((e) => e.reason === 'cross-section-refused')).toHaveLength(1);
    prove('refusal-text');
  }, 60000);

  it('the Phase 4 keys exist on the runtime definition only: the harness definition has none of them', () => {
    const rtDef = runtimeMiniDef('/x');
    const harnessDef = pilotOrgDef(
      { name: 'x', roles: rtDef.roles.map((x) => ({ id: x.id, responsibilities: [] })) },
      miniTrial('harness'),
    );
    for (const k of ['sections', 'loops', 'requires']) expect(harnessDef[k]).toBeUndefined();
    expect(harnessDef.run_config?.budget_usd).toBeUndefined();
    const withKeys = runtimeOrgDef(
      { name: 'x', roles: rtDef.roles.map((x) => ({ id: x.id, responsibilities: [] })) },
      miniTrial('runtime'),
      { phase4: { sections: { synthesis: { max_rework_rounds: 2 } }, budget_usd: 50 } },
    );
    expect(withKeys.sections.synthesis.max_rework_rounds).toBe(2);
    expect(withKeys.run_config.budget_usd).toBe(50);
    expect(trialView(tmp('p413-none')).phase4).toBeUndefined();
    prove('phase4-keys');
  });

  it('every row of the table was proved by a check above', () => {
    expect([...proved].sort()).toEqual(DIFFERENCES.map((x) => x.id).sort());
  });
});
