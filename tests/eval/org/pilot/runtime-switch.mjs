// P3.15: the runtime switch. A pilot's declared variant (pilot manifest `variants`, e.g. parallel-sweep-3's v2) runs on the
// HARNESS hand-off layer, as committed. The same variant with the suffix "r" (`v2r`) runs on the REAL runtime document tools:
// the org definition is a sections definition (runtime-def.ts), started through the eval gate, and the harness attaches nothing.
// The suffix goes wherever a variant id goes, so the switch is used from the same commands as the pilot:
//   PILOT_OWNER_DECISION="handoff-relay-consistency-check handoff-runtime-port" \
//     PILOT_ONLY=parallel-sweep-3:treatment:1:0::v2r pilot/run-all.sh <base> <cli.js>
// Default OFF: an id the manifest declares is never reinterpreted, and no manifest declares an id ending in "r"; a bare "v2"
// is the harness, exactly as before. The switch applies to a variant that carries the producer relay and the contract template
// (the runtime always notifies consumers, relays rejections and checks deliverables), and, because it is a different treatment
// from the one the committed manifest declares, it needs the owner's decision to name RUNTIME_PHRASE as well as the base's.
export const RUNTIME_SUFFIX = 'r';
export const RUNTIME_PHRASE = 'handoff-runtime-port';

/** `{variant, handoff}` for a variant id of a pilot manifest: a declared one (harness), or a declared one + "r" (runtime);
 *  undefined when the pilot has no such variant (or the base variant has no relay, which the runtime always provides). */
export function resolveVariant(pilot, id) {
  if (!id) return undefined;
  const variants = pilot.variants ?? [];
  const declared = variants.find((v) => v.id === id);
  if (declared) return { variant: declared, handoff: 'harness' };
  if (!id.endsWith(RUNTIME_SUFFIX)) return undefined;
  const base = variants.find((v) => v.id === id.slice(0, -RUNTIME_SUFFIX.length));
  if (!base?.relay) return undefined;
  return {
    variant: {
      ...structuredClone(base),
      id,
      base: base.id,
      handoff: 'runtime',
      description: `${base.description} Run on the runtime document tools (the runtime switch): a sections definition through the eval gate, no harness store, no fault injector.`,
      owner_decision_phrases: [base.owner_decision_phrase, RUNTIME_PHRASE],
    },
    handoff: 'runtime',
  };
}

/** The owner-decision phrases a variant needs (every one must be named), or the one its manifest declares. */
export const phrasesOf = (v) => v.owner_decision_phrases ?? [v.owner_decision_phrase];
