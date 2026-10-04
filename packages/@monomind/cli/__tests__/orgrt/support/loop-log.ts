// packages/@monomind/cli/__tests__/orgrt/support/loop-log.ts
// P4.3 test support: builds a DocState through the real reducer (applyEvent) from a short script, so every
// state a loops test looks at is one the store could have committed. It also remembers each version's `inputs`,
// which the derived state does not keep (the caller of lineageRounds passes them).
import { applyEvent, emptyState } from '../../../src/orgrt/documents/state.js';
import type { DocState } from '../../../src/orgrt/documents/state.js';
import type { StoreEvent } from '../../../src/orgrt/documents/store-types.js';

export interface PublishArgs {
  type: string;
  section: string;
  consumers: string[];
  /** Revise this document id (supersedes its head); absent: a new document. */
  doc?: string;
  inputs?: string[];
  by?: string;
}

export class Log {
  state: DocState = emptyState();
  events: StoreEvent[] = [];
  inputs = new Map<string, string[]>();

  private push(e: Record<string, unknown>): void {
    const seq = this.state.seq + 1;
    const ev = {
      seq,
      prev: '0'.repeat(64),
      at: `2026-10-04T00:00:${String(seq % 60).padStart(2, '0')}Z`,
      ...e,
    } as unknown as StoreEvent;
    applyEvent(this.state, ev);
    this.events.push(ev);
  }

  /** Returns the ref `id@vN`. */
  publish(a: PublishArgs): string {
    const d = a.doc ? this.state.docs[a.doc] : undefined;
    const id = d ? d.id : `${a.type}-${(this.state.types[a.type]?.docs ?? 0) + 1}`;
    const version = d ? d.versions.length + 1 : 1;
    const seq = this.state.seq + 1;
    this.push({
      type: 'published',
      op: `publish:${a.by ?? 'p'}:k${seq}`,
      doc: id,
      doc_type: a.type,
      section: a.section,
      version,
      by: a.by ?? `${a.section}-lead`,
      payload_sha256: 'a'.repeat(64),
      contract_revision: 'r1',
      body_sha256: 'b'.repeat(64),
      bytes: 10,
      ...(d ? { supersedes: d.versions.length } : {}),
      consumers: a.consumers,
    });
    const ref = `${id}@v${version}`;
    if (a.inputs) this.inputs.set(ref, a.inputs);
    return ref;
  }

  decide(ref: string, consumer: string, decision: 'accept' | 'reject'): void {
    const [doc, v] = ref.split('@v');
    const seq = this.state.seq + 1;
    this.push({
      type: 'decided',
      op: `decide:${consumer}:k${seq}`,
      doc,
      version: Number(v),
      consumer,
      by: `${consumer}-lead`,
      decision,
      ...(decision === 'reject' ? { reason: 'no' } : {}),
      payload_sha256: 'c'.repeat(64),
      contract_revision: 'r1',
      status_after: decision === 'reject' ? 'rejected' : 'accepted',
      waiting_on: [],
    });
  }

  inputsOf = (ref: string): readonly string[] | undefined => this.inputs.get(ref);
}
