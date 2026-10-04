// orgrt/documents/deliverable-guards.ts
//
// Deliverable consistency, the store half (plan P3.10): two store guards (the P3.5 `addGuard` seam).
//  - publish: a document that disagrees with the producer's own `deliverable_files` is refused, naming the file
//    and the first differing field. It is a `consistency` refusal: counted against max_consistency_refusals
//    (then the store fails closed), never against max_publish_attempts. A file that is missing or unreadable is
//    refused the same way; an unresolvable workspace is refused and not counted (the producer did nothing wrong).
//  - decide: an accept re-reads the files and compares them with what the producer SENT (the committed body,
//    never a copy a consumer saw). A file that changed since the publish refuses the accept; the producer must
//    publish a corrected version. Not counted, nothing committed; `onChanged` gets the facts for the relay.
// Contracts without `deliverable_files` pass through untouched.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { OrgDaemon } from '../daemon.js';
import type { RunningOrg } from '../daemon-types.js';
import { ORG_DIR } from '../types.js';
import { deliverableMismatches, type Mismatch } from './deliverables.js';
import type { DocumentsRuntime } from './runtime.js';
import type { GuardRefusal, StoreGuard } from './store-types.js';

export const DELIVERABLE_MISMATCH = 'DELIVERABLE_MISMATCH';
export const DELIVERABLE_CHANGED = 'DELIVERABLE_CHANGED';
export const DELIVERABLE_WORKSPACE_UNAVAILABLE = 'DELIVERABLE_WORKSPACE_UNAVAILABLE';

/** What a refused accept tells whoever relays it to the producer. */
export interface DeliverableChange {
  type: string;
  doc: string;
  version: number;
  producer: string;
  decider: string;
  consumer: string;
  files: string[];
  problems: string[];
}

export interface DeliverableGuardOptions {
  /** The workspace directory of a producing role, or undefined when it cannot be resolved. */
  workspaceOf(role: string): string | undefined;
  /** Called synchronously when an accept is refused for a changed file. Must not call back into the store. */
  onChanged?(c: DeliverableChange): void;
}

const MAX_SHOWN = 4;
const joined = (bad: Mismatch[]): string =>
  bad
    .slice(0, MAX_SHOWN)
    .map((b) => b.problem)
    .join('; ') + (bad.length > MAX_SHOWN ? `; and ${bad.length - MAX_SHOWN} more` : '');

export function deliverableGuard(o: DeliverableGuardOptions): StoreGuard {
  const unavailable = (role: string): GuardRefusal => ({
    code: DELIVERABLE_WORKSPACE_UNAVAILABLE,
    message: `the workspace of ${role} is not available, so its deliverable files cannot be checked`,
  });
  return {
    publish(ctx) {
      const list = ctx.contract.deliverable_files;
      if (!list.length) return undefined;
      const ws = o.workspaceOf(ctx.role);
      if (!ws) return unavailable(ctx.role);
      const bad = deliverableMismatches(ws, list, ctx.body);
      if (!bad.length) return undefined;
      return {
        code: DELIVERABLE_MISMATCH,
        counts: 'consistency',
        message: `"${ctx.type}" disagrees with your deliverable files, so it was not published: ${joined(bad)}. Fix the file or the document so they agree, then publish again.`,
        problems: bad.map((b) => b.problem),
      };
    },
    decide(ctx) {
      const list = ctx.contract.deliverable_files;
      if (ctx.decision !== 'accept' || !list.length) return undefined;
      const ws = o.workspaceOf(ctx.producer);
      if (!ws) return unavailable(ctx.producer);
      const bad = deliverableMismatches(ws, list, ctx.body);
      if (!bad.length) return undefined;
      o.onChanged?.({
        type: ctx.type,
        doc: ctx.doc,
        version: ctx.version,
        producer: ctx.producer,
        decider: ctx.role,
        consumer: ctx.consumer,
        files: bad.map((b) => b.file),
        problems: bad.map((b) => b.problem),
      });
      return {
        code: DELIVERABLE_CHANGED,
        message: `version ${ctx.version} cannot be accepted: the producer's deliverable files changed after it was published (${joined(bad)}). The producer must publish a corrected version; decide on that one.`,
        problems: bad.map((b) => b.problem),
      };
    },
  };
}

/** Where a role's own files are: the path its spawned session was given (a worktree), else its worktree under
 *  worktree-per-role (the boss keeps the shared directory), else the run's directory. */
export function bindRoleWorkspaces(
  documents: Pick<DocumentsRuntime, 'bindWorkspaces'>,
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
  cwd: string,
): void {
  const perRole = daemon.workspaceSetting(running.def) === 'worktree-per-role';
  documents.bindWorkspaces((role) => {
    const live = running.roleSlots.get(role)?.runtime?.worktreePath;
    if (live) return live;
    if (!perRole || role === running.bossRoleId) return cwd;
    const wt = join(daemon.root, ORG_DIR, name, `worktree-${role}`);
    return existsSync(wt) ? wt : cwd;
  });
}
