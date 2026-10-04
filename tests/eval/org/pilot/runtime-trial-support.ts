// P3.15 support for the scripted (no model) tests of the runtime switch: a miniature of the parallel-sweep-3 pilot
// (the manifest's real routing and v2 contracts, cut to three documents), run twice with the SAME scripted producers and
// consumer: once on the harness hand-off layer (HandoffStore through an adapter that gives it the runtime tools' names and
// shapes, so the scripted behaviour of the P3.14 end-to-end suite runs unchanged) and once on the real runtime, through
// the translated definition and the eval gate. Every call is traced the same way on both sides.
// @ts-nocheck: loosely typed fixtures (the pilot manifest, the P3.14 cast)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Cast,
  type Plan,
} from '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/cast.js';
import {
  duplicatedSheet,
  honest,
  MINI_DOCS,
  reversedFiles,
  wrongValue,
} from '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/mini-org.js';
import {
  type Scripted,
  waitFor,
} from '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/scripted.js';
import { role } from '../../../../packages/@monomind/cli/__tests__/orgrt/support/doc-defs.js';
import type { OrgToolDef } from '../../../../packages/@monomind/cli/src/orgrt/agent-runner.js';
import { setOrgSignatureEnforcement } from '../../../../packages/@monomind/cli/src/orgrt/org-signature-enforcement.js';
import { applyContractTemplate } from './contract-template.js';
import { crossSectionRefusal } from './routing.js';
import { runtimeOrgDef } from './runtime-def.js';
import { HandoffStore } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
export const pilot = JSON.parse(readFileSync(join(here, 'parallel-sweep-3.pilot.json'), 'utf8'));
const v2 = pilot.variants.find((v) => v.id === 'v2');
export const [W1, W2, W3] = MINI_DOCS;
export { Cast, duplicatedSheet, honest, MINI_DOCS, reversedFiles, wrongValue };

/** The manifest's routing, cut to the miniature: sweep-a (worker-1 leads, worker-2 a member), sweep-b (worker-3 leads), synthesis. */
export const miniRouting = () => ({
  sections: {
    'sweep-a': pilot.routing.sections['sweep-a'],
    'sweep-b': pilot.routing.sections['sweep-b'],
    synthesis: pilot.routing.sections.synthesis,
  },
});
/** The v2 contracts of the three documents (schema with evidence, five checks, deliverable files, caps). */
export const miniContracts = () =>
  applyContractTemplate(pilot.contracts.slice(0, 3), v2.contract_template);
export const miniTrial = (handoff: 'harness' | 'runtime' = 'runtime') => ({
  runId: 'mini',
  dir: '/nowhere',
  routing: miniRouting(),
  contracts: miniContracts(),
  relay: v2.relay,
  handoff,
});

/** Roles of the miniature: the unsectioned root, the four workers of the two sweep sections, the synthesiser. */
const baseDef = (root: string) => ({
  name: 'mini-sweep',
  goal: 'sweep',
  run_config: { idle_minutes: 0, max_concurrent_agents: 20, workspace: join(root, 'workspace') },
  roles: [
    role('lead', null),
    ...[1, 2, 3, 4].map((i) => role(`worker-${i}`, 'lead')),
    role('synthesiser', 'lead'),
  ],
});
/** The miniature as the runtime switch builds it (the real translation), in a trial-shaped root (`<root>/workspace`). */
export const runtimeMiniDef = (root: string, o: { hide?: string[]; name?: string } = {}) =>
  runtimeOrgDef({ ...baseDef(root), ...(o.name ? { name: o.name } : {}) }, miniTrial('runtime'), {
    hide: o.hide,
  });

/** The scripted behaviour both sides run: worker-1 publishes a wrong value, then (after the relay) reversed files, then the
 *  honest sheets; worker-2's first document disagrees with its files, the second repeats a sheet, the relay brings the honest
 *  one; worker-3 is honest. A fault is just a body the producer chooses: nothing here is a harness fault record. */
export const faultyPlans = (): Partial<Record<string, Plan>> => ({
  [W1]: { work: [{ body: wrongValue(W1) }], relay: [{ body: reversedFiles(W1) }] },
  [W2]: { work: [{ body: duplicatedSheet(W2), files: honest(W2) }, { body: duplicatedSheet(W2) }] },
});

/** The honest document with one value and its evidence trace changed together: still passes every check. */
export function bumped(doc: string) {
  const b = honest(doc);
  const a = b.sheets[1].answers[3];
  a.value += 5;
  a.evidence[0].out += 5;
  return b;
}

export const idOf = (type: string) => `${type}-1`;
export const typeOf = (id: string) => id.replace(/-\d+$/, '');
const stripCopy = (s: string) => s.replace(/ \(copy\)$/, '');
const stripId = (s: string) => s.replace(/(module-sheets-w\d)-1\b/g, '$1');

// ---------------------------------------------------------------- the trace both sides produce

export interface Traced {
  role: string;
  tool: string;
  args: any;
  res: any;
}
export const instrument = (trace: Traced[], role: string, tools: OrgToolDef[]): OrgToolDef[] =>
  tools.map((t) => ({
    ...t,
    handler: async (args, ctx) => {
      const out = await t.handler(args, ctx);
      try {
        trace.push({ role, tool: t.name, args, res: JSON.parse(out.text) });
      } catch {
        /* a tool whose text is not JSON is not a document tool */
      }
      return out;
    },
  }));

/** A follow-up read of a body the runtime returned in parts (org_doc_read pages a body over 8,000 characters). */
export const isPartRead = (t: Traced): boolean =>
  t.tool === 'org_doc_read' && Number(t.args.part) > 1;
export const partReads = (trace: Traced[]): number => trace.filter(isPartRead).length;

/** One call, as both sides can say it: the roles, the document ref and what the call did, no ids or texts. */
export function normalized(t: Traced): { key: string; line: string } {
  const type = t.args.type ?? typeOf(String(t.args.id ?? ''));
  const ok = t.res.ok === true;
  const refusal = ok ? '' : t.res.guard_code ? 'consistency' : 'refused';
  switch (t.tool) {
    case 'org_doc_publish':
      return {
        key: ok ? `${typeOf(t.res.id)}@v${t.res.version}` : `${type}!refused`,
        line: `${t.role} publish ${ok ? 'ok' : refusal}`,
      };
    case 'org_doc_read':
      return {
        key: `${type}@v${t.res.version ?? t.args.version ?? '?'}`,
        line: `${t.role} read ${ok ? t.res.status : refusal}`,
      };
    case 'org_doc_check': {
      const flagged = (t.res.flagged ?? [])
        .map((f) => `${f.answer}:${f.failed.map((x) => x.check).join('+')}`)
        .sort();
      const docLevel = (t.res.document_failures ?? []).map((x) => x.check).sort();
      return {
        key: `${type}@v${t.res.version ?? t.args.version ?? '?'}`,
        line: `${t.role} check ${ok ? JSON.stringify({ flagged, docLevel }) : refusal}`,
      };
    }
    default:
      return {
        key: `${type}@v${t.args.version}`,
        line: `${t.role} decide ${t.args.decision} ${ok ? `-> ${t.res.status}` : refusal}`,
      };
  }
}

/** The calls grouped per document version (each group is causally ordered), refs sorted: comparable across both sides. */
export function byRef(trace: Traced[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of trace) {
    if (isPartRead(t)) continue; // the runtime's paging of a long body: counted apart (partReads), not a different call
    const { key, line } = normalized(t);
    (out[key] ??= []).push(line);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

// ---------------------------------------------------------------- the harness side

/** The harness store's four tools behind the runtime tools' names and shapes (ids are `<type>-1`), so a scripted role
 *  written against `org_doc_*` runs on either layer. Differences in result shape that matter are listed in the parity table. */
export function harnessTools(store: HandoffStore, who: string): OrgToolDef[] {
  const json = (v) => ({ text: JSON.stringify(v) });
  const last = () => store.events().at(-1);
  const fail = (r, kind: 'publish' | 'decide') => {
    const consistency = String(last()?.detail ?? '').startsWith('consistency:');
    return {
      ok: false,
      error: r.error,
      ...(r.problems ? { problems: r.problems } : {}),
      ...(consistency
        ? { guard_code: kind === 'publish' ? 'DELIVERABLE_MISMATCH' : 'DELIVERABLE_CHANGED' }
        : {}),
    };
  };
  const tool = (name, handler): OrgToolDef => ({
    name,
    description: name,
    schema: {},
    handler: async (a) => json(handler(a)),
  });
  return [
    tool('org_doc_publish', (a) => {
      const r = store.publish(who, a.type, a.body);
      return r.ok
        ? {
            ok: true,
            id: idOf(a.type),
            ref: `${idOf(a.type)}@v${r.version}`,
            version: r.version,
            status: r.status,
          }
        : fail(r, 'publish');
    }),
    tool('org_doc_read', (a) => {
      const r = store.read(who, typeOf(a.id), a.version);
      return r.ok
        ? {
            ok: true,
            id: a.id,
            version: r.doc.version,
            status: r.doc.status,
            body: r.doc.content,
            parts: 1,
          }
        : { ok: false, error: r.error };
    }),
    tool('org_doc_check', (a) => {
      const r = store.check(who, typeOf(a.id), a.version);
      if (!r.ok) return { ok: false, error: r.error };
      return {
        ok: true,
        id: a.id,
        version: r.version,
        passed: r.flagged.length === 0 && r.doc_level.length === 0,
        answers: r.answers,
        flagged: r.flagged.map((f) => ({
          answer: `${f.sheet}/${f.q}`,
          failed: f.failed.map((x) => ({ check: x.check })),
        })),
        document_failures: r.doc_level.map((x) => ({ check: x.check })),
        flagged_count: r.flagged.length,
        document_failure_count: r.doc_level.length,
      };
    }),
    tool('org_doc_decide', (a) => {
      const r = store.decide(who, typeOf(a.id), a.version, a.decision, a.reason);
      return r.ok
        ? { ok: true, id: a.id, version: a.version, status: r.status }
        : fail(r, 'decide');
    }),
  ];
}

/** A harness hand-off world with no daemon: the prototype store with its relay and consumer notices delivered to scripted
 *  role reactions, one message at a time per role (a session handles one turn at a time). */
export class HarnessWorld {
  readonly on = new Map<string, (text: string, tools: OrgToolDef[]) => Promise<void>>();
  readonly trace: Traced[] = [];
  readonly received: { to: string; subject: string; body: string }[] = [];
  readonly errors: string[] = [];
  readonly store: HandoffStore;
  private readonly chains = new Map<string, Promise<void>>();
  readonly list = () =>
    miniContracts()
      .map((c) => ({
        id: idOf(c.id),
        latest: this.store.list('synthesiser').find((d) => d.doc === c.id)?.latest,
      }))
      .filter((d) => d.latest)
      .map((d) => ({ id: d.id, head: { status: d.latest.status } }));

  constructor(readonly root: string) {
    this.store = new HandoffStore(
      join(root, 'pilot-state'),
      miniContracts(),
      undefined,
      undefined,
      {
        workspace: join(root, 'workspace'),
        relay: (m) => {
          this.deliver(m.to, m.subject, m.body);
          return undefined;
        },
        copyTo: ['lead'],
        consumerNotice: true,
      },
    );
  }

  deliver(to: string, subject: string, body: string): void {
    this.received.push({ to, subject, body });
    const react = this.on.get(to);
    if (!react) return;
    const tools = instrument(this.trace, to, harnessTools(this.store, to));
    const next = (this.chains.get(to) ?? Promise.resolve()).then(() =>
      react(`subject: ${subject}\n${body}`, tools).catch((e) => {
        this.errors.push(`${to}: ${e?.stack ?? e}`);
      }),
    );
    this.chains.set(to, next);
  }

  async idle(): Promise<void> {
    let before = -1;
    while (before !== this.received.length) {
      before = this.received.length;
      await Promise.all([...this.chains.values()]);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /** What `from` may send to `to`: the harness's section map. */
  sendRefusal(from: string, to: string): string | undefined {
    return crossSectionRefusal(miniRouting(), from, to);
  }
}

/** The scripted run on the harness layer: the same plans, the same cast. */
export async function runHarness(root: string, plans = faultyPlans) {
  const w = new HarnessWorld(root);
  const cast = new Cast(join(root, 'workspace'), plans())
    .bind(() => w)
    .install(w as unknown as Scripted);
  for (const doc of MINI_DOCS) w.deliver(workerOfDoc(doc), 'work', 'produce your sheets');
  const done = await waitFor(() => cast.synthesis !== undefined, 15000);
  await w.idle();
  return { w, cast, done };
}
export const workerOfDoc = (doc: string) => `worker-${doc.at(-1)}`;

/** The same cast, instrumented, on the runtime started through the translated definition (the world is the P3.14 `useWorld`). */
export async function runRuntime(
  world,
  plans = faultyPlans,
  o: { def?: Record<string, any>; hold?: boolean } = {},
) {
  const { Scripted } = await import(
    '../../../../packages/@monomind/cli/__tests__/orgrt/documents/e2e/scripted.js'
  );
  setOrgSignatureEnforcement(false); // fixture orgs, as in the package's own suites and support/scripted.ts
  const runner = new Scripted();
  const trace: Traced[] = [];
  const started = await world.start(o.def ?? runtimeMiniDef(world.root), { runner });
  const { d, name, docs } = started;
  const cast = new Cast(join(world.root, 'workspace'), plans())
    .bind(() => docs.store)
    .install(runner);
  for (const [r, f] of [...runner.on])
    runner.on.set(r, (t, tools) => f(t, instrument(trace, r, tools)));
  await runner.toolsOf(
    d,
    name,
    'synthesiser',
    'brief: sheets will come, process each when it is published',
  );
  await Cast.assign(d, name);
  const done = await waitFor(() => cast.synthesis !== undefined, 15000);
  await docs.notices!.idle();
  const copies = () => runner.subjects('lead').filter((s) => s.endsWith('(copy)'));
  await waitFor(() => copies().length >= 3, 3000);
  await docs.notices!.idle();
  return { ...started, runner, cast, trace, done };
}

/** Messages each role was told, as `<role>: <subject>` with the id and copy markers of the runtime removed, sorted. */
export const toldRuntime = (runner: Scripted) =>
  [...runner.turns]
    .flatMap(([r, texts]) =>
      texts.map((t) => `${r}: ${stripCopy(stripId(/subject: (.*)/.exec(t)?.[1] ?? '?'))}`),
    )
    .filter((s) => !/: (\?|brief)/.test(s)) // the operator's start-up messages to the root and the idle consumer, not hand-off traffic
    .sort();
export const toldHarness = (w: HarnessWorld) =>
  w.received.map((m) => `${m.to}: ${stripCopy(m.subject)}`).sort();
