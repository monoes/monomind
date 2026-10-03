// tests/eval/org/pilot/notice.ts
//
// The consumer notice (parallel-sweep-3 variant v2 only, harness-only, declared change consumer-publish-notice): a role
// that is idle is woken only by a message, and a publish messaged nobody, so p1t-v2's synthesiser ended its turn before any
// document existed and was never woken again. With the notice on, every publish (each version, republish included) sends
// each declared consumer of the document one short message, and the last needed document sends one 'all available' message.
// Both go through the same delivery as the producer relay (the daemon's deliver, sender pilot-relay). The text is built from
// the contract and the store's own records only: the harness's fault record never reaches it, nothing names a bad document,
// and the lead is told nothing new (it keeps the producer's own report).
import type { DocContract, DocVersion, PilotEvent } from './store.js';

export const NOTICE_PUBLISHED = 'published';
export const NOTICE_ALL_AVAILABLE = 'all-available';

export interface Notice {
  to: string;
  kind: typeof NOTICE_PUBLISHED | typeof NOTICE_ALL_AVAILABLE;
  subject: string;
  body: string;
}

const ready = (c: DocContract) =>
  `ready to read (pilot__doc_read), ${c.checks?.length ? 'check (pilot__doc_check), ' : ''}and decide on (pilot__doc_decide)`;

/** The message one consumer gets when `version` of `c` is published; `earlier` are the versions before it. */
export function publishedNotice(
  c: DocContract,
  version: number,
  consumer: string,
  earlier: DocVersion[],
): Notice {
  const prior = [...earlier].reverse().find((v) => v.decisions[consumer]);
  const supersedes = earlier.length
    ? prior
      ? ` It supersedes version ${prior.version}, which you had already decided (${prior.decisions[consumer].decision}ed): decide on this version instead.`
      : ` It supersedes version ${earlier[earlier.length - 1].version}, which you had not decided: decide on this version instead.`
    : '';
  return {
    to: consumer,
    kind: NOTICE_PUBLISHED,
    subject: `document ready: ${c.id} v${version}`,
    body: `${c.producer} published version ${version} of document "${c.id}" (contract: ${c.title}). It is ${ready(c)}.${supersedes}`,
  };
}

/** The one message a consumer gets when every document it consumes has a version. */
export function allAvailableNotice(
  consumer: string,
  docs: { c: DocContract; latest: number }[],
): Notice {
  const ids = docs.map((d) => `"${d.c.id}" (version ${d.latest})`).join(', ');
  const checks = docs.some((d) => d.c.checks?.length);
  return {
    to: consumer,
    kind: NOTICE_ALL_AVAILABLE,
    subject: 'all documents are available',
    body: `All ${docs.length} documents you consume are now available: ${ids}. Read${checks ? ', check' : ''} and decide each one you have not decided yet (pilot__doc_read, ${checks ? 'pilot__doc_check, ' : ''}pilot__doc_decide), then start your final work from the accepted documents.`,
  };
}

type Deliver = (m: {
  to: string;
  subject: string;
  body: string;
}) => string | Promise<string | undefined> | undefined;

/** Delivers one notice and records it as a `notice` event; a receipt starting REFUSED or ERROR is recorded as failed. */
export function sendNotice(
  deliver: Deliver,
  record: (e: Omit<PilotEvent, 'at'>) => void,
  doc: string,
  version: number,
  n: Notice,
): void {
  const ev = { kind: 'notice' as const, role: 'harness', doc, version };
  const info = { to: n.to, kind: n.kind };
  const failed = (error: string) =>
    record({ ...ev, ok: false, detail: JSON.stringify({ ...info, error }) });
  try {
    record({ ...ev, ok: true, detail: JSON.stringify(info) });
    Promise.resolve(deliver({ to: n.to, subject: n.subject, body: n.body }))
      .then((receipt) => {
        if (typeof receipt === 'string' && /^(REFUSED|ERROR)/.test(receipt)) failed(receipt);
      })
      .catch((e) => failed(String(e)));
  } catch (e) {
    failed(String(e));
  }
}
