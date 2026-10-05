// tests/eval/org/pilot/runtime-def.ts
//
// P3.15, the runtime switch: turns a pilot trial's routing map and contracts (parallel-sweep-3.pilot.json, the v2
// contracts included) into an org definition on the sections surface, so the same scenario runs on the real
// `orgrt/documents` tools instead of the harness store. Nothing here is product code and nothing reaches it from
// `org run`: the definition it returns is refused outside the eval gate (run_config.experimental: "eval").
//
// What it builds (org sections spec 13.1.2, 13.1.3):
//   routing.sections.<s> {lead, members}  ->  sections.<s> {lead, members (the lead listed too), publishes, consumes}
//   contract <id>                         ->  documents.<id> {schema, checks, max_publish_attempts,
//                                             max_consistency_refusals, deliverable_files}
//   plus requires {sections: 1}, run_config.experimental "eval" and run_config.completion {mode, protocol: "sections-v1"}.
// Not carried: the contract's title and max_chars (the runtime names a contract by type and bounds a version at 1 MiB)
// and the harness's responsibilities line (the runtime adds its own role text, P3.12). The pilot tool names in the role
// text are mapped to the runtime ones (`runtimeText`). Where the runtime cannot say what the prototype said, this refuses
// with every reason at once: a consumer must be the lead of its section (the runtime decides through the lead, 13.1.2 (5)),
// producer and consumer must sit in different sections, and every contract role must be in a section.

import type { PilotTrial } from './harness.js';
import { sectionOf } from './routing.js';
import type { DocContract } from './store.js';

type Def = { roles: Record<string, any>[]; run_config?: Record<string, any> } & Record<string, any>;

/** P4.13, the Phase 4 keys a pilot variant may carry when it runs on the runtime (optional, default OFF): per section
 *  `writes`, `budget` ({usd}) and `max_rework_rounds`, and the org's `budget_usd`. They are copied into the
 *  generated sections definition exactly as given; the runtime's own definition checks decide whether they are valid. A trial
 *  that does not declare any gets the definition it always got. The harness has no Phase 4 behaviour, so this only exists on
 *  the runtime path (Phase 4 is runtime-only; see the migration notes). */
export interface Phase4Section {
  writes?: string[];
  budget?: { usd: number };
  max_rework_rounds?: number;
}
export interface Phase4Input {
  sections?: Record<string, Phase4Section>;
  budget_usd?: number;
}
const SECTION_KEYS = ['writes', 'budget', 'max_rework_rounds'] as const;

/** The runtime's own sender for notices and relays (the harness's was `pilot-relay`). */
export const RUNTIME_SENDER = 'org-docs';

export class RuntimeDefError extends Error {
  constructor(readonly problems: string[]) {
    super(`this pilot trial cannot run on the runtime document tools:\n- ${problems.join('\n- ')}`);
  }
}

/** The pilot's tool and sender names in a text, as the runtime calls them. */
export function runtimeText(s: string): string {
  return s.replace(/\bpilot__doc_/g, 'org_doc_').replace(/\bpilot-relay\b/g, RUNTIME_SENDER);
}

const unique = (xs: string[]) => [...new Set(xs)];

/** The Phase 4 keys one section declares, and only those it declares. */
function phase4SectionKeys(p?: Phase4Section) {
  return Object.fromEntries(
    SECTION_KEYS.filter((k) => p?.[k] !== undefined).map((k) => [k, structuredClone(p?.[k])]),
  );
}

function documentOf(c: DocContract): Record<string, unknown> {
  return {
    schema: structuredClone(c.schema),
    ...(c.checks?.length ? { checks: structuredClone(c.checks) } : {}),
    max_publish_attempts: c.max_attempts,
    ...(c.deliverables?.length && c.max_refusals !== undefined
      ? { max_consistency_refusals: c.max_refusals }
      : {}),
    ...(c.deliverables?.length ? { deliverable_files: structuredClone(c.deliverables) } : {}),
  };
}

/** Why the trial cannot be translated: every reason, so a manifest author fixes them in one pass. */
function problemsOf(
  def: Def,
  trial: Pick<PilotTrial, 'routing' | 'contracts'>,
  phase4?: Phase4Input,
): string[] {
  const out: string[] = [];
  for (const name of Object.keys(phase4?.sections ?? {}))
    if (!trial.routing.sections[name])
      out.push(`phase4.sections.${name}: the routing map has no such section`);
  if (phase4?.budget_usd !== undefined && def.run_config?.budget_usd !== undefined)
    out.push(
      'the definition already has run_config.budget_usd: phase4.budget_usd would replace it',
    );
  for (const k of ['sections', 'documents', 'requires'])
    if (k in def)
      out.push(`the definition already has "${k}": a pilot definition is Phase 2 without sections`);
  if (def.schedule !== undefined && def.schedule !== null)
    out.push('the definition has a schedule: a sections org cannot be scheduled');
  for (const r of def.roles)
    if (r.policy?.access === 'full')
      out.push(`role ${r.id} has policy.access "full": refused in a sections org`);
  const routing = trial.routing;
  const ids = new Set<string>();
  for (const c of trial.contracts) {
    if (ids.has(c.id)) out.push(`contract ${c.id} is listed twice`);
    ids.add(c.id);
    const from = sectionOf(routing, c.producer);
    if (!from) out.push(`contract ${c.id}: producer ${c.producer} is in no section`);
    for (const consumer of c.consumers) {
      const to = sectionOf(routing, consumer);
      if (!to) out.push(`contract ${c.id}: consumer ${consumer} is in no section`);
      else if (routing.sections[to].lead !== consumer)
        out.push(
          `contract ${c.id}: consumer ${consumer} is not the lead of its section ${to}; the runtime decides through the section lead (spec 13.1.2 decision 5)`,
        );
      else if (to === from)
        out.push(`contract ${c.id}: producer and consumer ${consumer} are both in section ${to}`);
    }
  }
  return out;
}

/** The sections-surface definition of a pilot trial. `hide`: paths (the run's docs directory) every role is denied
 *  reading and writing, which is what hiding `pilot-state/` was for the harness store. Pure; the input is not changed. */
export function runtimeOrgDef<D extends Def>(
  def: D,
  trial: Pick<PilotTrial, 'routing' | 'contracts'>,
  o: { hide?: string[]; phase4?: Phase4Input } = {},
): D {
  const problems = problemsOf(def, trial, o.phase4);
  if (problems.length) throw new RuntimeDefError(problems);
  const sections: Record<string, Record<string, unknown>> = {};
  for (const [name, s] of Object.entries(trial.routing.sections)) {
    const roster = unique([s.lead, ...s.members]);
    const publishes = trial.contracts.filter((c) => roster.includes(c.producer)).map((c) => c.id);
    const consumes = trial.contracts.filter((c) => c.consumers.includes(s.lead)).map((c) => c.id);
    sections[name] = {
      lead: s.lead,
      members: roster,
      ...(publishes.length ? { publishes } : {}),
      ...(consumes.length ? { consumes } : {}),
      ...phase4SectionKeys(o.phase4?.sections?.[name]),
    };
  }
  const documents = Object.fromEntries(trial.contracts.map((c) => [c.id, documentOf(c)]));
  const was = def.run_config?.completion;
  const mode = typeof was === 'string' ? was : (was?.mode ?? 'boss');
  const hide = o.hide ?? [];
  const roles = def.roles.map((r) => {
    const role: Record<string, any> = structuredClone(r);
    if (Array.isArray(role.responsibilities))
      role.responsibilities = role.responsibilities.map(runtimeText);
    if (hide.length) {
      const sb = ((role.policy ??= {}).sandbox ??= {});
      for (const k of ['denyRead', 'denyWrite']) sb[k] = unique([...(sb[k] ?? []), ...hide]);
    }
    return role;
  });
  return {
    ...structuredClone(def),
    ...(typeof def.goal === 'string' ? { goal: runtimeText(def.goal) } : {}),
    requires: { sections: 1 },
    run_config: {
      ...(def.run_config ?? {}),
      ...(o.phase4?.budget_usd !== undefined ? { budget_usd: o.phase4.budget_usd } : {}),
      experimental: 'eval',
      completion: { mode, protocol: 'sections-v1' },
    },
    sections,
    documents,
    roles,
  } as D;
}
