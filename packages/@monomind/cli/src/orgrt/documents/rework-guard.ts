// orgrt/documents/rework-guard.ts
//
// The freeze of a spent review cycle (org sections plan P4.7): a store guard on the `revise` seam. A publish that
// supersedes a document whose thread with some consuming section is frozen (rework.ts) is refused with
// REWORK_EXHAUSTED. The refusal is NOT counted: it runs before the size and content checks and commits nothing, so
// it never uses the type's publish attempts or its consistency budget. A first publish of a new document of the
// type is not a revision and is untouched. The caps are read from the live definition at every call and the state
// from the store, so nothing about a freeze is stored.
import { frozenThreads, type ReworkCaps } from './rework.js';
import type { DocState } from './state.js';
import type { StoreGuard } from './store-types.js';

export const REWORK_EXHAUSTED = 'REWORK_EXHAUSTED';

export interface ReworkGuardOptions {
  state(): DocState;
  caps(): ReworkCaps;
  /** The role that decides a spent thread. */
  root: string | undefined;
}

export function reworkGuard(o: ReworkGuardOptions): StoreGuard {
  return {
    revise(ctx) {
      const t = frozenThreads(o.state(), o.caps(), ctx.doc)[0];
      if (!t) return undefined;
      const root = o.root ?? 'the root';
      return {
        code: REWORK_EXHAUSTED,
        message: `"${ctx.doc}" cannot be revised: its review cycle with ${t.consumer} is spent (${t.rounds} of ${t.cap} rework rounds, sections.${t.consumer}.max_rework_rounds), so the thread is frozen and ${root} decides it (accept it, raise the cap and reload, or leave it closed). Wait for ${root} or your section lead; do not publish it again.`,
      };
    },
  };
}
