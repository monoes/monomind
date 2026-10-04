// P3.14: the scripted behaviour of the miniature sweep's roles, as a model woken by each message would act.
//   producer: on `work` it writes its files and publishes (the next planned step, until one is accepted into the
//             store); on a relay (`document rejected` / `document needs republishing`) it writes the files and
//             publishes the next planned correction (the honest document once the plan is used up), superseding
//             the version the relay names.
//   consumer: woken by a `document ready` notice it reads that version, runs org_doc_check, and rejects it with the
//             flagged answers as the reason or accepts it; once every head is accepted it synthesises from the
//             accepted versions it reads back and writes out/synthesis.json.
// A faulty body is just a step the producer chooses; nothing here is a harness fault record.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OrgToolDef } from '../../../../src/orgrt/agent-runner.js';
import type { OrgDaemon } from '../../../../src/orgrt/daemon.js';
import type { DocumentStore } from '../../../../src/orgrt/documents/store.js';
import { MINI_DOCS, honest, idOf, workerOf, writeFiles } from './mini-org.js';
import { type Scripted, call, readAll } from './scripted.js';

type Body = ReturnType<typeof honest>;
/** A document body a producer publishes, and the files it has written before (default: the body's own). */
export interface Step {
  body: Body;
  files?: Body;
}
export interface Plan {
  work: Step[];
  /** The correction published for each relay received, in order; the honest document when used up. */
  relay?: Step[];
}
export interface Call {
  role: string;
  tool: string;
  ref?: string;
  ok: boolean;
  code?: string;
  guard_code?: string;
}

export class Cast {
  readonly calls: Call[] = [];
  readonly processed = new Set<string>();
  synthesis?: { inputs: Record<string, { version: number; status: string }>; sum_q05: number };
  /** While set, the consumer waits on it before it acts on a message (a busy consumer). */
  hold?: Promise<void>;
  private storeOf?: () => DocumentStore;
  private readonly plans: Record<string, Plan>;

  constructor(
    readonly root: string,
    plans: Partial<Record<string, Plan>> = {},
  ) {
    this.plans = {};
    for (const doc of MINI_DOCS) this.plans[doc] = { work: [{ body: honest(doc) }], ...plans[doc] };
  }

  bind(store: () => DocumentStore): this {
    this.storeOf = store;
    return this;
  }
  private get store(): DocumentStore {
    return (this.storeOf as () => DocumentStore)();
  }

  install(r: Scripted): this {
    r.on.set('synthesiser', (t, tools) => this.consume(t, tools));
    for (const doc of MINI_DOCS) r.on.set(workerOf(doc), (t, tools) => this.produce(doc, t, tools));
    return this;
  }

  private note(role: string, tool: string, res: any, ref?: string): any {
    this.calls.push({ role, tool, ref, ok: res.ok === true, code: res.code, guard_code: res.guard_code });
    return res;
  }

  private async publish(doc: string, step: Step, tools: OrgToolDef[], supersedes?: string): Promise<any> {
    writeFiles(this.root, step.files ?? step.body);
    const res = await call(tools, 'org_doc_publish', { type: doc, body: step.body, ...(supersedes ? { supersedes } : {}) });
    return this.note(workerOf(doc), 'org_doc_publish', res, res.ref);
  }

  private async produce(doc: string, text: string, tools: OrgToolDef[]): Promise<void> {
    const subject = /subject: (.*)/.exec(text)?.[1] ?? '';
    const plan = this.plans[doc];
    if (subject === 'work') {
      while (plan.work.length) {
        const res = await this.publish(doc, plan.work.shift() as Step, tools);
        if (res.ok) break;
      }
      return;
    }
    const m = /^document (?:rejected|needs republishing): (\S+) v(\d+)$/.exec(subject);
    if (m) await this.publish(doc, plan.relay?.shift() ?? { body: honest(doc) }, tools, `${m[1]}@v${m[2]}`);
  }

  private reasonOf(ck: any): string {
    const items = [
      ...(ck.document_failures ?? []).map((d: any) => `document: ${d.check}`),
      ...(ck.flagged ?? []).slice(0, 3).map((f: any) => `${f.answer}: ${f.failed.map((x: any) => x.check).join('+')}`),
    ];
    return `${items.join('; ')} (${ck.flagged_count} flagged answers, ${ck.document_failure_count} document failures)`;
  }

  private async consume(text: string, tools: OrgToolDef[]): Promise<void> {
    await this.hold;
    for (const m of text.matchAll(/document ready: (\S+) v(\d+)/g)) {
      const [, id, v] = m;
      const ref = `${id}@v${v}`;
      if (this.processed.has(ref)) continue;
      this.note('synthesiser', 'org_doc_read', await readAll(tools, { id, version: Number(v) }), ref);
      const ck = this.note('synthesiser', 'org_doc_check', await call(tools, 'org_doc_check', { id, version: Number(v) }), ref);
      const decision = ck.passed ? { decision: 'accept' } : { decision: 'reject', reason: this.reasonOf(ck) };
      const res = this.note('synthesiser', 'org_doc_decide', await call(tools, 'org_doc_decide', { id, version: Number(v), ...decision }), ref);
      if (res.ok) this.processed.add(ref);
    }
    await this.synthesise(tools);
  }

  /** Once every head is accepted: read the accepted versions back and write the synthesis from them alone. */
  private async synthesise(tools: OrgToolDef[]): Promise<void> {
    const docs = this.store.list();
    if (this.synthesis || docs.length !== MINI_DOCS.length || !docs.every((d) => d.head.status === 'accepted')) return;
    const inputs: Record<string, { version: number; status: string }> = {};
    let sum = 0;
    for (const d of docs) {
      const r = this.note('synthesiser', 'org_doc_read', await readAll(tools, { id: d.id }), d.id);
      inputs[d.id] = { version: r.version, status: r.status };
      for (const s of r.body.sheets) sum += s.answers.find((a: any) => a.q === 'q05').value;
    }
    this.synthesis = { inputs, sum_q05: sum };
    writeFileSync(join(this.root, 'out', 'synthesis.json'), JSON.stringify(this.synthesis));
  }

  /** Send each producer its work order, from the lead (the root), one after the other. */
  static async assign(d: OrgDaemon, org: string, docs = MINI_DOCS): Promise<void> {
    for (const doc of docs) await d.deliver(org, 'lead', workerOf(doc), 'work', 'produce your sheets');
  }
}

export const ids = (n = 1): string[] => MINI_DOCS.map((d) => idOf(d, n));
