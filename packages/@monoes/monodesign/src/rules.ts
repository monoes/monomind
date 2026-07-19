/**
 * Shared design rules — the invariants every monodesign generation must satisfy.
 * These mirror the "Absolute bans" and "Shared design laws" in the skill.
 *
 * Where a ban has a corresponding mechanical detector rule in the engine
 * registry (cli/engine/registry/antipatterns.mjs), its id and description are
 * pulled from that registry at load time instead of being hand-copied here —
 * one source of truth, no drift between "what generation avoids" and "what
 * detection flags". Bans with no `engineRuleId` are composition/judgment
 * calls the detector cannot mechanically check (holistic layout patterns);
 * they exist here for generation-time guidance only.
 */

// Typed as plain string so tsc emits a true dynamic import instead of trying
// to type-resolve the untyped .mjs engine module (matches antipatterns.ts).
const REGISTRY_SPECIFIER: string = '../cli/engine/registry/antipatterns.mjs';

interface EngineRuleEntry {
  id: string;
  name: string;
  description: string;
}

let registryPromise: Promise<EngineRuleEntry[] | null> | undefined;

async function loadRegistry(): Promise<EngineRuleEntry[] | null> {
  registryPromise ??= import(REGISTRY_SPECIFIER).then(
    (mod) => (mod as { ANTIPATTERNS: EngineRuleEntry[] }).ANTIPATTERNS,
    () => null,
  );
  return registryPromise;
}

export interface AbsoluteBan {
  id: string;
  rule: string;
  description: string;
  /** Engine registry rule id this ban is mechanically detected by, if any. */
  engineRuleId?: string;
}

const ABSOLUTE_BANS_STATIC: AbsoluteBan[] = [
  {
    id: 'side-tab',
    rule: 'No side-stripe borders',
    description:
      'border-left or border-right > 1px as a colored accent on cards/list items/callouts is never intentional. Rewrite with full borders, background tints, leading numbers/icons, or nothing.',
    engineRuleId: 'side-tab',
  },
  {
    id: 'gradient-text',
    rule: 'No gradient text',
    description:
      'background-clip:text with a gradient is decorative and never meaningful. Use a single solid color; emphasis via weight or size.',
    engineRuleId: 'gradient-text',
  },
  {
    id: 'glassmorphism-default',
    rule: 'No glassmorphism as default',
    description:
      'Blurs and glass cards used decoratively. Rare and purposeful, or nothing.',
  },
  {
    id: 'hero-metric-template',
    rule: 'No hero-metric template',
    description:
      'Big number + small label + supporting stats + gradient accent is a SaaS cliché. Find a distinctive composition instead.',
  },
  {
    id: 'identical-card-grid',
    rule: 'No identical card grids',
    description:
      'Same-sized cards with icon + heading + text, repeated endlessly, signals a lack of hierarchy. Vary size, weight, or content structure.',
  },
  {
    id: 'modal-first',
    rule: 'Modal is not the first thought',
    description:
      'Modals are usually laziness. Exhaust inline / progressive disclosure alternatives first.',
  },
];

/** Static ban list — id/rule/description as authored here (may drift from the engine registry's wording for bans that also have a detector rule). */
export const ABSOLUTE_BANS = ABSOLUTE_BANS_STATIC;

/**
 * Same ban list, with descriptions for detector-backed bans (`engineRuleId`
 * set) replaced by the live text from the engine registry. Falls back to the
 * static description when the registry can't be loaded (e.g. package not
 * fully installed) or the referenced rule id is missing.
 */
export async function getAbsoluteBans(): Promise<AbsoluteBan[]> {
  const registry = await loadRegistry();
  if (!registry) return ABSOLUTE_BANS_STATIC;
  const byId = new Map(registry.map((r) => [r.id, r]));
  return ABSOLUTE_BANS_STATIC.map((ban) => {
    const engineRule = ban.engineRuleId ? byId.get(ban.engineRuleId) : undefined;
    return engineRule ? { ...ban, description: engineRule.description } : ban;
  });
}

export const COLOR_STRATEGIES = ['restrained', 'committed', 'full-palette', 'drenched'] as const;
export type ColorStrategy = (typeof COLOR_STRATEGIES)[number];

export const SHADOW_MAX_ALPHA = 0.15;

/** Validates a shadow string does not exceed the max alpha. */
export function shadowAlphaComplies(shadow: string): boolean {
  const matches = shadow.match(/rgba?\([^)]+\)/g) ?? [];
  for (const m of matches) {
    const parts = m.replace(/rgba?\(/, '').replace(')', '').split(',').map(Number);
    const alpha = parts.length === 4 ? parts[3] : 1;
    if (alpha > SHADOW_MAX_ALPHA) return false;
  }
  return true;
}

export type Register = 'brand' | 'product';

/** Infer register from surface description heuristic. */
export function inferRegister(surface: string): Register {
  const lower = surface.toLowerCase();
  const brandKeywords = ['landing', 'marketing', 'campaign', 'homepage', 'portfolio', 'blog'];
  const productKeywords = ['dashboard', 'admin', 'app', 'settings', 'onboard', 'console'];

  if (brandKeywords.some((k) => lower.includes(k))) return 'brand';
  if (productKeywords.some((k) => lower.includes(k))) return 'product';
  return 'product'; // safe default
}
