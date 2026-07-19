---
name: monodesign-quieter
description: Reduce visual intensity in designs that are too loud, aggressive, or overstimulating — without losing personality or making the result generic.
type: design-sub-command
argument-hint: "[target page, component, or design]"
user-invocable: true
---

# Monodesign: Quieter

Quiet design is harder than bold design. Subtlety needs precision. Read `reference/quieter.md` from the monodesign skill directory for the full protocol.

## Register

**Brand**: "quieter" means more restrained palette, more whitespace, more typographic air. Drama is reduced, not eliminated — the POV stays intact.

**Product**: "quieter" means reducing visual noise. Fewer background accents, flatter cards, less color, less motion. The tool should disappear more completely into the task.

## Assess What's Too Loud

1. **Color saturation**: Overly bright or saturated colors competing for attention
2. **Contrast extremes**: Too much high-contrast juxtaposition without hierarchy
3. **Visual weight**: Too many bold, heavy elements with no quiet counterweight
4. **Animation excess**: Too much motion or overly dramatic effects
5. **Complexity**: Too many visual elements, patterns, or decorations
6. **Scale**: Everything is large with no moments of relief

## Quieting Interventions

**Reduce color intensity**
- Lower chroma on accents (oklab(L, less-C, H))
- Move from Committed/Full palette to Restrained strategy
- Replace colored backgrounds with tinted neutrals

**Add breathing room**
- Increase whitespace between sections
- Reduce the number of distinct visual elements per screen
- Let one element be the hero; everything else serves it

**Calm the type**
- Reduce heading sizes (headline at 3rem vs. 5rem)
- Use a lighter weight for headings (500 instead of 800)
- Increase line height and letter-spacing slightly

**Flatten the cards**
- Remove drop shadows or reduce them to near-invisible (0 1px 2px oklch(0% 0 0 / 0.05))
- Replace filled card backgrounds with subtle borders or no container at all
- Reduce border-radius

**Calm the motion**
- Remove section-fade animations that fire on every element
- Reduce animation duration by 30–50%
- Remove hover effects that aren't informative

## The Constraint

Quieter ≠ generic. The goal is precision and restraint, not the absence of a design point of view. If the result could be any brand's product, it's not quieter — it's erased. Preserve the brand's distinctive voice while removing the excess.
