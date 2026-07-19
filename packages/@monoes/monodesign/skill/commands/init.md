---
name: monodesign-init
description: Set up a project for monodesign — one codebase crawl plus a short interview produces PRODUCT.md (strategic context), optionally DESIGN.md (visual system), and pre-configures live mode. The required first step that anchors all other monodesign commands.
type: design-sub-command
argument-hint: "[project path or description]"
user-invocable: true
---

# Monodesign: Init

Set up a project for monodesign. Read `reference/init.md` from the monodesign skill directory for the full flow — it is the authoritative protocol. (`/monodesign teach` is the historical alias; it behaves identically.)

## What init produces

- **PRODUCT.md** (strategic): register, target users, product purpose, brand personality, anti-references, strategic design principles. Answers "who/what/why".
- **DESIGN.md** (visual, offered via `/monodesign document`): visual theme, color palette, typography, components, layout. Answers "how it looks".
- **`.monodesign/live/config.json`**: pre-configured live mode so `/monodesign live` boots straight into variant mode.

## Flow summary (the reference is authoritative)

1. **Load current state**: check for existing PRODUCT.md / DESIGN.md (project root, `.agents/context/`, `docs/`). Never silently overwrite — confirm which file to refresh. A legacy `.monodesign.md` is auto-renamed to PRODUCT.md by the loader.
2. **Explore the codebase**: one thorough crawl — README/docs, package.json and framework detection, existing components, brand assets, design tokens. Form a register hypothesis (brand vs product vs both) and a platform hypothesis (`web` / `ios` / `android` / `adaptive`).
3. **Interview**: ask strategic questions to fill PRODUCT.md — register and platform confirmation, users, purpose, positioning, brand personality, anti-references, accessibility needs (plus conversion & proof for the brand register). Never synthesize PRODUCT.md from the task prompt alone; the user confirms before you write.
4. **Write PRODUCT.md** with only what the user confirmed.
5. **Offer DESIGN.md** via `/monodesign document` — scan mode when code exists, seed mode for empty projects.
6. **Pre-configure live mode** when the project has HTML entries and a dev server.

## Blocker behavior

If init was invoked as a setup blocker by another command (e.g. `/monodesign craft` with no PRODUCT.md), complete init, then resume the original command with the fresh context.
