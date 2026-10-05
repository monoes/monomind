// packages/@monomind/cli/src/orgrt/documents/tool-errors.ts
//
// What a role is told when an org_doc_* call is refused (plan P3.6). Every refusal is a tool RESULT, never an
// exception: `{ok:false, code, error, remedy, ...}`, where `error` is the message of the store or of the access
// rule that refused and `remedy` is the fixed instruction for the code, from the table below. The table covers
// every store code (a test fails when a code is added without a remedy) and the codes only the tool layer has.
import type { Refusal, StoreErrorCode } from './store-types.js';

export const TOOL_ERROR_CODES = [
  'ACCESS_PUBLISH',
  'ACCESS_READ',
  'ACCESS_DECIDE',
  'UNREAD_PARTS',
  'NOT_ACCEPTED_YET',
  'PART_OUT_OF_RANGE',
  'PART_NEEDS_VERSION',
  'CURSOR_INVALID',
  'RUNTIME_CLOSED',
  'NO_CHECKS',
  'REWORK_EXHAUSTED',
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];
export type DocErrorCode = StoreErrorCode | ToolErrorCode;

const TELL_LEAD = 'tell your lead';

const REMEDIES: Record<DocErrorCode, string> = {
  STORE_CORRUPT: `Stop publishing and deciding; ${TELL_LEAD} the document store is corrupt so the operator can recover it.`,
  STORE_IO: `Repeat the call once; if it fails again, ${TELL_LEAD} the store could not write.`,
  LOG_DIVERGED: `Stop publishing and deciding; something changed the event log outside the runtime, so ${TELL_LEAD}.`,
  REENTRANT: `Repeat the call; if it fails again this is a runtime fault, so ${TELL_LEAD}.`,
  BODY_MISSING: `This version cannot be read; ${TELL_LEAD}. The producer replaces it by publishing a revision.`,
  BODY_CORRUPT: `This version cannot be trusted; ${TELL_LEAD}. The producer replaces it by publishing a revision.`,
  UNKNOWN_TYPE: 'Use one of the types org_doc_list shows for you.',
  NOT_PRODUCER:
    'Only the producing section publishes this type; hand the work to it through your lead.',
  IDEMPOTENCY_KEY_INVALID:
    'Pass a non-empty idempotency_key of at most 200 characters without line breaks, or leave it out.',
  IDEMPOTENCY_CONFLICT:
    'Use a new idempotency_key for a different publish or decision, or repeat the original call unchanged.',
  BODY_NOT_JSON:
    'Send body as plain JSON data: objects, arrays, strings, finite numbers, booleans and null.',
  PUBLISH_EXHAUSTED: `Do not publish this type again; report the blocker to your lead.`,
  CONSISTENCY_EXHAUSTED: `Do not publish this type again; report the blocker to your lead.`,
  SUPERSEDES_INVALID:
    'Set supersedes to the id@vN of the current head of a document of this type (org_doc_list shows it), or leave it out for a new document.',
  SUPERSEDES_CONFLICT: 'Read the head this result names and revise that version.',
  TOO_LARGE: 'Shorten the document below the byte limit (org_doc_list shows it) and publish again.',
  CONTENT_INVALID:
    'Fix every problem listed (each names its path) and publish again; a refused publish uses one attempt.',
  GUARD_REFUSED:
    'Fix what the message names and publish again, or report the blocker to your lead.',
  UNKNOWN_DOCUMENT: 'Use an id from org_doc_list (form <type>-<n>).',
  UNKNOWN_VERSION: 'Use a version org_doc_list shows for that document.',
  NOT_DECIDER: 'Only the lead of a consuming section decides; ask that lead.',
  CONSUMER_AMBIGUOUS: 'Name the consuming section you decide for.',
  REVERSAL_REFUSED:
    'A decision stands. To change the outcome the producer publishes a revision, and the consumer decides on that.',
  SUPERSEDED: 'Decide on the current head version this result names.',
  VERSION_CLOSED: 'This version is already settled; org_doc_read shows its status.',
  REASON_REQUIRED: 'Give a reason that says what is wrong and what to change.',
  DECISION_INVALID: 'Set decision to "accept" or "reject".',
  STATE_SEQ_CONFLICT:
    'The document changed after you read it: read it again, then decide with its new state_seq.',
  ROLE_INVALID: `This is a runtime fault; ${TELL_LEAD}.`,
  ACCESS_PUBLISH: 'Hand the work to a role of the producing section through your lead.',
  ACCESS_READ:
    'Ask your lead; a section reads documents of a type it consumes, from the moment they are accepted.',
  ACCESS_DECIDE: 'Ask the consuming lead this result names to decide.',
  UNREAD_PARTS:
    'Read every part of this version with org_doc_read (page 1, then pass its version with part 2, 3 and so on), then decide.',
  NOT_ACCEPTED_YET: 'No version is accepted yet; ask again after the consuming leads have decided.',
  PART_OUT_OF_RANGE: 'Parts run from 1 to the parts value of the first page.',
  PART_NEEDS_VERSION: 'Read part 1 first, then pass its version together with part.',
  CURSOR_INVALID: 'Call org_doc_list again without a cursor.',
  RUNTIME_CLOSED: 'The run is stopping or has stopped; end your turn.',
  REWORK_EXHAUSTED:
    'This document is frozen because its review cycle reached max_rework_rounds: do not publish a revision of it. Tell your section lead and wait for the root, who decides it (accepts it, raises the cap and reloads, or leaves it closed).',
  NO_CHECKS:
    'This type declares no checks: read the document with org_doc_read and verify what you rely on yourself.',
};

export const errorRemedy = (code: string): string =>
  Object.hasOwn(REMEDIES, code) ? REMEDIES[code as DocErrorCode] : `Report this to your lead.`;

export interface DocFailure {
  ok: false;
  code: string;
  error: string;
  remedy: string;
  [k: string]: unknown;
}

export function failure(
  code: DocErrorCode,
  error: string,
  extra: Record<string, unknown> = {},
): DocFailure {
  return { ok: false, code, error, remedy: errorRemedy(code), ...extra };
}

/** A store refusal as a tool result: the store's own message, the remedy for its code, its details. */
export function fromRefusal(r: Refusal): DocFailure {
  const { ok: _ok, code, message, ...rest } = r;
  // a frozen thread (P4.7) is named by its own code, with the guard code kept for tools that read it
  if (rest.guard_code === 'REWORK_EXHAUSTED') return failure('REWORK_EXHAUSTED', message, rest);
  return failure(code, message, rest);
}
