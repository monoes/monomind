/**
 * Shared design rules — the invariants every monodesign generation must satisfy.
 * These mirror the "Absolute bans" and "Shared design laws" in the skill.
 */

export const ABSOLUTE_BANS = [
  {
    id: 'side-stripe',
    rule: 'No side-stripe borders',
    description:
      'border-left or border-right > 1px as a colored accent on cards/list items/callouts is never intentional. Rewrite with full borders, background tints, leading numbers/icons, or nothing.',
  },
  {
    id: 'gradient-text',
    rule: 'No gradient text',
    description:
      'background-clip:text with a gradient is decorative and never meaningful. Use a single solid color; emphasis via weight or size.',
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
] as const;

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
