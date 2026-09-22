/**
 * Catalog lifecycle state: `.monomind/catalog/state.json`.
 *
 * Reading never creates anything; every write goes through
 * `mutateCatalogState`, which holds `.monomind/locks/catalog.lock` (exclusive
 * create, fails safe on a stale lock) and validates the whole state before an
 * atomic write. `transition` is pure: it returns a new state.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonFileAtomic } from '../utils/json-file.js';
import { catalogDir, verifyEntry } from './digest.js';
import {
  CATALOG_SCHEMA_VERSION,
  type CatalogState,
  CatalogStateSchema,
  type CatalogStatus,
} from './types.js';

export class CatalogStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogStateError';
  }
}

export const statePath = (root: string): string => join(catalogDir(root), 'state.json');
export const lockPath = (root: string): string => join(root, '.monomind', 'locks', 'catalog.lock');

/** Lifecycle moves the catalog commands may make. Restaging changed content is `stage`'s own path. */
export const TRANSITIONS: Record<CatalogStatus, readonly CatalogStatus[]> = {
  staged: ['approved', 'quarantined', 'revoked'],
  quarantined: ['staged', 'revoked'],
  approved: ['active', 'disabled', 'revoked'],
  active: ['disabled', 'revoked'],
  disabled: ['active', 'revoked'],
  revoked: [],
};

export const HISTORY_CAP = 20;

/** The state on disk, or the empty state when absent. Never creates directories. */
export function loadCatalogState(root: string): CatalogState {
  const file = statePath(root);
  if (!existsSync(file)) return { schemaVersion: CATALOG_SCHEMA_VERSION, entries: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new CatalogStateError(`catalog state is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = CatalogStateSchema.safeParse(raw);
  if (!parsed.success)
    throw new CatalogStateError(`catalog state is invalid: ${parsed.error.message}`);
  return parsed.data;
}

/** load → fn → validate → atomic write, under the catalog lock. A throw writes nothing. */
export function mutateCatalogState(
  root: string,
  fn: (state: CatalogState) => CatalogState,
): CatalogState {
  const lock = lockPath(root);
  mkdirSync(join(root, '.monomind', 'locks'), { recursive: true });
  let fd: number;
  try {
    fd = openSync(lock, 'wx');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST')
      throw new CatalogStateError(`catalog is locked by another command: ${lock}`);
    throw e;
  }
  try {
    closeSync(fd);
    const next = CatalogStateSchema.parse(fn(loadCatalogState(root)));
    writeJsonFileAtomic(statePath(root), next);
    return next;
  } finally {
    unlinkSync(lock);
  }
}

export interface TransitionContext {
  actor: string;
  /** ISO timestamp recorded in history. */
  now: string;
  reason?: string;
  root: string;
}

/** One lifecycle move, enforced against `TRANSITIONS`. Returns a new state. */
export function transition(
  state: CatalogState,
  id: string,
  to: CatalogStatus,
  ctx: TransitionContext,
): CatalogState {
  const current = state.entries.find((e) => e.id === id);
  if (!current) throw new CatalogStateError(`no catalog entry ${id}`);
  const from = current.status;
  const allowed = TRANSITIONS[from];
  if (!allowed.includes(to))
    throw new CatalogStateError(
      `${id} is ${from}; cannot move to ${to} (allowed: ${allowed.join(', ') || 'none'})`,
    );
  const isRelease = from === 'quarantined' && to === 'staged';
  if ((to === 'quarantined' || to === 'revoked' || isRelease) && !ctx.reason?.trim())
    throw new CatalogStateError(`${from} → ${to} needs a reason`);
  if (to === 'active') {
    const check = verifyEntry(ctx.root, current);
    if (!check.ok) throw new CatalogStateError(`cannot activate ${id}: ${check.reason}`);
  }
  const history = [
    ...current.history,
    { from, to, actor: ctx.actor, at: ctx.now, ...(ctx.reason ? { reason: ctx.reason } : {}) },
  ].slice(-HISTORY_CAP);
  const inspection = isRelease
    ? {
        ...current.inspection,
        override: { actor: ctx.actor, reason: ctx.reason as string, at: ctx.now },
      }
    : current.inspection;
  const next = { ...current, status: to, inspection, history, updatedAt: ctx.now };
  return { ...state, entries: state.entries.map((e) => (e.id === id ? next : e)) };
}
