// tests/eval/org/pilot/relay.ts
//
// The producer relay (parallel-sweep-3 variant v2, harness-only): when a consumer rejects a version, the store
// asks the harness to tell the producing role directly, so the rejection no longer depends on a lead passing it
// on. The message is built only from the contract and the consumer's own reason: the harness's fault record
// never reaches it. The lead gets a short copy so it can reassign. The harness delivers through the daemon's
// own `deliver` (harness.ts), so the cross-section send refusal on that path still applies to every role.
import type { DocContract, PilotEvent } from './store.js';

export type RelayReason = 'rejected' | 'deliverable-changed';

/** A message the store asks the harness to deliver (producer relay, copy to the lead). */
export interface RelayMessage {
  to: string;
  subject: string;
  body: string;
}

export interface StoreOptions {
  /** The producers' workspace, for contracts that declare deliverables. */
  workspace?: string;
  /** Delivers a relay message; a receipt starting REFUSED or ERROR is recorded as a failed relay. */
  relay?: (m: RelayMessage) => string | Promise<string | undefined> | undefined;
  /** Roles that get a short copy of every relay message, so the lead can follow along. */
  copyTo?: string[];
  /** Variant v2 only (needs `relay`): each declared consumer gets one message per publish and one when every
   *  document it consumes has a version (notice.ts). Off by default, so v1 behaves as committed. */
  consumerNotice?: boolean;
}

/** The text a producer gets for a rejection: document, version, contract, reason, attempts left, what to do. */
export function rejectionMessage(
  c: DocContract,
  version: number,
  by: string,
  reason: string,
  attemptsUsed: number,
): { body: string; copy: string } {
  const left = Math.max(c.max_attempts - attemptsUsed, 0);
  const attempts =
    left > 0
      ? `Publish attempts for this document: ${attemptsUsed} of ${c.max_attempts} used, ${left} left.`
      : `All ${c.max_attempts} publish attempts for this document are used, so no further publish will be accepted: tell your lead.`;
  const files = c.deliverables?.map((d) => d.file).join(', ');
  return {
    body: [
      `${by} rejected version ${version} of document "${c.id}" (contract: ${c.title}).`,
      `Reason given: ${reason}`,
      attempts,
      `What to do: check the underlying deliverable${files ? ` (${files})` : ''} against the code and fix it if the reason holds, then publish a corrected version with pilot__doc_publish; it replaces the rejected one. If you are sure the reason is wrong, publish the same content again with a short note (the note argument of pilot__doc_publish) saying why.`,
    ].join(' '),
    copy: `${by} rejected ${c.id} v${version}: ${reason} (${c.producer} was notified directly, no relay needed; publish attempts left ${left}).`,
  };
}

/** One message to the producer and a short copy to each `copyTo` role, each recorded as a `relay` event. */
export function sendRelay(
  opts: StoreOptions,
  record: (e: Omit<PilotEvent, 'at'>) => void,
  c: DocContract,
  version: number,
  reason: RelayReason,
  body: string,
  by: string,
  copy?: string,
): void {
  if (!opts.relay) return;
  const subject = `document ${reason === 'rejected' ? 'rejected' : 'needs republishing'}: ${c.id} v${version}`;
  const send = (to: string, text: string, kind: 'producer' | 'lead') => {
    const ev = { kind: 'relay' as const, role: 'harness', doc: c.id, version };
    const info = { to, to_kind: kind, reason, by };
    const failed = (error: string) =>
      record({ ...ev, ok: false, detail: JSON.stringify({ ...info, error }) });
    try {
      record({ ...ev, ok: true, detail: JSON.stringify(info) });
      Promise.resolve(opts.relay?.({ to, subject, body: text }))
        .then((receipt) => {
          if (typeof receipt === 'string' && /^(REFUSED|ERROR)/.test(receipt)) failed(receipt);
        })
        .catch((e) => failed(String(e)));
    } catch (e) {
      failed(String(e));
    }
  };
  send(c.producer, body, 'producer');
  for (const to of opts.copyTo ?? [])
    send(to, copy ?? `${c.id} v${version} is back with ${c.producer}: ${body}`, 'lead');
}
