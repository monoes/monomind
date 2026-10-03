// Variant v2 of parallel-sweep-3 (declared change handoff-relay-consistency-check), scripted with no model, part 1: the
// checks dialect, the contract template, deliverable consistency at publish and accept, the injector's compatibility with
// it, and doc_check, through the REAL HandoffStore and pilot tools. Part 2 (relay and the whole loop): handoff-v2-relay.test.ts.
// @ts-nocheck: plain .mjs modules
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSupportedChecks, runChecks } from './checks.js';
import { deliverableMismatches } from './deliverables.js';
import type { T } from './handoff-v2-support.js';
import {
  correctDoc,
  DOCS,
  events,
  filePath,
  fileSheet,
  mods,
  publishAll,
  S,
  trial,
  useV2Corpus,
  V1,
  V2,
  variant,
} from './handoff-v2-support.js';
import { HandoffStore } from './store.js';
import { pilotTools } from './tools.js';

useV2Corpus();

describe('checks dialect: fails closed, deterministic, nothing executed', () => {
  it('refuses an unknown check type or parameter, naming where', () => {
    expect(() => assertSupportedChecks([{ type: 'sum_equals' }], 'c')).toThrow(
      /unknown check type "sum_equals"/,
    );
    expect(() => assertSupportedChecks([{ type: 'files_match_evidence', x: 1 }], 'c')).toThrow(
      /parameter "x"/,
    );
    expect(() => assertSupportedChecks([{ type: 'value_type', is: 'string' }], 'c')).toThrow(
      /integer/,
    );
    expect(
      () => new HandoffStore(join(S.tmp, 'bad'), [{ ...V1[0], checks: [{ type: 'nope' }] }]),
    ).toThrow(/contract invalid/);
    assertSupportedChecks(variant.contract_template.checks);
  });

  it('passes an honest document and names each failing answer and check', () => {
    const c = V2[0].checks;
    expect(runChecks(c, correctDoc('module-sheets-w1'))).toMatchObject({
      answers: 48,
      flagged: [],
      doc_level: [],
    });
    const d = correctDoc('module-sheets-w1');
    d.sheets[1].answers[4].value += 9;
    d.sheets[0].answers[0].files.reverse();
    d.sheets[3].answers = structuredClone(d.sheets[2].answers);
    const r = runChecks(c, d);
    const by = (s: string, q: string) =>
      r.flagged.find((f) => f.sheet === s && f.q === q)?.failed.map((x) => x.check);
    expect(by('m2', 'q05')).toEqual(['value_matches_chain']);
    expect(by('m1', 'q01')).toEqual(['files_match_evidence']);
    expect(by('m4', 'q01')).toEqual(['files_in_module']);
    expect(r.doc_level).toEqual([expect.objectContaining({ check: 'unique_across_sheets' })]);
    expect(
      runChecks(c, {
        sheets: [{ module: 'm1', answers: [{ q: 'q01', value: 'x', files: [] }] }],
      }).flagged[0].failed.map((f) => f.check),
    ).toEqual(expect.arrayContaining(['value_type', 'value_matches_chain']));
  });

  it('a producer who fabricates consistent evidence is not caught (the honest limit)', () => {
    const d = correctDoc('module-sheets-w1');
    const a = d.sheets[0].answers[4];
    a.value += 9;
    a.evidence[0].out = a.value;
    expect(runChecks(V2[0].checks, d)).toMatchObject({ flagged: [], doc_level: [] });
  });
});

describe('the contract template derives v2 from v1 and leaves v1 alone', () => {
  it('adds evidence, the size limit, four deliverable files per contract and the checks; v1 contracts are untouched', () => {
    expect(V1[0].deliverables).toBeUndefined();
    expect(JSON.stringify(V1)).not.toMatch(/evidence/);
    expect(V2).toHaveLength(8);
    V2.forEach((c, k) => {
      expect(c.deliverables.map((d) => d.file)).toEqual(
        mods(c.id).map((m) => `out/${m}/answers.json`),
      );
      expect(c.max_attempts).toBe(4);
      expect(c.max_refusals).toBe(5);
      expect(c.schema.properties.sheets.items.properties.answers.items.required).toContain(
        'evidence',
      );
      expect(c.producer).toBe(V1[k].producer);
    });
  });

  it('a real document with evidence fits the limit', () => {
    const size = JSON.stringify(correctDoc('module-sheets-w1')).length;
    const plain = JSON.stringify({
      worker: 'worker-1',
      sheets: mods('module-sheets-w1').map(fileSheet),
    }).length;
    expect(size).toBeLessThan(V2[0].max_chars);
    expect(size / plain).toBeGreaterThan(1.5);
  });
});

describe('deliverable consistency at publish', () => {
  it('refuses a document that disagrees with its file, naming the file and the first differing field; the refusal is not a publish attempt', async () => {
    const t = trial(null);
    const bad = correctDoc('module-sheets-w1');
    bad.sheets[2].answers[3].value += 1;
    const r = await t.as('worker-1')('doc_publish', { doc_id: 'module-sheets-w1', content: bad });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(
      /out\/m3\/answers\.json differs from the document's sheets entry m3 at \$\.answers\[3\]\.value/,
    );
    expect(r.error).not.toMatch(/out\/m1\/|out\/m2\//);
    expect(t.store.attempts('module-sheets-w1')).toBe(0);
    expect(t.store.refusals('module-sheets-w1')).toBe(1);
    expect(
      await t.as('worker-1')('doc_publish', {
        doc_id: 'module-sheets-w1',
        content: correctDoc('module-sheets-w1'),
      }),
    ).toMatchObject({ ok: true, version: 1 });
    const ev = t.store.events().find((e) => e.kind === 'publish' && !e.ok);
    expect(ev).toMatchObject({ file: 'out/m3/answers.json' });
    expect(ev.detail).toMatch(/^consistency: /);
  });

  it('refuses a missing or unreadable file, and a document missing a sheet', async () => {
    const t = trial(null);
    rmSync(filePath(t.root, 'm2'));
    writeFileSync(filePath(t.root, 'm4'), 'not json');
    const r = await t.as('worker-1')('doc_publish', {
      doc_id: 'module-sheets-w1',
      content: correctDoc('module-sheets-w1'),
    });
    expect(r.error).toMatch(/out\/m2\/answers\.json does not exist/);
    expect(r.error).toMatch(/out\/m4\/answers\.json is not valid JSON/);
    const d = correctDoc('module-sheets-w2');
    d.sheets[0].module = 'm6';
    expect(
      (await t.as('worker-2')('doc_publish', { doc_id: 'module-sheets-w2', content: d })).error,
    ).toMatch(/does not match its contract|no sheets entry/);
  });

  it('ignores the document-only evidence and the files own extra keys, but not module, q, value or files', async () => {
    const t = trial(null);
    const f = JSON.parse(readFileSync(filePath(t.root, 'm1'), 'utf8'));
    writeFileSync(
      filePath(t.root, 'm1'),
      JSON.stringify({ ...f, note: 'extra', answers: f.answers.map((a) => ({ ...a, extra: 1 })) }),
    );
    const d = correctDoc('module-sheets-w1');
    d.sheets[0].answers[0].evidence[1].out += 5; // evidence differs from nothing in the file: ignored
    expect(
      await t.as('worker-1')('doc_publish', { doc_id: 'module-sheets-w1', content: d }),
    ).toMatchObject({ ok: true });
    const reordered = correctDoc('module-sheets-w2');
    reordered.sheets[1].answers[0].files.reverse();
    reordered.sheets[1].answers[0].evidence.reverse();
    expect(
      (await t.as('worker-2')('doc_publish', { doc_id: 'module-sheets-w2', content: reordered }))
        .error,
    ).toMatch(/answers\[0\]\.files\[0\]/);
  });

  it('caps consistency refusals at 5 per document, then fails closed even for a consistent document', async () => {
    const t = trial(null);
    const bad = correctDoc('module-sheets-w1');
    bad.sheets[0].answers[0].value += 1;
    for (let i = 0; i < 5; i++)
      expect(
        (await t.as('worker-1')('doc_publish', { doc_id: 'module-sheets-w1', content: bad })).ok,
      ).toBe(false);
    const r = await t.as('worker-1')('doc_publish', {
      doc_id: 'module-sheets-w1',
      content: correctDoc('module-sheets-w1'),
    });
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(
      /5 publishes .* refused for disagreeing with your files; report the blocker to your lead/,
    );
    expect(t.store.attempts('module-sheets-w1')).toBe(0);
  });
});

describe('injector and consistency are compatible: the check uses the producer original, never the injected copy', () => {
  it('a corrupted version is published and accepted against the unchanged file, while the consumer copy differs from it', async () => {
    const t = trial(20261004);
    await publishAll(t);
    const f = t.plan.faults.find((x) => x.class === 'wrong-value-q05');
    const seen = await t.as('synthesiser')('doc_read', { doc_id: f.doc });
    const contract = V2.find((c) => c.id === f.doc);
    expect(
      deliverableMismatches(join(t.root, 'workspace'), contract.deliverables, seen.doc.content)
        .length,
    ).toBeGreaterThan(0);
    expect(
      await t.as('synthesiser')('doc_decide', { doc_id: f.doc, version: 1, decision: 'accept' }),
    ).toMatchObject({ ok: true, status: 'accepted' });
    // nothing the consumer can call exposes the originals
    for (const out of [
      seen,
      await t.as('synthesiser')('doc_check', { doc_id: f.doc }),
      await t.as('synthesiser')('doc_list'),
    ])
      expect(JSON.stringify(out)).not.toMatch(/original/);
  });

  it('an accept is refused once a deliverable file changed since the publish, the producer is told, and a republish is accepted', async () => {
    const t = trial(null);
    await publishAll(t);
    const doc = 'module-sheets-w3';
    const f = JSON.parse(readFileSync(filePath(t.root, 'm10'), 'utf8'));
    f.answers[2].value += 1;
    writeFileSync(filePath(t.root, 'm10'), JSON.stringify(f));
    const r = await t.as('synthesiser')('doc_decide', {
      doc_id: doc,
      version: 1,
      decision: 'accept',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(
      /deliverable files changed after it was published.*out\/m10\/answers\.json differs/,
    );
    expect((await t.as('synthesiser')('doc_read', { doc_id: doc, version: 1 })).doc.status).toBe(
      'pending',
    );
    expect(events(t, 'decide').at(-1)).toMatchObject({ ok: false, file: 'out/m10/answers.json' });
    expect(t.sent.map((m) => m.to)).toEqual(['worker-3', 'lead']);
    expect(t.sent[0].body).toMatch(/changed after you published it/);
    const d = correctDoc(doc);
    d.sheets[1].answers[2].value += 1;
    d.sheets[1].answers[2].evidence[0].out += 1;
    await t.as('worker-3')('doc_publish', { doc_id: doc, content: d });
    expect(
      await t.as('synthesiser')('doc_decide', { doc_id: doc, version: 2, decision: 'accept' }),
    ).toMatchObject({ ok: true, status: 'accepted' });
  });
});

describe('doc_check for the consumer, recorded in the event log', () => {
  it('flags the wrong value, the reversed files and the copied sheet the injector made, and nothing else', async () => {
    const t = trial(20261004);
    await publishAll(t);
    const flagged: Record<string, any> = {};
    for (const doc of DOCS) {
      const r = await t.as('synthesiser')('doc_check', { doc_id: doc });
      expect(r).toMatchObject({ ok: true, version: 1 });
      expect(r.note).toMatch(/not prove it right/);
      if (r.flagged.length || r.doc_level.length) flagged[doc] = r;
    }
    expect(Object.keys(flagged).sort()).toEqual(t.plan.faults.map((f) => f.doc).sort());
    const by = (cls: string) => flagged[t.plan.faults.find((f) => f.class === cls).doc];
    expect(by('wrong-value-q05').flagged.map((x) => [x.q, x.failed.map((y) => y.check)])).toEqual([
      ['q05', ['value_matches_chain']],
    ]);
    expect(by('wrong-value-q07').flagged).toHaveLength(1);
    expect(by('files-order').flagged.map((x) => x.q)).toEqual(['q01', 'q02']);
    expect(by('files-order').flagged[0].failed[0].check).toBe('files_match_evidence');
    expect(by('duplicate-sheet').doc_level[0].check).toBe('unique_across_sheets');
    expect(
      by('duplicate-sheet').flagged.every((x) =>
        x.failed.some((y) => y.check === 'files_in_module'),
      ),
    ).toBe(true);
    const ev = events(t, 'check');
    expect(ev).toHaveLength(8);
    expect(ev.every((e) => e.ok && e.role === 'synthesiser')).toBe(true);
    expect(await t.as('synthesiser')('doc_check', { doc_id: 'nope' })).toMatchObject({ ok: false });
    expect(await t.as('worker-1')('doc_check', { doc_id: 'module-sheets-w2' })).toMatchObject({
      ok: false,
    });
    expect(events(t, 'check')).toHaveLength(10);
  });

  it('is offered only where checks are declared, and the v1 tools are exactly the original four', () => {
    const v1 = trial(null, { contracts: V1, relay: false });
    const names = (t: T, role: string) => pilotTools(t.store, role).map((x) => x.name);
    expect(names(v1, 'synthesiser')).toEqual([
      'pilot__doc_list',
      'pilot__doc_publish',
      'pilot__doc_read',
      'pilot__doc_decide',
    ]);
    expect(
      Object.keys(
        pilotTools(v1.store, 'worker-1').find((x) => x.name === 'pilot__doc_publish')!.schema,
      ),
    ).toEqual(['doc_id', 'content']);
    const v2 = trial(null);
    expect(names(v2, 'synthesiser')).toContain('pilot__doc_check');
    expect(
      Object.keys(
        pilotTools(v2.store, 'worker-1').find((x) => x.name === 'pilot__doc_publish')!.schema,
      ),
    ).toEqual(['doc_id', 'content', 'note']);
  });
});
