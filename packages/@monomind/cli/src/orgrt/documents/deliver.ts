// orgrt/documents/deliver.ts
//
// One helper that sends a runtime message through the org's REAL deliver path (daemon.deliver, as the runtime
// sender `org-docs`, which is in no section and so is never cross-section refused) and reports the outcome as
// data: it never throws. Org sections plan P3.8; the producer relay (P3.9) reuses it.
//
// A receipt that starts with REFUSED or ERROR is a failed delivery; anything else ("delivered to ...", "queued
// for ...", "queued to inbox ...") means the message is in the recipient's mailbox or in the durable inbox, from
// where a starting or restarting role takes it.

/** The sender id of runtime-originated document messages; routing.ts lists it among the runtime senders. */
export const RUNTIME_SENDER = 'org-docs';

/** Delivers one message to a role of the run's own org (the daemon's deliver, bound to the org and the sender). */
export type RuntimeDeliver = (to: string, subject: string, body: string) => Promise<string>;

export type DeliveryOutcome = { ok: true; receipt: string } | { ok: false; error: string };

export async function sendRuntimeMessage(
  deliver: RuntimeDeliver,
  to: string,
  subject: string,
  body: string,
): Promise<DeliveryOutcome> {
  try {
    const receipt = await deliver(to, subject, body);
    if (typeof receipt !== 'string') return { ok: false, error: 'no delivery receipt' };
    if (/^(REFUSED|ERROR)/.test(receipt)) return { ok: false, error: receipt.slice(0, 300) };
    return { ok: true, receipt: receipt.slice(0, 300) };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
}
