---
name: monodesign-delight
description: Add moments of delight, whimsy, and personality to interfaces — micro-interactions, easter eggs, playful copy, unexpected moments that make users smile without sacrificing usability.
type: design-sub-command
argument-hint: "[target component, empty state, interaction, or whole product]"
user-invocable: true
---

# Monodesign: Delight

Add moments of delight, whimsy, and personality. Read `reference/delight.md` from the monodesign skill directory for the full protocol.

## Philosophy

Delight is not decoration. It's the feeling a user gets when the product treats them as a human, not a task-completer. The best delight is:
- **Discovered, not announced** — it rewards exploration, it doesn't interrupt
- **Appropriate to context** — a playful empty state is right; a playful error message on a failed payment is wrong
- **Consistent with brand personality** — delight that contradicts the brand voice creates whiplash

## Where Delight Lives

**Empty states**
The most underdesigned surface in almost every product. When a user has no data, they're often new and uncertain. An empty state that's warm, encouraging, and occasionally charming turns uncertainty into curiosity.

**Micro-interactions**
The moments that feel physical: a button that compresses on press, a toggle that snaps, a checkbox that checks with a tiny satisfying arc, a completion animation that celebrates without being overwrought.

**Copy**
Delight isn't always visual. An error message that says "Hmm, that didn't work — here's what we know:" treats the user as a collaborator. Copy that has a voice (specific to this product, not generic SaaS) is delightful in itself.

**Easter eggs**
Hidden interactions that reward the curious. The konami code that does something silly. A hover state that's unexpectedly specific. A tooltip that breaks the fourth wall once.

**Loading states**
Instead of a spinning circle, something that's interesting to watch. A progress animation that tells you something about what the product is doing.

## Delight Hierarchy

Rate each idea against:
1. **Does it interrupt the user's task?** If yes, cut it. Delight never gets in the way.
2. **Is it consistent with the brand personality?** A product that's "expert, decisive, editorial" shouldn't have cartoon characters.
3. **Does it degrade gracefully?** The primary function must work even if the delightful layer fails.
4. **Will it get old?** Animations that play every time something happens become annoying. Use sparingly.

## Implementation

Read `reference/delight.md` for specific delight patterns by component type (empty states, interactions, copy formulas, animation recipes).
