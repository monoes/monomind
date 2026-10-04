// packages/@monomind/cli/src/orgrt/documents/surface.ts
/**
 * Org sections spec 13.1.3: the opt-in surface. `sectionsSurface` is the ONE
 * place that decides "sections on", mirroring `contextSurface`. Every sections
 * code path (definition checks, the relaxed checklist, later the tools, prompt
 * and store) asks it and nothing else; an org for which it is off behaves byte
 * for byte as it did before sections existed.
 */

export interface SectionsSurface {
  /** True when the definition has a top-level `sections` object with at least
   *  one declared section (an entry that is a non-empty object). `documents`
   *  or `requires` alone never switch it on, and neither does `sections: {}`
   *  or an entry with nothing in it. */
  enabled: boolean;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Pure: reads `def.sections` only, never mutates, and has no other input. */
export function sectionsSurface(def: { sections?: unknown } | undefined): SectionsSurface {
  const sections = def?.sections;
  return {
    enabled:
      isPlainObject(sections) &&
      Object.values(sections).some((s) => isPlainObject(s) && Object.keys(s).length > 0),
  };
}
