// orgrt/documents/store-validate.ts
//
// What the store checks about the content of a publish before it commits anything (org sections spec 6.3 and
// 13.1.2 item 4): the body against the contract's org-schema-v1 schema, the `evidence` argument against the
// contract's required kinds, and the `inputs` references. Every problem is returned at once, each with a path,
// so a failed publish tells the producer everything that is wrong in one answer.

import { isObj, type JsonObject } from './json.js';
import { validateValue } from './schema-dialect.js';
import type { ProblemView } from './store-types.js';
import type { DocContract } from './types.js';

export const EVIDENCE_KINDS = ['command', 'diff', 'document', 'source'] as const;
export const MAX_INPUT_REFS = 256;
export const MAX_NOTE_CHARS = 400;
export const DOC_REF = /^([a-z][a-z0-9-]{0,39}-[1-9][0-9]*)@v([1-9][0-9]*)$/;

export function contentProblems(
  contract: DocContract,
  req: { body: unknown; evidence?: unknown[]; inputs?: string[] },
): ProblemView[] {
  const out: ProblemView[] = [];
  for (const p of validateValue(contract.schema as JsonObject, req.body))
    out.push({ code: p.code, path: p.path, message: p.message });

  const seen: Record<string, number> = {};
  if (req.evidence !== undefined && !Array.isArray(req.evidence))
    out.push({ code: 'EVIDENCE_INVALID', path: 'evidence', message: 'must be a list' });
  else
    (req.evidence ?? []).forEach((e, i) => {
      const at = `evidence[${i}]`;
      if (
        !isObj(e) ||
        typeof e.kind !== 'string' ||
        !(EVIDENCE_KINDS as readonly string[]).includes(e.kind)
      )
        out.push({
          code: 'EVIDENCE_INVALID',
          path: at,
          message: `needs an object with kind one of ${EVIDENCE_KINDS.join(', ')}`,
        });
      else seen[e.kind] = (seen[e.kind] ?? 0) + 1;
    });
  for (const r of contract.evidence)
    if ((seen[r.kind] ?? 0) < r.min)
      out.push({
        code: 'EVIDENCE_MISSING',
        path: 'evidence',
        message: `${r.min} ${r.kind} evidence ${r.min === 1 ? 'entry is' : 'entries are'} required, ${seen[r.kind] ?? 0} given`,
      });

  if (req.inputs !== undefined) {
    if (!Array.isArray(req.inputs))
      out.push({
        code: 'INPUT_INVALID',
        path: 'inputs',
        message: 'must be a list of id@vN references',
      });
    else {
      const distinct = new Set<string>();
      req.inputs.forEach((x, i) => {
        if (typeof x !== 'string' || !DOC_REF.test(x))
          out.push({
            code: 'INPUT_INVALID',
            path: `inputs[${i}]`,
            message: 'must look like <id>@v<N>',
          });
        else distinct.add(x);
      });
      if (distinct.size > MAX_INPUT_REFS)
        out.push({
          code: 'INPUT_INVALID',
          path: 'inputs',
          message: `${distinct.size} distinct references, over the ${MAX_INPUT_REFS} limit`,
        });
    }
  }
  return out;
}
