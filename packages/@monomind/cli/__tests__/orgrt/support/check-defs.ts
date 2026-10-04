// packages/@monomind/cli/__tests__/orgrt/support/check-defs.ts
// P3.11 fixtures: the parallel-sweep-3 org with the v2 contracts' checks (the committed template applied to the
// eight sheet contracts), honest answer sheets with their evidence trace, and the harness fault injector, so a
// test can publish the same faulted documents the measured trials had. No corpus, no model.
// @ts-nocheck: the harness modules are loosely typed fixtures
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyContractTemplate } from '../../../../../../tests/eval/org/pilot/contract-template.js';
import { faultInjector, planFaults } from '../../../../../../tests/eval/org/pilot/fault-injection.js';
import { sweepOrg } from './doc-defs.js';

const pilot = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../tests/eval/org/pilot/parallel-sweep-3.pilot.json'), 'utf8'),
);
const variant = pilot.variants.find((v) => v.id === 'v2');
export const V1 = pilot.contracts;
export const V2 = applyContractTemplate(V1, variant.contract_template);
export const DOCS: string[] = V2.map((c) => c.id);
export const worker = (doc: string) => `worker-${doc.at(-1)}`;
export const mods = (doc: string) => [1, 2, 3, 4].map((i) => `m${4 * (Number(doc.at(-1)) - 1) + i}`);

/** The sweep org, each type carrying the v2 schema (with the evidence field) and the five declared checks. */
export function sweepChecksOrg(patch: (raw: Record<string, any>) => void = () => {}): Record<string, any> {
  const raw = sweepOrg();
  for (const c of V2) raw.documents[c.id] = { schema: c.schema, checks: c.checks, max_publish_attempts: c.max_attempts };
  patch(raw);
  return raw;
}

/** An honest sheet: the entry file's evidence returns the value, the other steps carry made-up integers. */
export const sheetOf = (m: string, w: number) => ({
  module: m,
  answers: Array.from({ length: 12 }, (_, qi) => {
    const files = Array.from({ length: 4 + (qi % 4) }, (_, i) => `${m}/f${(qi * 7 + i * 3 + w) % 50}.js`);
    const value = 1000 * w + 10 * qi + Number(m.slice(1));
    return {
      q: `q${String(qi + 1).padStart(2, '0')}`,
      value,
      files,
      evidence: files.map((file, i) => ({ file, in: 7 + i, out: i === 0 ? value : 100 + 13 * i })),
    };
  }),
});
export const honestDoc = (doc: string) => ({
  worker: worker(doc),
  sheets: mods(doc).map((m) => sheetOf(m, Number(doc.at(-1)))),
});

/** What the harness's publish-time injector makes of the honest document (the faulted body, or the same one). */
export function faulted(seed: number) {
  const plan = planFaults(seed, DOCS);
  const inj = faultInjector(plan);
  return { plan, body: (doc: string) => inj.apply(doc, honestDoc(doc))?.content ?? honestDoc(doc) };
}
