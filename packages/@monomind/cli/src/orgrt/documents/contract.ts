// orgrt/documents/contract.ts
//
// The effective document contract and its revision (org sections spec 6.2). `effectiveContract` validates a
// contract fail-closed (every problem at once, with a path) and fills defaults; `contractRevision` hashes it.
// Revision definition: sha-256, lowercase hex, over the UTF-8 bytes of the canonical JSON (canonical.ts) of
//   { "checks_dialect": "org-checks-v1", "contract": <effective contract>, "dialect": "org-schema-v1" }
// The schema contents are inside the contract (a file path is never hashed), so the revision moves with the
// schema, evidence requirements, checks, deliverable files, acceptance, visibility, freshness policy, gates and
// limits, and with either dialect version, and with nothing else. Deferred spec features (provisional, owner,
// confidential, ...) are unknown fields here, so they fail validate instead of being ignored.
import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical.js';
import { CHECKS_DIALECT, validateChecks } from './checks.js';
import { type DocProblem, throwIfProblems } from './errors.js';
import { isObj } from './json.js';
import { SCHEMA_DIALECT, validateSchema } from './schema-dialect.js';
import type { DeliverableFile, DocContract, DocContractInput, EvidenceRequirement } from './types.js';

export const TYPE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
export const RESERVED_TYPES = ['request', 'answer'];
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_PUBLISH_ATTEMPTS = 3;
export const DEFAULT_MAX_CONSISTENCY_REFUSALS = 5;

const FIELDS = new Set([
  'type', 'schema', 'evidence', 'checks', 'deliverable_files', 'acceptance', 'visibility', 'on_stale',
  'gates', 'max_publish_attempts', 'max_consistency_refusals', 'max_bytes',
]);
const COMPARE_PATH = /^[A-Za-z0-9_-]+(\[\])?(\.[A-Za-z0-9_-]+(\[\])?)*$/;
const KINDS = ['command', 'diff', 'document', 'source'];
const VERIFY: Record<string, string | undefined> = { command: 'reported', source: 'cited' };

const posInt = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max;

function evidenceProblems(list: unknown, bad: (at: string, m: string, r?: string) => void): void {
  if (!Array.isArray(list)) return bad('contract.evidence', 'must be a list');
  const seen = new Set<string>();
  list.forEach((e, i) => {
    const at = `contract.evidence[${i}]`;
    if (!isObj(e)) return bad(at, 'must be an object');
    for (const k of Object.keys(e))
      if (!['kind', 'verify', 'min'].includes(k)) bad(at, `parameter "${k}" is not supported`);
    if (typeof e.kind !== 'string' || !KINDS.includes(e.kind))
      return bad(at, `kind must be one of ${KINDS.join(', ')}`, 'opinion and human evidence are not yet supported');
    if (seen.has(e.kind)) bad(at, `kind "${e.kind}" is listed twice`);
    seen.add(e.kind);
    const want = VERIFY[e.kind];
    if (e.verify !== undefined && e.verify !== want)
      bad(at, want ? `${e.kind} supports only verify: "${want}"` : `${e.kind} takes no verify`, 'rerun and fetch are not yet supported');
    if (e.min !== undefined && !posInt(e.min)) bad(at, 'min must be a positive integer');
  });
}

function deliverableProblems(list: unknown, bad: (at: string, m: string, r?: string) => void): void {
  if (!Array.isArray(list)) return bad('contract.deliverable_files', 'must be a list');
  list.forEach((d, i) => {
    const at = `contract.deliverable_files[${i}]`;
    if (!isObj(d)) return bad(at, 'must be an object');
    for (const k of Object.keys(d))
      if (!['file', 'select', 'compare'].includes(k)) bad(at, `parameter "${k}" is not supported`);
    const f = d.file;
    if (typeof f !== 'string' || !f || f.includes('\0') || f.startsWith('/') || f.split('/').includes('..'))
      bad(at, 'file must be a workspace-relative path that stays inside the workspace');
    const s = d.select;
    if (!isObj(s) || ![s.array, s.key, s.value].every((x) => typeof x === 'string' && x))
      bad(at, 'select needs array, key and value (strings)');
    else if (Object.keys(s).some((k) => !['array', 'key', 'value'].includes(k)))
      bad(at, 'select takes only array, key and value');
    if (!Array.isArray(d.compare) || !d.compare.length || d.compare.some((c) => typeof c !== 'string' || !c))
      bad(at, 'compare needs at least one field path (strings)');
    else if (d.compare.some((c) => !COMPARE_PATH.test(c as string)))
      bad(at, 'compare paths are dotted field names, with [] after a list field ("module", "answers[].q")');
  });
}

/** Every reason the contract is invalid (all of them, with paths); empty when it is valid. */
export function validateContract(raw: unknown): DocProblem[] {
  if (!isObj(raw))
    return [{ code: 'CONTRACT_NOT_OBJECT', path: 'contract', message: 'a contract must be an object' }];
  const out: DocProblem[] = [];
  const bad = (at: string, message: string, remedy?: string) =>
    out.push({ code: 'CONTRACT_INVALID_FIELD', path: at, message, remedy });
  for (const k of Object.keys(raw))
    if (!FIELDS.has(k))
      out.push({
        code: 'CONTRACT_UNKNOWN_FIELD',
        path: `contract.${k}`,
        message: 'not a contract field in this build (deferred features are refused, not ignored)',
      });
  if (typeof raw.type !== 'string' || !TYPE_NAME.test(raw.type))
    bad('contract.type', 'must match ^[a-z][a-z0-9-]{0,39}$');
  else if (RESERVED_TYPES.includes(raw.type))
    bad('contract.type', `"${raw.type}" is a reserved built-in type and cannot be redefined`);
  for (const p of validateSchema(raw.schema)) out.push({ ...p, path: `contract.schema${p.path.slice(1)}` });
  if (raw.evidence !== undefined) evidenceProblems(raw.evidence, bad);
  if (raw.checks !== undefined) out.push(...validateChecks(raw.checks, 'contract.checks'));
  if (raw.deliverable_files !== undefined) deliverableProblems(raw.deliverable_files, bad);
  if (raw.acceptance !== undefined && raw.acceptance !== 'each')
    bad('contract.acceptance', 'only "each" is supported', 'owner and any are not yet supported');
  if (raw.visibility !== undefined && raw.visibility !== 'consumers' && raw.visibility !== 'org')
    bad('contract.visibility', 'must be "consumers" or "org"');
  if (raw.on_stale !== undefined && raw.on_stale !== 'hold')
    bad('contract.on_stale', 'only "hold" is supported', 'keep and rebase-queued are not yet supported');
  if (raw.gates !== undefined && !(Array.isArray(raw.gates) && raw.gates.length === 0))
    bad('contract.gates', 'only an empty list is supported', 'cold-reviewer and human gates are not yet supported');
  if (raw.max_publish_attempts !== undefined && !posInt(raw.max_publish_attempts))
    bad('contract.max_publish_attempts', 'must be a positive integer');
  if (raw.max_consistency_refusals !== undefined && !posInt(raw.max_consistency_refusals))
    bad('contract.max_consistency_refusals', 'must be a positive integer');
  if (raw.max_bytes !== undefined && !posInt(raw.max_bytes, MAX_DOCUMENT_BYTES))
    bad('contract.max_bytes', `must be an integer from 1 to ${MAX_DOCUMENT_BYTES}`);
  return out;
}

/** The validated contract with every default filled in, deep-copied. Throws a DocError listing all problems. */
export function effectiveContract(raw: unknown): DocContract {
  throwIfProblems(validateContract(raw));
  const c = structuredClone(raw) as DocContractInput;
  return {
    type: c.type,
    schema: c.schema,
    evidence: (c.evidence ?? []).map((e: EvidenceRequirement) => ({
      kind: e.kind,
      ...(VERIFY[e.kind] ? { verify: (e.verify ?? VERIFY[e.kind]) as 'reported' | 'cited' } : {}),
      min: e.min ?? 1,
    })),
    checks: c.checks ?? [],
    deliverable_files: (c.deliverable_files ?? []) as DeliverableFile[],
    acceptance: 'each',
    visibility: c.visibility ?? 'consumers',
    on_stale: 'hold',
    gates: [],
    max_publish_attempts: c.max_publish_attempts ?? DEFAULT_MAX_PUBLISH_ATTEMPTS,
    max_consistency_refusals: c.max_consistency_refusals ?? DEFAULT_MAX_CONSISTENCY_REFUSALS,
    max_bytes: c.max_bytes ?? MAX_DOCUMENT_BYTES,
  };
}

export interface ContractRevision {
  /** sha-256 lowercase hex (64 characters) of `canonical`. */
  revision: string;
  /** The exact text that was hashed: persist it as the immutable snapshot. */
  canonical: string;
  contract: DocContract;
}

/** The revision of a contract (validated, defaults filled, canonicalized, hashed); see the file header. */
export function contractRevision(raw: unknown): ContractRevision {
  const contract = effectiveContract(raw);
  const canonical = canonicalJson({
    checks_dialect: CHECKS_DIALECT,
    contract,
    dialect: SCHEMA_DIALECT,
  });
  return { revision: createHash('sha256').update(canonical, 'utf8').digest('hex'), canonical, contract };
}
