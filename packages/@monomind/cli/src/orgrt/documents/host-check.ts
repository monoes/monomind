// orgrt/documents/host-check.ts
//
// org_doc_check for one role (org sections plan P3.11, open item 18b): runs the checks the document type's
// contract declares over the stored body of a version the role may read, and returns a bounded, paged result
// (check-result.ts). Pure functions over what the store holds (checks.ts): nothing is executed, no file is
// read. The access rule is org_doc_read's (resolveReadable): who may check a version is who may read it. Like
// a read, a call is recorded durably (check-journal.ts) before its result is returned; unlike a read it is not
// a `read` event, so checking a document does not count as having read it. Parts after the first are not
// recorded again.
import type { CheckJournal } from './check-journal.js';
import { shapeCheck, summarize } from './check-result.js';
import { type Check, runChecks } from './checks.js';
import type { DocResult, HostContext } from './host.js';
import { resolveReadable } from './host-resolve.js';
import { failure, fromRefusal } from './tool-errors.js';

export interface CheckArgs {
  id: string;
  version?: number;
  part?: number;
}

export function createCheck(ctx: HostContext, role: string): (a: CheckArgs) => DocResult {
  const { store, access } = ctx;
  const journal = (): CheckJournal | undefined => ctx.checks;
  const at = (): string => new Date().toISOString();

  return (a) => {
    if (ctx.isClosed())
      return failure(
        'RUNTIME_CLOSED',
        'the documents runtime of this run is closed: the run is stopping or has stopped',
      );
    const id = String(a.id);
    const part = a.part ?? 1;
    /** A refusal is recorded (best effort: the refusal itself is the result) and returned. */
    const refuse = (f: ReturnType<typeof failure>, type?: string): DocResult => {
      if (part === 1)
        try {
          journal()?.append({
            at: at(),
            by: role,
            id,
            ...(type ? { type } : {}),
            ok: false,
            code: f.code,
          });
        } catch {
          /* the journal is a count; the refusal still reaches the role */
        }
      return f;
    };
    const got = resolveReadable(store, access, role, id, a.version, part);
    if (!got.ok) return refuse(got);
    const { doc, version } = got;
    const contract = store.contracts().find((c) => c.type === doc.type)?.contract;
    const checks = (contract?.checks ?? []) as Check[];
    if (!checks.length)
      return refuse(
        failure('NO_CHECKS', `the contract of "${doc.type}" declares no checks`),
        doc.type,
      );
    const v = store.peek(id, version);
    if (!v.ok) return refuse(fromRefusal(v), doc.type);
    const declared = checks.map((c) => c.type);
    const run = runChecks(checks, v.body);
    const shaped = shapeCheck(v, run, declared, part);
    if ('outOfRange' in shaped)
      return refuse(
        failure(
          'PART_OUT_OF_RANGE',
          `the check of ${v.ref} has ${shaped.outOfRange} part${shaped.outOfRange === 1 ? '' : 's'}, not ${part}`,
        ),
        doc.type,
      );
    if (part === 1) {
      const s = summarize(run, declared);
      try {
        journal()?.append({
          at: at(),
          by: role,
          id,
          ref: v.ref,
          type: doc.type,
          ok: true,
          answers: s.answers,
          flagged: s.flagged_total,
          doc_failures: s.document_failures_total,
          per_check: s.per_check,
        });
      } catch (err) {
        return failure('STORE_IO', `the check could not be recorded: ${(err as Error).message}`);
      }
    }
    return shaped as DocResult;
  };
}
