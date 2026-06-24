# Reengineer Squad — Cycle 1 Discovery Report

**Date**: 2026-06-24
**Source**: `/Users/morteza/Desktop/tools/impeccable` (v3.1.0)
**Target**: `/Users/morteza/Desktop/tools/monomind` (monodesign skill)
**Session**: mm-20260624T091654

---

## Source Analyst Findings — Impeccable v3.1.0

### Module Inventory

Impeccable is a design-skills system for AI coding agents, organized into four top-level domains:

| Domain | Path | Description |
|---|---|---|
| Skill layer | `skill/` | AI agent skill: SKILL.src.md, sub-command md files, reference docs, runtime scripts |
| CLI engine | `cli/engine/` | Anti-pattern detection engine (Node.js, 2,671-line rule set) |
| Browser extension | `extension/` | Chrome MV3 extension for live design review |
| Marketing site | `site/` | Astro marketing site with "Neo kinpaku" brand system |

#### Sub-commands (23 in command-metadata.json)

`adapt`, `animate`, `audit`, `bolder`, `clarify`, `colorize`, `craft`, `critique`, `delight`, `distill`, `document`, `extract`, `harden`, `init`, `layout`, `live`, `onboard`, `optimize`, `overdrive`, `polish`, `quieter`, `shape`, `typeset`

#### Reference documents (28 files in skill/reference/)

Covers: `antipatterns-catalog`, `brand-workflow`, `brand`, `cognitive-load`, `color-and-contrast`, `component-specs`, `component-states`, `component-system`, `copy-formulas`, `design-principles`, `heuristics-scoring`, `image-prompts`, `interaction-design`, `layout`, `motion-design`, `personas`, `pre-delivery-checklist`, `product`, `responsive-design`, `spatial-design`, `token-architecture`, `typography`, `ux-research`, `ux-rules`, `ux-writing` — plus `codex.md`, `hooks.md`, `init.md`

#### CLI Anti-pattern Detection Engine

- `cli/engine/detect-antipatterns.mjs` — public API facade
- `cli/engine/rules/checks.mjs` — 2,671-line pure detection functions (borders, colors, typography, layout, motion)
- `cli/engine/registry/antipatterns.mjs` — 44 rule definitions across `slop` and `quality` categories
- `cli/engine/design-system.mjs` — 750-line design system loader (frontmatter, OKLCH tokens, design-token diffing)
- `cli/engine/engines/browser/detect-url.mjs` — browser-driven scan via Puppeteer/CDP
- `cli/engine/engines/regex/detect-text.mjs` — text/CSS regex scanning
- `cli/engine/engines/static-html/detect-html.mjs` — static HTML parsing
- `cli/engine/engines/visual/screenshot-contrast.mjs` — screenshot-based contrast detection
- `cli/engine/node/file-system.mjs` — directory walker, import graph builder, framework detector
- `cli/engine/profile/profiler.mjs` — detection profile creation and summary
- `cli/engine/shared/{color,constants,inline-ignores,page}.mjs` — shared utilities

#### Browser Extension

Chrome MV3 extension (`manifest_version: 3`, v1.2.1) with: `background/service-worker.js`, `content/content-script.js`, `popup/{popup.html,popup.js,popup.css}`, `devtools/{panel,sidebar,devtools}.{html,js,css}`. Scans any web page for design anti-patterns, shows findings in DevTools panel and popup badge.

#### Skill Runtime Scripts (live mode + hooks)

- `skill/scripts/detect.mjs` — skill-bundled detector runner
- `skill/scripts/hook.mjs` — hook installer across Claude Code, Codex, Cursor, Copilot
- `skill/scripts/hook-admin.mjs` — hook management CLI
- `skill/scripts/hook-before-edit.mjs` — pre-edit hook runner
- `skill/scripts/hook-lib.mjs` — hook utilities
- `skill/scripts/live.mjs` — live variant mode entry point
- `skill/scripts/live/` — 3,716 lines of live mode logic (svelte components, session store, browser injection, manual edits)
- `skill/scripts/context.mjs` — project context reader (PRODUCT.md/DESIGN.md)
- `skill/scripts/context-signals.mjs` — signals for command routing
- `skill/scripts/palette.mjs` — OKLCH brand seed color generator
- `skill/scripts/pin.mjs` — shortcut installer
- `skill/scripts/critique-storage.mjs` — critique session persistence

#### Specialized Sub-agents

- `skill/agents/impeccable-asset-producer.md` — Codex-native raster asset production agent
- `skill/agents/impeccable-manual-edit-applier.md` — live manual edit application agent

---

## Target Analyst Findings — Monomind monodesign

### What monodesign already covers

Monodesign (`/Users/morteza/Desktop/tools/monomind/.claude/skills/monodesign/`) already has:

**Sub-command md files (23 files):**
`adapt`, `animate`, `audit`, `bolder`, `clarify`, `colorize`, `craft`, `critique`, `delight`, `distill`, `document`, `extract`, `harden`, `live`, `onboard`, `optimize`, `overdrive`, `polish`, `quieter`, `shape`, `teach`, `typeset` — all match impeccable's command surface. Monodesign extras beyond impeccable: `components`, `research`, `images` (3 commands unique to monodesign).

**Reference docs (47 files in reference/):**
Monodesign has 47 reference files vs. impeccable's 28. Monodesign covers everything impeccable's reference/ has PLUS 22 additional files (personas, ux-research, responsive-design, component-system, spatial-design, motion-design, typography, token-architecture, design-principles, etc.).

**Anti-pattern catalog:** Monodesign's `reference/antipatterns-catalog.md` has 27 patterns. Impeccable's registry has 44. Delta: 17 patterns missing from monodesign.

**SKILL.md:** Well-structured with commands table, routing rules, hooks section, and OKLCH design rules. References `npx impeccable detect` externally.

### What monodesign is missing vs. impeccable

| Gap | Description | Priority |
|---|---|---|
| 17 missing anti-patterns | `aphoristic-cadence`, `body-text-viewport-edge`, `broken-image`, `clipped-overflow-container`, `cream-palette`, `design-system-color`, `design-system-font`, `design-system-radius`, `em-dash-overuse`, `extreme-negative-tracking`, `gpt-thin-border-wide-shadow`, `image-hover-transform`, `marketing-buzzword`, `numbered-section-markers`, `oversized-h1`, `repeated-section-kickers`, `repeating-stripes-gradient`, `text-overflow`, `theater-slop-phrase` | HIGH |
| `reference/codex.md` | Image generation direction flow (4-stop palette/mock workflow for Codex/image_gen) | HIGH |
| `reference/hooks.md` | Hook management command reference for per-project design detector hook | HIGH |
| `reference/init.md` | Full init flow reference (init is an alias for `teach`; monodesign's teach.md is shorter — 156 lines vs. 172 — but may be functionally equivalent) | MEDIUM |
| CLI anti-pattern detection engine | 44-rule Node.js engine with browser/regex/static-html/visual engines — this is an executable binary, not just reference docs | HIGH |
| Browser extension | Chrome MV3 extension for live web-page scanning | LOW |
| Skill runtime scripts | detect.mjs, hook.mjs, context.mjs, palette.mjs, live mode scripts (live is referenced but the runtime machinery is not ported) | MEDIUM |
| Specialist sub-agents | `impeccable-asset-producer.md`, `impeccable-manual-edit-applier.md` | MEDIUM |
| `reference/brand-workflow.md` | Brand decision workflow — monodesign has `reference/brand.md` but not `brand-workflow.md` | MEDIUM |

**Not missing (already in monodesign or intentionally different):**
- All 23 impeccable sub-command md files — covered
- All 28 impeccable reference files — covered (monodesign has superset)
- `layout` command — monodesign has `reference/layout.md`; impeccable has it in metadata but no skill md; monodesign is ahead
- `components`, `research`, `images` commands — monodesign extensions beyond impeccable's scope

---

## Module Classification

### Modules Discovered: 9

| Module | Novelty | Complexity | Verdict |
|---|---|---|---|
| `antipatterns-catalog-delta` — 17 missing anti-pattern rules for monodesign's catalog | 5 | low | ADOPT |
| `codex-reference` — `reference/codex.md` image-gen direction flow | 4 | low | ADOPT |
| `hooks-reference` — `reference/hooks.md` hook management reference | 4 | low | ADOPT |
| `cli-detection-engine` — 44-rule anti-pattern detection Node.js engine | 5 | high | ADAPT |
| `brand-workflow-reference` — `reference/brand-workflow.md` | 3 | low | ADOPT |
| `skill-runtime-scripts` — detect.mjs, hook.mjs, context.mjs, palette.mjs | 4 | medium | ADAPT |
| `specialist-subagents` — asset-producer, manual-edit-applier agents | 3 | medium | ADAPT |
| `browser-extension` — Chrome MV3 anti-pattern review extension | 4 | high | VETO |
| `live-mode-runtime` — Svelte/SvelteKit live variant mode server | 3 | high | VETO |

### Already Ported / Skipped (covered in monodesign)

| Module | Reason |
|---|---|
| All 23 sub-command md files | Fully present in monodesign (monodesign has superset) |
| All 28 impeccable reference files | Fully present; monodesign reference dir is a superset (47 files) |
| `init` command | Covered by monodesign's `teach.md` |
| Marketing site / brand system | Out of scope — impeccable's site is impeccable's own marketing, not a portable module |
| `functions/` (Cloudflare Workers) | Backend serving for impeccable.dev — not portable |
