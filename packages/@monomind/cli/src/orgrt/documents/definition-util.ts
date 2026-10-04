// packages/@monomind/cli/src/orgrt/documents/definition-util.ts
/** Shared helpers of the sections definition checks (piece P3.1). */

export interface Findings {
  errors: string[];
  warnings: string[];
}

/** Section and type names become path segments, so the pattern is the traversal check. */
export const NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;

/** Built-in types with runtime-owned schemas (spec section 5); never user types. */
export const RESERVED_TYPES = ['request', 'answer'];

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
