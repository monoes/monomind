---
name: monodesign-craft
description: Build a feature with impeccable UX and UI quality — shape the design, land the visual direction, build real production code, inspect and improve in-browser until it meets a high-end studio bar.
type: design-sub-command
argument-hint: "[feature description]"
user-invocable: true
---

# Monodesign: Craft

Build a feature with impeccable UX and UI quality. Real working code, committed design choices, exceptional craft.

**Gates — do not compress.** Craft requires all setup gates to pass before writing code:
1. PRODUCT.md and DESIGN.md loaded
2. Register identified (brand or product) and matching reference loaded
3. Shape brief confirmed by user

Read `reference/craft.md` from the monodesign skill directory for the full flow.

## Step 0: Project Foundation

Before shape, before code: determine what kind of project you're working in.

Check for:
- An existing framework (`astro.config.mjs`, `next.config.js`, `vite.config.js`, etc.) — **if found, use it**
- Existing component library or design system — read what's there before adding to it
- Existing icon set — use what's already in the project; don't introduce a second set

If greenfield with no framework, ask the user:
- Astro (for content-led brand sites, landing pages)
- SvelteKit / Next.js / Nuxt (app surfaces, significant interactivity)
- Single index.html (one-shot demo, prototype)

## Step 1: Shape the Design

Run `/monodesign shape` if no confirmed brief exists. Stop and wait for explicit brief confirmation before writing code. Shape confirmation is NOT a green light to code; it's the green light to confirm direction.

## Step 2: Implement

With a confirmed brief:
1. Load `reference/craft.md` for the full implementation protocol
2. Follow the register-specific implementation guide (brand.md or product.md)
3. Apply all shared design laws from the monodesign SKILL.md
4. Verify visually using browser automation — don't assume it looks right
5. Iterate until it meets the approved direction

## Quality bar

Produce ready-to-ship, production-grade code. Not a prototype. Not a starting point. Beautiful, responsive, fast, precise, bug-free, on-brand. Take attention to detail seriously.

**The AI slop test**: if someone could look at this and say "AI made that" without doubt, it's failed. Cross-register failures are the absolute bans in the design laws.
