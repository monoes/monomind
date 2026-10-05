// P3.14 fixtures: a miniature of the parallel-sweep-3 org. A root `lead`, three producers (each leads its own
// one-member section and publishes one sheet document with the v2 checks and its deliverable files), and a
// consuming `synthesiser` section. The faulty bodies below are made by the SCRIPTED PRODUCER (the harness fault
// injector stays test-only and is not imported here): a wrong value against the evidence, reversed files, a
// duplicated sheet, and a document that disagrees with the producer's files.
// @ts-nocheck: the check-defs fixtures are loosely typed
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { V2, honestDoc, sweepChecksOrg } from '../../support/check-defs.js';
import { role } from '../../support/doc-defs.js';

export const MINI_DOCS: string[] = V2.slice(0, 3).map((c) => c.id);
export const idOf = (doc: string, n = 1) => `${doc}-${n}`;
export const workerOf = (doc: string) => `worker-${doc.at(-1)}`;

export interface MiniOptions {
  /** A role alone in section `watch` (reports to the lead), for the access refusals. */
  observer?: boolean;
  /** `run_config.lead_watch.unread_s`; absent keeps the default. */
  unreadS?: number;
  /** Sections-off: drop every sections key (the same roster and roles). */
  sectionsOff?: boolean;
}

export function miniOrg(o: MiniOptions = {}): Record<string, any> {
  const raw = sweepChecksOrg();
  raw.name = 'mini-sweep';
  const keep = new Set(['lead', 'synthesiser', ...MINI_DOCS.map(workerOf)]);
  raw.roles = raw.roles.filter((r: any) => keep.has(r.id));
  for (const k of Object.keys(raw.sections))
    if (k !== 'synthesis' && !keep.has(raw.sections[k].lead)) delete raw.sections[k];
  raw.sections.synthesis.consumes = [...MINI_DOCS];
  raw.documents = {};
  for (const c of V2.slice(0, 3))
    raw.documents[c.id] = {
      schema: c.schema,
      checks: c.checks,
      max_publish_attempts: c.max_attempts,
      max_consistency_refusals: c.max_refusals,
      deliverable_files: c.deliverables,
    };
  if (o.observer) {
    raw.roles.push(role('observer', 'lead'));
    raw.sections.watch = { members: ['observer'] };
  }
  if (o.unreadS !== undefined) raw.run_config.lead_watch = { unread_s: o.unreadS };
  if (o.sectionsOff) {
    for (const k of ['sections', 'documents', 'requires']) delete raw[k];
    delete raw.run_config.experimental;
    delete raw.run_config.completion;
  }
  return raw;
}

type Body = ReturnType<typeof honestDoc>;
export const honest = (doc: string): Body => honestDoc(doc);

/** One answer's value no longer follows from its evidence trace (value_matches_chain flags it). */
export function wrongValue(doc: string): Body {
  const b = honestDoc(doc);
  b.sheets[2].answers[4].value += 7;
  return b;
}
/** The files lists of two answers are reversed, the evidence is not (files_match_evidence flags them). */
export function reversedFiles(doc: string): Body {
  const b = honestDoc(doc);
  for (const a of b.sheets[0].answers.slice(0, 2)) a.files.reverse();
  return b;
}
/** The second sheet carries the first sheet's answers (unique_across_sheets and files_in_module flag it). */
export function duplicatedSheet(doc: string): Body {
  const b = honestDoc(doc);
  b.sheets[1].answers = structuredClone(b.sheets[0].answers);
  return b;
}

/** The producer's deliverable files for `body`, as it writes them: one `out/<module>/answers.json` per sheet. */
export function writeFiles(root: string, body: Body): void {
  for (const sheet of body.sheets) {
    mkdirSync(join(root, 'out', sheet.module), { recursive: true });
    writeFileSync(join(root, 'out', sheet.module, 'answers.json'), JSON.stringify(sheet));
  }
}
