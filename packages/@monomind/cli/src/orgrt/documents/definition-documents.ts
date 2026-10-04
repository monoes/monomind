// packages/@monomind/cli/src/orgrt/documents/definition-documents.ts
/**
 * Org sections spec section 5 and 9.1 (piece P3.1): the shape of the top-level
 * `documents` map for a definition on the sections surface. Names, reserved
 * types, the MVP values of each field and "not yet supported" for every
 * deferred value. The contract's `schema` content is handed to the P3.4
 * dialect check once it lands; here it only has to be an object.
 */
import type { Findings } from './definition-util.js';
import { isObject, NAME_RE, RESERVED_TYPES } from './definition-util.js';

/** Contract fields P3.4 gives meaning to (13.1.2 decision 3); accepted, not checked here. */
const CONTRACT_FIELDS = [
  'checks',
  'max_publish_attempts',
  'max_consistency_refusals',
  'deliverable_files',
];
const KNOWN_FIELDS = [
  'schema',
  'evidence',
  'acceptance',
  'owner',
  'provisional',
  'gates',
  'visibility',
  'confidential',
  'on_stale',
  ...CONTRACT_FIELDS,
];
const EVIDENCE_KINDS = ['command', 'diff', 'document', 'source'];

const nys = (path: string, what: string, remedy: string): string =>
  `${path}: ${what} is not yet supported — ${remedy}`;

/** Check one document contract; `path` is `documents.<type>`. */
function checkDocument(type: string, raw: unknown, f: Findings): void {
  const path = `documents.${type}`;
  if (!NAME_RE.test(type))
    f.errors.push(
      `${path}: "${type}" is not a valid type name — use lowercase letters, digits and "-", starting with a letter, at most 40 characters (it becomes a path segment)`,
    );
  if (RESERVED_TYPES.includes(type))
    f.errors.push(
      `${path}: "${type}" is a reserved built-in type with a runtime-owned schema — rename your type; it cannot be redefined under documents`,
    );
  if (!isObject(raw)) {
    f.errors.push(`${path}: must be an object with at least a "schema" — got ${describe(raw)}`);
    return;
  }
  for (const k of Object.keys(raw))
    if (!KNOWN_FIELDS.includes(k))
      f.warnings.push(
        `${path}.${k}: unknown contract field — it is not validated yet; check the spelling (known: ${KNOWN_FIELDS.join(', ')})`,
      );
  if (!isObject(raw.schema))
    f.errors.push(
      `${path}.schema: must be an object (a JSON-Schema-style contract for the body) — got ${describe(raw.schema)}`,
    );
  if (raw.evidence !== undefined) checkEvidence(path, raw.evidence, f);
  if (raw.acceptance !== undefined && raw.acceptance !== 'each')
    f.errors.push(
      raw.acceptance === 'owner' || raw.acceptance === 'any'
        ? nys(
            path,
            `acceptance "${raw.acceptance}"`,
            'only "each" is built; set it to "each" or remove it',
          )
        : `${path}.acceptance: must be "each" — got ${describe(raw.acceptance)}`,
    );
  if (raw.owner !== undefined && raw.owner !== null)
    f.errors.push(nys(path, 'owner', 'it only applies to acceptance "owner"; remove it'));
  if (raw.provisional !== undefined && raw.provisional !== false)
    f.errors.push(nys(path, 'provisional: true', 'set it to false or remove it'));
  if (raw.gates !== undefined && !(Array.isArray(raw.gates) && raw.gates.length === 0))
    f.errors.push(
      nys(path, 'gates', 'cold-reviewer and human gates are not built; use [] or remove it'),
    );
  if (raw.visibility !== undefined && raw.visibility !== 'consumers' && raw.visibility !== 'org')
    f.errors.push(
      `${path}.visibility: must be "consumers" or "org" — got ${describe(raw.visibility)}`,
    );
  if (raw.confidential !== undefined && raw.confidential !== false)
    f.errors.push(nys(path, 'confidential: true', 'set it to false or remove it'));
  if (raw.on_stale !== undefined && raw.on_stale !== 'hold')
    f.errors.push(
      raw.on_stale === 'keep' || raw.on_stale === 'rebase-queued'
        ? nys(
            path,
            `on_stale "${raw.on_stale}"`,
            'only "hold" is built; set it to "hold" or remove it',
          )
        : `${path}.on_stale: must be "hold" — got ${describe(raw.on_stale)}`,
    );
}

function checkEvidence(path: string, evidence: unknown, f: Findings): void {
  if (!Array.isArray(evidence)) {
    f.errors.push(
      `${path}.evidence: must be a list of {kind, verify} entries — got ${describe(evidence)}`,
    );
    return;
  }
  evidence.forEach((e, i) => {
    const at = `${path}.evidence[${i}]`;
    if (!isObject(e) || typeof e.kind !== 'string') {
      f.errors.push(`${at}: must be an object with a "kind" (${EVIDENCE_KINDS.join(', ')})`);
      return;
    }
    if (!EVIDENCE_KINDS.includes(e.kind))
      f.errors.push(
        `${at}.kind: "${e.kind}" is not an evidence kind — use one of ${EVIDENCE_KINDS.join(', ')}`,
      );
    if (e.verify === 'fetch' || e.verify === 'rerun')
      f.errors.push(
        nys(
          at,
          `verify "${e.verify}"`,
          e.kind === 'source' ? 'use "cited"' : 'remove the verify key',
        ),
      );
    else if (e.verify !== undefined && !(e.kind === 'source' && e.verify === 'cited'))
      f.errors.push(
        `${at}.verify: ${describe(e.verify)} is not valid here — only a "source" entry takes verify "cited"`,
      );
  });
}

const describe = (v: unknown): string =>
  v === null
    ? 'null'
    : Array.isArray(v)
      ? 'a list'
      : typeof v === 'object'
        ? 'an object'
        : `${JSON.stringify(v) ?? 'nothing'}`;

/** Check the `documents` map; returns the declared type names. */
export function checkDocuments(documents: unknown, f: Findings): string[] {
  if (!isObject(documents)) {
    f.errors.push(
      `documents: a sections org must declare a documents map ({"<type>": {schema, ...}}) for every type its sections publish or consume — got ${documents === undefined ? 'nothing' : describe(documents)}`,
    );
    return [];
  }
  for (const [type, raw] of Object.entries(documents)) checkDocument(type, raw, f);
  return Object.keys(documents);
}
