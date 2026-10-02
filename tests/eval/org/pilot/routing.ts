// tests/eval/org/pilot/routing.ts
//
// The pilot's section routing map. It lives in the trial manifest and the
// harness, never in the org definition (the definition does not serialize
// `sections:`), and its one runtime effect is the refusal of cross-section
// org_send (spec 6.6): without it the pilot would measure a chat bypass.
export interface SectionDef {
  lead: string;
  members: string[];
}

export interface Routing {
  sections: Record<string, SectionDef>;
}

export function sectionOf(routing: Routing, role: string): string | undefined {
  return Object.entries(routing.sections).find(
    ([, s]) => s.lead === role || s.members.includes(role),
  )?.[0];
}

/** Why a message must not go from `from` to `to`, or undefined when it may.
 *  A role in no section (the boss, a human) is not bound by the map. */
export function crossSectionRefusal(
  routing: Routing,
  from: string,
  to: string,
): string | undefined {
  const a = sectionOf(routing, from);
  const b = sectionOf(routing, to);
  if (!a || !b || a === b) return undefined;
  return `Refused: ${from} (section ${a}) cannot message ${to} (section ${b}). Sections hand work over through documents: publish it with pilot__doc_publish, or ask your section lead to raise it with the other lead.`;
}
