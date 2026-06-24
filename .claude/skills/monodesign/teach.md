---
name: monodesign-teach
description: Create or update PRODUCT.md — extract product context, users, brand voice, and design principles from the codebase, existing files, and conversation to anchor all future monodesign work.
type: design-sub-command
argument-hint: "[project path or description]"
user-invocable: true
---

# Monodesign: Teach

Create or update `PRODUCT.md` — the required context anchor for all `/monodesign` sub-commands.

`PRODUCT.md` is not a design document — it's the product context document. It answers: who uses this, what is it for, what is the brand personality, and what design anti-references should be avoided.

## When to Run

Run `/monodesign teach` when:
- Starting work on a new project with no `PRODUCT.md`
- The existing `PRODUCT.md` is empty, placeholder (<200 chars), or has `[TODO]` markers
- The product has significantly evolved and the `PRODUCT.md` is stale

## Discovery Protocol

**Step 1: Gather existing signals**

Read the following files if they exist:
- `README.md` — what is this product?
- `package.json` — name, description, keywords
- Any landing page copy (`index.html`, `src/pages/index.astro`, etc.)
- Existing `PRODUCT.md` (to assess completeness)

If a description or tagline exists, extract: target user, core value proposition, brand personality signals.

**Step 2: Ask for what's missing**

Ask the user 3–5 targeted questions based on what couldn't be inferred:
- Who specifically uses this? (Role, context, skill level)
- What's the one thing this does better than alternatives?
- Three words that describe the brand personality
- What design style do you want to AVOID? (anti-references)
- Is this a marketing surface, product UI, or both?

**Step 3: Write PRODUCT.md**

```markdown
# Product

## Register
[brand | product | both]

## Users
[Specific description of who uses this — not "developers", but "senior engineers at mid-size SaaS companies who need to..."]

## Product Purpose
[What this does and why it matters to those users. One paragraph.]

## Brand Personality
[3 words + a description of the tone. Direct, specific, no hedging.]

## Anti-references
[Specific things this product should NOT look like. Brand names, aesthetics, clichés to avoid.]

## Design Principles
[3–5 opinionated principles that guide all design decisions.]
```

## After Writing

Confirm with the user that the PRODUCT.md is accurate before continuing to any design work. The PRODUCT.md is the foundation — if it's wrong, everything built on it is built on the wrong foundation.
