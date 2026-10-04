// packages/@monomind/cli/src/orgrt/types-sections.ts
/**
 * Org sections spec 13.1.3 (piece P3.1): the schema entries of the opt-in
 * surface. Every entry is optional and carries no default, so a definition
 * without them parses to exactly the object it parsed to before. The entries
 * only type the top of each key; the structure inside is checked by
 * documents/definition.ts, and only for a definition on the sections surface,
 * so a malformed section reads as a precise finding rather than a schema error.
 */
import { z } from 'zod';

/** `requires: {sections: 1}`: the capability contract. Other keys pass through
 *  and are reported by the definition check as unsupported capabilities. */
export const RequiresSchema = z.object({ sections: z.number().optional() }).passthrough();

/** Top-level `sections`: section name to its declaration (checked in definition.ts). */
export const SectionsSchema = z.record(z.string(), z.unknown());

/** Top-level `documents`: document type to its contract (checked in definition.ts). */
export const DocumentsSchema = z.record(z.string(), z.unknown());

/** `run_config.completion` for a sections org: the policy plus the protocol
 *  discriminator that makes an older parser reject the definition. */
export const SectionsCompletionSchema = z
  .object({ mode: z.enum(['boss', 'dag']), protocol: z.string() })
  .strict();

/** `run_config.experimental`: "eval" is the only value a sections org may carry.
 *  Untyped here so a wrong value stays a checklist finding, never a parse error. */
export const ExperimentalSchema = z.unknown();
