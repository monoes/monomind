/**
 * The derived, disposable view of the catalog: state entries joined with the
 * frontmatter of their verified packages. Pure — no writes, no registry, no
 * network — and body-free. Cached per root on the state file's mtime + size;
 * packages are content-addressed, so they need no re-hash until state changes.
 * `catalogAudit` (and doctor) bypass the cache and re-hash.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, skillRoots } from '../orgrt/skill-library.js';
import { verifyEntry } from './digest.js';
import { loadCatalogState, statePath } from './state.js';
import type { CatalogEntry, CatalogState, CatalogStatus, CatalogTarget } from './types.js';

export interface CatalogAsset {
  id: string;
  kind: CatalogEntry['kind'];
  name: string;
  status: CatalogStatus;
  targets: CatalogTarget[];
  grantedTools: string[];
  replacesLegacy: boolean;
  description: string;
  tags: string[];
  requestedTools: string[];
  sha256: string;
  source: CatalogEntry['source'];
  /** Digest verified (always false for revoked entries). */
  eligible: boolean;
  /** Verified package directory; absent when verification failed. */
  dir?: string;
}

export interface CatalogDiagnostic {
  id: string;
  reason: string;
}

export interface CatalogSnapshot {
  assets: CatalogAsset[];
  diagnostics: CatalogDiagnostic[];
  stateVersion: number | null;
}

const asList = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : v.split(/[,\s]+/).filter(Boolean);
const asStr = (v: string | string[] | undefined): string =>
  v === undefined ? '' : Array.isArray(v) ? v.join(', ') : v;

/** Authored metadata from a verified package: frontmatter or blueprint.json. */
function readMeta(
  kind: CatalogEntry['kind'],
  dir: string,
): { description: string; tags: string[]; tools: string[] } {
  if (kind === 'blueprint') {
    const bp = JSON.parse(readFileSync(join(dir, 'blueprint.json'), 'utf8')) as {
      description?: unknown;
    };
    return {
      description: typeof bp.description === 'string' ? bp.description : '',
      tags: [],
      tools: [],
    };
  }
  const { data } = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
  return {
    description: asStr(data.description),
    tags: asList(data.tags),
    tools: [...new Set(asList(data.tools))].sort(),
  };
}

function toAsset(root: string, e: CatalogEntry, diagnostics: CatalogDiagnostic[]): CatalogAsset {
  const base: CatalogAsset = {
    id: e.id,
    kind: e.kind,
    name: e.id.slice(e.id.indexOf(':') + 1),
    status: e.status,
    targets: e.targets,
    grantedTools: e.grantedTools,
    replacesLegacy: e.replacesLegacy,
    description: '',
    tags: [],
    requestedTools: e.inspection.requestedTools,
    sha256: e.sha256,
    source: e.source,
    eligible: false,
  };
  if (e.status === 'revoked') return base;
  const check = verifyEntry(root, e);
  if (!check.ok) {
    diagnostics.push({ id: e.id, reason: check.reason });
    return base;
  }
  try {
    const meta = readMeta(e.kind, check.dir);
    return {
      ...base,
      description: meta.description,
      tags: meta.tags,
      requestedTools: meta.tools.length ? meta.tools : base.requestedTools,
      eligible: true,
      dir: check.dir,
    };
  } catch {
    diagnostics.push({ id: e.id, reason: 'unreadable-metadata' });
    return base;
  }
}

function snapshotOf(root: string, state: CatalogState): CatalogSnapshot {
  const diagnostics: CatalogDiagnostic[] = [];
  const assets = [...state.entries]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => toAsset(root, e, diagnostics));
  return { assets, diagnostics, stateVersion: state.schemaVersion };
}

const EMPTY = (): CatalogSnapshot => ({ assets: [], diagnostics: [], stateVersion: null });
const cache = new Map<string, { key: string; snap: CatalogSnapshot }>();

/** Verified, body-free view of the catalog; empty (and file-free) without state.
 *  An unreadable state yields no assets and one `(state)` diagnostic, so
 *  consumers keep their legacy behaviour instead of failing. */
export function buildSnapshot(root: string): CatalogSnapshot {
  const st = statSync(statePath(root), { throwIfNoEntry: false });
  if (!st) return EMPTY();
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(root);
  if (hit?.key === key) return hit.snap;
  let snap: CatalogSnapshot;
  try {
    snap = snapshotOf(root, loadCatalogState(root));
  } catch (e) {
    snap = { ...EMPTY(), diagnostics: [{ id: '(state)', reason: (e as Error).message }] };
  }
  cache.set(root, { key, snap });
  return snap;
}

/** Active, verified assets that name `target`. */
export function eligible(snapshot: CatalogSnapshot, target: CatalogTarget): CatalogAsset[] {
  return snapshot.assets.filter(
    (a) => a.status === 'active' && a.eligible && a.targets.includes(target),
  );
}

export interface CatalogAuditReport {
  /** False only when an active entry has a problem. */
  ok: boolean;
  configured: boolean;
  active: number;
  activeByTarget: Partial<Record<CatalogTarget, number>>;
  entries: { id: string; status: CatalogStatus; problems: string[] }[];
  legacyCollisions: {
    name: string;
    legacyOrigin: string;
    catalogId: string;
    replacesLegacy: boolean;
  }[];
  stale: { id: string; status: CatalogStatus; ageDays: number }[];
  /** Set when state.json exists but cannot be read. */
  error?: string;
}

/** Entries sitting this long in a non-terminal, non-active status are stale. */
const STALE_DAYS = 30;
const DAY_MS = 86_400_000;

function entryProblems(e: CatalogEntry, verify: string | undefined): string[] {
  const problems: string[] = [];
  if (verify) problems.push(verify);
  const live = e.status === 'approved' || e.status === 'active';
  if (live && e.inspection.verdict === 'quarantine' && !e.inspection.override)
    problems.push('quarantine-verdict-without-override');
  const notRequested = e.grantedTools.filter((t) => !e.inspection.requestedTools.includes(t));
  if (notRequested.length) problems.push(`granted-not-requested: ${notRequested.join(', ')}`);
  return problems;
}

/** Re-hashes every entry and reports; repairs nothing. */
export function catalogAudit(root: string, now: number = Date.now()): CatalogAuditReport {
  const report: CatalogAuditReport = {
    ok: true,
    configured: existsSync(statePath(root)),
    active: 0,
    activeByTarget: {},
    entries: [],
    legacyCollisions: [],
    stale: [],
  };
  if (!report.configured) return report;
  let state: CatalogState;
  try {
    state = loadCatalogState(root);
  } catch (e) {
    return { ...report, ok: false, error: (e as Error).message };
  }
  const snap = snapshotOf(root, state);
  const failed = new Map(snap.diagnostics.map((d) => [d.id, d.reason]));
  const legacy = skillRoots(root);
  for (const e of [...state.entries].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const problems = entryProblems(e, failed.get(e.id));
    report.entries.push({ id: e.id, status: e.status, problems });
    if (e.status === 'active') {
      report.active++;
      for (const t of e.targets) report.activeByTarget[t] = (report.activeByTarget[t] ?? 0) + 1;
      if (problems.length) report.ok = false;
    }
    const name = e.id.slice(e.id.indexOf(':') + 1);
    const hit =
      e.kind !== 'blueprint' && e.status !== 'revoked'
        ? legacy.find((r) => existsSync(join(r.dir, name, 'SKILL.md')))
        : undefined;
    if (hit)
      report.legacyCollisions.push({
        name,
        legacyOrigin: hit.origin,
        catalogId: e.id,
        replacesLegacy: e.replacesLegacy,
      });
    const ageDays = Math.floor((now - Date.parse(e.updatedAt)) / DAY_MS);
    if (e.status !== 'active' && e.status !== 'revoked' && ageDays >= STALE_DAYS)
      report.stale.push({ id: e.id, status: e.status, ageDays });
  }
  return report;
}
