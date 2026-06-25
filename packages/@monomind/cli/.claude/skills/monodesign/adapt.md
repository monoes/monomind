---
name: monodesign-adapt
description: Adapt an existing design to a new context — different device, market, audience, brand, or constraint — while preserving what works and redesigning what doesn't transfer.
type: design-sub-command
argument-hint: "[source design] [→ target context]"
user-invocable: true
---

# Monodesign: Adapt

Adapt an existing design to a new context. Read `reference/adapt.md` from the monodesign skill directory for the full protocol.

## Adaptation Contexts

**Device / viewport adaptation**
- Desktop → mobile: not just scaling down, but rethinking information priority and touch targets
- Mobile → desktop: not just scaling up, but leveraging the additional space meaningfully
- Read `reference/responsive-design.md` for the full responsive protocol

**Brand adaptation**
- Same product, updated visual identity
- Preserve brand equity (recognition, trust) while updating the expression
- Map old tokens → new tokens; don't just swap colors

**Market/locale adaptation**
- Text expansion/contraction for translated content (German strings are ~30% longer than English)
- RTL adaptation: mirror layouts, flip directional icons, adjust text alignment
- Cultural color associations (white = mourning in some cultures, luck in others)

**Audience adaptation**
- Consumer → enterprise: more density, more data, less marketing
- Expert → beginner: more guidance, less assumed knowledge, more white space
- Accessibility adaptation: meeting WCAG AAA, or serving a specific disability need

**Constraint adaptation**
- High performance: remove animations, reduce image weight, simplify components
- Reduced-color: grayscale or high-contrast mode
- Print: remove interactive elements, adjust typography for print

## Adaptation Protocol

1. **Document what transfers**: list everything from the original that works in the new context
2. **Document what doesn't transfer**: list what breaks, looks wrong, or becomes inaccessible
3. **Identify the preservation priorities**: what is most essential to carry over (brand recognition, key interactions, data structures)?
4. **Redesign for the new context**: don't just modify — actively ask "what would we design if we started here?"
5. **Validate against the target context**: test on the actual device/locale/audience constraint

## Output

The adapted design with:
- Changed CSS/tokens documented in comments
- Preserved brand tokens unchanged
- New context-specific overrides in a separate file or scope
