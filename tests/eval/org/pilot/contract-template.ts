// tests/eval/org/pilot/contract-template.ts
//
// Variant v2 of parallel-sweep-3 declares its contract changes once, as data in the pilot manifest
// (`variants[].contract_template`), and this applies them to the eight committed contracts, so the v1
// contracts stay byte-for-byte what was measured and the v2 ones are derived from them, not copied.
// The template adds the document-only `evidence` field to each answer, the longer size limit it needs, the
// deliverable files (one per sheet, found from the contract's own module list) and the declared checks.
import { assertSupportedChecks } from './checks.js';
import type { Deliverable } from './deliverables.js';
import { assertSupportedSchema } from './schema.js';
import type { DocContract } from './store.js';

type Json = Record<string, any>;

export interface ContractTemplate {
  /** Schema of the `evidence` field added (and required) on every answer of every sheet. */
  answer_evidence_schema: Json;
  max_chars: number;
  /** Consistency refusals per document, apart from publish attempts. */
  max_consistency_refusals: number;
  /** One deliverable per sheet: the file is `file` with {key} replaced by the sheet's module. */
  deliverables: { array: string; key: string; file: string; compare: string[] };
  checks: unknown[];
}

/** Throws when the template is malformed (the manifest validator calls this too). */
export function assertContractTemplate(t: unknown, where = 'contract_template'): void {
  const x = t as ContractTemplate;
  if (!x || typeof x !== 'object') throw new Error(`${where}: must be an object`);
  assertSupportedSchema(x.answer_evidence_schema, `${where}.answer_evidence_schema $`);
  if (!Number.isInteger(x.max_chars) || x.max_chars < 1) throw new Error(`${where}.max_chars`);
  if (!Number.isInteger(x.max_consistency_refusals) || x.max_consistency_refusals < 1)
    throw new Error(`${where}.max_consistency_refusals`);
  const d = x.deliverables;
  if (!d?.array || !d.key || !d.file?.includes('{key}') || !d.compare?.length)
    throw new Error(`${where}.deliverables: needs array, key, a file with {key} and compare`);
  assertSupportedChecks(x.checks, `${where}.checks`);
}

/** The contracts with the template applied; the input is not changed. */
export function applyContractTemplate(
  contracts: DocContract[],
  t: ContractTemplate,
): DocContract[] {
  assertContractTemplate(t);
  return contracts.map((c) => {
    const schema = structuredClone(c.schema) as Json;
    const sheets = schema.properties?.[t.deliverables.array];
    const sheet = sheets?.items;
    const answer = sheet?.properties?.answers?.items;
    if (!answer?.properties)
      throw new Error(`contract ${c.id}: no answers schema to add evidence to`);
    answer.properties.evidence = structuredClone(t.answer_evidence_schema);
    answer.required = [...(answer.required ?? []), 'evidence'];
    const keys: string[] | undefined = sheet.properties?.[t.deliverables.key]?.enum;
    if (!keys?.length)
      throw new Error(`contract ${c.id}: no ${t.deliverables.key} list to derive files from`);
    const deliverables: Deliverable[] = keys.map((k) => ({
      file: t.deliverables.file.replace('{key}', k),
      select: { array: t.deliverables.array, key: t.deliverables.key, value: k },
      compare: t.deliverables.compare,
    }));
    return {
      ...structuredClone(c),
      schema,
      max_chars: t.max_chars,
      max_refusals: t.max_consistency_refusals,
      deliverables,
      checks: structuredClone(t.checks) as DocContract['checks'],
    };
  });
}
