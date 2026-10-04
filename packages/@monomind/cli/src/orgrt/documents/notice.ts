// orgrt/documents/notice.ts
//
// The publication notice and the all-available message (org sections spec 6.2 (a) to (e), requirement R24,
// plan P3.8), as pure functions over the committed event log:
//
//  - a notice obligation is DERIVED from a committed `published` event (one per decision maker of a consuming
//    section), so there is no window between the commit and the obligation, and a crash cannot lose one;
//  - the all-available obligation of a decision maker arises at the first publish after which every document
//    type its consuming sections need has a document (it is derived once, so a republish or a reopen cannot
//    repeat it);
//  - the text is built from the contract and the log only: nothing from any fault, seed or injection record.
//
// The text follows the harness prototype (tests/eval/org/pilot/notice.ts, measured in sweep-3 v2) with the
// runtime tool names; the one difference is that a runtime contract has no title, so it is named by type and
// revision (spec 6.2 (c): "the contract (id and revision)").
import type { StoreEvent, TypeBinding } from './store-types.js';

export const KIND_PUBLISHED = 'published';
export const KIND_ALL_AVAILABLE = 'all-available';

/** One thing a decision maker must be told. `key` is stable across restarts: it names the obligation. */
export interface Notice {
  key: string;
  kind: typeof KIND_PUBLISHED | typeof KIND_ALL_AVAILABLE;
  to: string;
  /** Sequence of the committed event that created the obligation (the publish that triggered it). */
  seq: number;
  /** The document and version a publish notice is about (an all-available one: the completing publish). */
  doc: string;
  version: number;
  subject: string;
  body: string;
}

/** What the notice derivation needs to know of one document type. */
export interface TypeInfo {
  type: string;
  hasChecks: boolean;
  consumers: TypeBinding['consumers'];
}

type Published = Extract<StoreEvent, { type: 'published' }>;
type Decided = Extract<StoreEvent, { type: 'decided' }>;

const pastTense = (d: 'accept' | 'reject'): string => (d === 'accept' ? 'accepted' : 'rejected');

/** The decision makers of a type, in declaration order, each once. */
export function deciders(t: Pick<TypeInfo, 'consumers'>): string[] {
  return [...new Set(t.consumers.flatMap((c) => c.deciders))];
}

/** The types a decision maker needs before it has "all documents": those whose consuming sections it decides for. */
export function neededTypes(types: readonly TypeInfo[], role: string): string[] {
  return types.filter((t) => deciders(t).includes(role)).map((t) => t.type);
}

const readyText = (checks: boolean): string =>
  `ready to read (org_doc_read), ${checks ? 'check (org_doc_check), ' : ''}and decide on (org_doc_decide)`;

/** The message a decision maker gets for one committed publish. `earlier` are the committed events before it. */
export function publishedNotice(
  e: Published,
  t: TypeInfo,
  role: string,
  earlier: readonly StoreEvent[],
): Notice {
  const sections = new Set(t.consumers.filter((c) => c.deciders.includes(role)).map((c) => c.id));
  const versions = earlier
    .filter((x): x is Published => x.type === 'published' && x.doc === e.doc)
    .map((x) => x.version)
    .sort((a, b) => a - b);
  const mine = (v: number): Decided | undefined =>
    [...earlier]
      .reverse()
      .find(
        (x): x is Decided =>
          x.type === 'decided' && x.doc === e.doc && x.version === v && sections.has(x.consumer),
      );
  const prior = [...versions].reverse().find((v) => mine(v));
  const last = versions[versions.length - 1];
  const supersedes =
    last === undefined
      ? ''
      : prior !== undefined
        ? ` It supersedes version ${prior}, which you had already decided (${pastTense((mine(prior) as Decided).decision)}): decide on this version instead.`
        : ` It supersedes version ${last}, which you had not decided: decide on this version instead.`;
  return {
    key: `p:${e.seq}:${role}`,
    kind: KIND_PUBLISHED,
    to: role,
    seq: e.seq,
    doc: e.doc,
    version: e.version,
    subject: `document ready: ${e.doc} v${e.version}`,
    body: `${e.by} published version ${e.version} of document "${e.doc}" (contract: ${t.type} ${e.contract_revision.slice(0, 12)}). It is ${readyText(t.hasChecks)}.${supersedes}`,
  };
}

/** The one message a decision maker gets when every document type it needs has a document. */
export function allAvailableNotice(
  role: string,
  e: Published,
  docs: { id: string; version: number }[],
  hasChecks: boolean,
): Notice {
  const ids = docs.map((d) => `"${d.id}" (version ${d.version})`).join(', ');
  return {
    key: `a:${role}`,
    kind: KIND_ALL_AVAILABLE,
    to: role,
    seq: e.seq,
    doc: e.doc,
    version: e.version,
    subject: 'all documents are available',
    body: `All ${docs.length} documents you consume are now available: ${ids}. Read${hasChecks ? ', check' : ''} and decide each one you have not decided yet (org_doc_read, ${hasChecks ? 'org_doc_check, ' : ''}org_doc_decide), then start your final work from the accepted documents.`,
  };
}

/**
 * Every notice the committed log obliges, in order: for each publish, the publish notices (in decider order),
 * then the all-available message of each decision maker that publish completed. Pure and deterministic, so the
 * same log always derives the same keys and the same text.
 */
export function deriveNotices(types: readonly TypeInfo[], events: readonly StoreEvent[]): Notice[] {
  const byType = new Map(types.map((t) => [t.type, t]));
  const roles = [...new Set(types.flatMap((t) => deciders(t)))];
  const out: Notice[] = [];
  const heads = new Map<string, { type: string; version: number }>(); // document id -> head
  const completed = new Set<string>(); // roles whose all-available message is already derived
  events.forEach((e, i) => {
    if (e.type !== 'published') return;
    const t = byType.get(e.doc_type);
    if (!t) return;
    heads.set(e.doc, { type: e.doc_type, version: e.version });
    const earlier = events.slice(0, i);
    for (const role of deciders(t)) out.push(publishedNotice(e, t, role, earlier));
    const have = new Set([...heads.values()].map((h) => h.type));
    for (const role of roles) {
      if (completed.has(role)) continue;
      const need = neededTypes(types, role);
      if (need.length === 0 || !need.every((n) => have.has(n))) continue;
      completed.add(role);
      const docs = [...heads]
        .filter(([, h]) => need.includes(h.type))
        .map(([id, h]) => ({ id, version: h.version }));
      out.push(
        allAvailableNotice(
          role,
          e,
          docs,
          need.some((n) => byType.get(n)?.hasChecks),
        ),
      );
    }
  });
  return out;
}
