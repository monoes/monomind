---
name: monodesign-shape
description: Shape the UX and UI for a feature before any code is written — produces a structured design brief through discovery, not guesswork. Design planning only; no code written. Output is a brief for monodesign:craft.
type: design-sub-command
argument-hint: "[feature description]"
user-invocable: true
---

# Monodesign: Shape

Shape the UX and UI for a feature before any code is written. This command produces a **design brief**: a structured artifact that guides implementation through discovery.

**Scope**: Design planning only. No code written. Output: a design brief for `/monodesign craft`.

## Setup
Read `PRODUCT.md` and (if present) `DESIGN.md` from the project root before starting. These are required anchors.

Read `reference/shape.md` from the monodesign skill directory for the full command flow.

## Phase 1: Discovery Interview

Do NOT write any code or make design decisions during this phase. Ask 2–3 questions per round, then wait for answers. Have a natural dialogue; don't dump all questions at once.

**Purpose & Context**
- What is this feature for? What problem does it solve?
- Who specifically will use it? (Role, context, frequency — not "users")
- What's the user's state of mind when they reach this? (Rushed? Exploring? Anxious?)

**Content & Data**
- What content or data does this display or collect?
- What are the realistic ranges? (0 items, typical, max, edge cases)
- What are the empty state, error state, first-time use, power-user scenarios?

**Design Direction** — force a visual decision on three fronts:
- **Color strategy**: Restrained / Committed / Full palette / Drenched
- **Theme via scene sentence**: one sentence of physical context that forces dark vs. light
- **Two or three named anchor references** — specific products, brands, objects (not adjectives)

**Scope** — always ask explicitly:
- Fidelity: Sketch / mid-fi / high-fi / production-ready?
- Breadth: One screen / a flow / a whole surface?
- Time intent: Quick exploration or polish until it ships?

## Phase 2: Brief Synthesis

After the discovery round, synthesize and present a structured **Design Brief**:

```
## Design Brief: [Feature Name]

**User**: [concrete description]
**Problem**: [one sentence]
**Success**: [measurable outcome]
**User state**: [emotional/contextual state]

**Content**: [what's displayed/collected + realistic ranges]
**Edge cases**: [empty, error, overload, first-use]

**Visual direction**:
- Color strategy: [Restrained|Committed|Full palette|Drenched]
- Theme: [dark|light] — [scene sentence]
- References: [3 named references]

**Scope**: [fidelity] / [breadth] / [time intent]
```

Stop and wait for explicit user confirmation before advancing to `/monodesign craft`. Do not start coding until the brief is approved.

## Assert-then-confirm

When PRODUCT.md and the prompt make one option obvious, name it and ask the user to confirm or override. Don't present four-option menus when the answer is already clear.
