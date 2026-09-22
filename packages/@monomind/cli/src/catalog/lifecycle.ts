/**
 * The mutating lifecycle verbs behind `monomind catalog approve|activate|
 * disable|quarantine|release|revoke`. Each runs one `transition` under the
 * catalog lock; `approve` also records targets and tool grants.
 */
import { CatalogStateError, mutateCatalogState, transition } from './state.js';
import {
  CATALOG_GRANTABLE_TOOLS,
  type CatalogEntry,
  type CatalogStatus,
  type CatalogTarget,
  CatalogTargetSchema,
} from './types.js';

export interface LifecycleOptions {
  /** Self-asserted provenance, recorded in history. */
  actor: string;
  reason?: string;
  now?: string;
}

export interface ApproveOptions extends LifecycleOptions {
  targets: string[];
  /** Tools to grant; must be requested by the skill and in CATALOG_GRANTABLE_TOOLS. */
  grant?: string[];
  replacesLegacy?: boolean;
}

export interface LifecycleResult {
  id: string;
  before: CatalogStatus;
  after: CatalogStatus;
  entry: CatalogEntry;
}

const GRANTABLE: readonly string[] = CATALOG_GRANTABLE_TOOLS;

function move(
  root: string,
  id: string,
  to: CatalogStatus,
  opts: LifecycleOptions,
  prepare?: (e: CatalogEntry) => CatalogEntry,
): LifecycleResult {
  let before: CatalogStatus | undefined;
  let entry: CatalogEntry | undefined;
  const now = opts.now ?? new Date().toISOString();
  mutateCatalogState(root, (state) => {
    const cur = state.entries.find((e) => e.id === id);
    if (!cur) throw new CatalogStateError(`no catalog entry ${id}`);
    before = cur.status;
    const prepared = prepare ? prepare(cur) : cur;
    const staged = { ...state, entries: state.entries.map((e) => (e.id === id ? prepared : e)) };
    const next = transition(staged, id, to, { actor: opts.actor, now, reason: opts.reason, root });
    entry = next.entries.find((e) => e.id === id);
    return next;
  });
  return { id, before: before as CatalogStatus, after: to, entry: entry as CatalogEntry };
}

function checkTargets(raw: string[]): CatalogTarget[] {
  if (raw.length === 0) throw new CatalogStateError('approve needs at least one --target');
  const targets = raw.map((t) => {
    const p = CatalogTargetSchema.safeParse(t);
    if (!p.success)
      throw new CatalogStateError(
        `unknown target "${t}" — use ${CatalogTargetSchema.options.join(', ')}`,
      );
    return p.data;
  });
  if (new Set(targets).size !== targets.length) throw new CatalogStateError('duplicate --target');
  if (targets.includes('jev') && !targets.includes('org'))
    throw new CatalogStateError('the jev target requires the org target');
  return targets;
}

function checkGrants(e: CatalogEntry, grant: string[]): CatalogEntry['grantedTools'] {
  if (grant.length && e.kind !== 'skill')
    throw new CatalogStateError('only skills take tool grants');
  for (const t of grant) {
    if (!GRANTABLE.includes(t))
      throw new CatalogStateError(
        `"${t}" is not grantable — grantable tools: ${CATALOG_GRANTABLE_TOOLS.join(', ')}`,
      );
    if (!e.inspection.requestedTools.includes(t))
      throw new CatalogStateError(`"${t}" is not requested by ${e.id}`);
  }
  return [...new Set(grant)].sort() as CatalogEntry['grantedTools'];
}

/** staged → approved, recording targets, grants and legacy replacement. */
export function approve(root: string, id: string, opts: ApproveOptions): LifecycleResult {
  const targets = checkTargets(opts.targets);
  return move(root, id, 'approved', opts, (e) => {
    if (e.inspection.verdict === 'quarantine' && !e.inspection.override)
      throw new CatalogStateError(
        `${id} has a quarantine inspection verdict; release it first (catalog release)`,
      );
    return {
      ...e,
      targets,
      grantedTools: checkGrants(e, opts.grant ?? []),
      replacesLegacy: opts.replacesLegacy === true,
    };
  });
}

/** approved or disabled → active; the package digest must verify. */
export const activate = (root: string, id: string, opts: LifecycleOptions): LifecycleResult =>
  move(root, id, 'active', opts);

export const disable = (root: string, id: string, opts: LifecycleOptions): LifecycleResult =>
  move(root, id, 'disabled', opts);

/** staged → quarantined; needs a reason. */
export const quarantine = (root: string, id: string, opts: LifecycleOptions): LifecycleResult =>
  move(root, id, 'quarantined', opts);

/** quarantined → staged; needs a reason and records `inspection.override`. */
export const release = (root: string, id: string, opts: LifecycleOptions): LifecycleResult =>
  move(root, id, 'staged', opts);

/** Any status but revoked → revoked (terminal); needs a reason. */
export const revoke = (root: string, id: string, opts: LifecycleOptions): LifecycleResult =>
  move(root, id, 'revoked', opts);
