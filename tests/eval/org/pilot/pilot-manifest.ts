// tests/eval/org/pilot/pilot-manifest.ts
//
// A pilot trial's manifest (org sections spec 9.2): the routing map, the
// document contracts and the retained trial controls, committed before any
// paid trial. It points at one of section 10's fixed scenario manifests rather
// than copying it, so the pilot cannot loosen the scenario's rubric or floors.
import { assertContractTemplate } from './contract-template.js';
import { assertSupportedSchema } from './schema.js';

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validatePilotManifest(
  raw: unknown,
  scenario: (id: string) => unknown,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!isObj(raw)) return { ok: false, problems: ['pilot manifest must be an object'] };
  const text = (k: string) => {
    if (typeof raw[k] !== 'string' || raw[k].trim() === '')
      problems.push(`${k} is required (non-empty text)`);
  };
  text('id');
  text('writer_authority');
  if (raw.harness_only !== true)
    problems.push('harness_only must be true: the pilot is a harness-only prototype');
  if (raw.sections_serialized !== false)
    problems.push(
      'sections_serialized must be false: no definition carries sections: in the pilot',
    );
  if (raw.native_children !== 'disabled')
    problems.push('native_children must be "disabled" in both arms');
  if (!Number.isInteger(raw.trials_per_arm) || raw.trials_per_arm < 1)
    problems.push('trials_per_arm must be a positive integer');
  const arms = Array.isArray(raw.arms) ? raw.arms.map((a: Obj) => a?.id) : [];
  // a baseline and a treatment, and optionally the single-agent arm (the null hypothesis, spec R18)
  if (
    !arms.includes('baseline') ||
    !arms.includes('treatment') ||
    arms.some((a: string) => !['baseline', 'treatment', 'single'].includes(a)) ||
    new Set(arms).size !== arms.length
  )
    problems.push('arms must be a baseline and a treatment, and may add a single-agent arm');

  let scenarioManifest: Obj | undefined;
  try {
    const s = scenario(String(raw.scenario));
    if (isObj(s)) scenarioManifest = s;
  } catch {
    /* reported below */
  }
  if (!scenarioManifest)
    problems.push(`scenario "${raw.scenario}" has no committed scenario manifest`);
  else {
    if (raw.per_run_allocation_usd !== scenarioManifest.cost?.planning_allocation_usd)
      problems.push(
        `per_run_allocation_usd must equal the scenario's planning allocation (${scenarioManifest.cost?.planning_allocation_usd})`,
      );
    if (
      typeof raw.committed_at !== 'string' ||
      raw.committed_at < String(scenarioManifest.committed_at)
    )
      problems.push('committed_at must be on or after the scenario manifest it names');
  }

  const sectionOf = new Map<string, string>();
  const sections = isObj(raw.routing?.sections) ? (raw.routing.sections as Obj) : {};
  if (Object.keys(sections).length < 2) problems.push('routing needs at least two sections');
  for (const [name, s] of Object.entries(sections)) {
    for (const role of [s?.lead, ...(Array.isArray(s?.members) ? s.members : [])]) {
      if (typeof role !== 'string') {
        problems.push(`section ${name} needs a lead and a members list`);
        continue;
      }
      if (sectionOf.has(role) && sectionOf.get(role) !== name)
        problems.push(`${role} is in more than one section`);
      sectionOf.set(role, name);
    }
  }

  const ids = new Set<string>();
  let crosses = false;
  for (const c of Array.isArray(raw.contracts) ? raw.contracts : []) {
    if (!isObj(c)) continue;
    if (ids.has(c.id)) problems.push(`duplicate contract id "${c.id}"`);
    ids.add(c.id);
    if (!Number.isInteger(c.max_attempts) || c.max_attempts < 1)
      problems.push(`contract ${c.id}: max_attempts must be a positive integer`);
    const consumers: string[] = Array.isArray(c.consumers) ? c.consumers : [];
    if (consumers.length === 0)
      problems.push(`contract ${c.id}: at least one consumer is required`);
    if (consumers.includes(c.producer))
      problems.push(`contract ${c.id}: the producer cannot also be a consumer`);
    for (const role of [c.producer, ...consumers])
      if (!sectionOf.has(role))
        problems.push(`contract ${c.id}: ${role} is in no section of the routing map`);
    if (consumers.some((x) => sectionOf.get(x) !== sectionOf.get(c.producer))) crosses = true;
    try {
      assertSupportedSchema(c.schema, `contract ${c.id} $`);
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  // a declared variant that changes the contracts (parallel-sweep-3's v2): its template must load, its relay must name roles
  for (const v of Array.isArray(raw.variants) ? raw.variants : []) {
    if (!isObj(v)) continue;
    if (!arms.includes(v.arm))
      problems.push(`variant ${v.id}: arm "${v.arm}" is not an arm of this pilot`);
    if (v.contract_template !== undefined)
      try {
        assertContractTemplate(v.contract_template, `variant ${v.id} contract_template`);
      } catch (e) {
        problems.push((e as Error).message);
      }
    if (
      v.relay !== undefined &&
      !(
        Array.isArray(v.relay?.copy_to) &&
        v.relay.copy_to.every((r: unknown) => typeof r === 'string')
      )
    )
      problems.push(`variant ${v.id}: relay.copy_to must be a list of roles`);
  }
  if (ids.size === 0) problems.push('at least one contract is required');
  else if (!crosses)
    problems.push('no contract crosses sections, so the hand-off has nothing to measure');
  return { ok: problems.length === 0, problems };
}

/** Runs and planning allocation of a set of pilots: scenarios x trials x arms x allocation. */
export function pilotPlan(
  pilots: Obj[],
  scenario: (id: string) => unknown,
): { runs: number; allocation_usd: number } {
  let runs = 0;
  let usd = 0;
  for (const p of pilots) {
    const n = p.trials_per_arm * p.arms.length;
    runs += n;
    usd += n * (scenario(p.scenario) as Obj).cost.planning_allocation_usd;
  }
  return { runs, allocation_usd: usd };
}
