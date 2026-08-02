<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/packages/monodesign.png" alt="@monoes/monodesign" width="600" />
</p>

# @monoes/monodesign

[![npm version](https://img.shields.io/npm/v/@monoes/monodesign?style=flat-square)](https://www.npmjs.com/package/@monoes/monodesign)
[![license](https://img.shields.io/npm/l/@monoes/monodesign?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

**Frontend design intelligence for AI agents** — OKLCH design tokens, a 51-rule AI-slop
antipattern detector, and the `/monodesign` agent skill for Claude Code and Gemini agy.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem. v1.2.3 · Apache-2.0

---

## Install

```bash
npm install @monoes/monodesign
```

---

## What's Inside

| Module | Export path | Purpose |
|---|---|---|
| Design tokens (TS) | `@monoes/monodesign` | Typed constants for font, spacing, color, motion |
| Design tokens (CSS) | `@monoes/monodesign/tokens` | CSS custom properties (`tokens.css`) |
| Detection engine | `@monoes/monodesign/engine` | Node-side 51-rule antipattern detector |
| Browser bundle | `@monoes/monodesign/engine/browser` | Browser-compatible detector (no Node deps) |

---

## Design Tokens

Source: [`src/tokens.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monoes/monodesign/src/tokens.ts) + [`src/tokens.css`](file:///Users/morteza/Desktop/tools/monomind/packages/@monoes/monodesign/src/tokens.css)

All color tokens are in **OKLCH** — no hex colors in the token system.

### Token Categories

| Category | Key Values |
|---|---|
| **Typography** | Fonts: `'Cormorant Garamond'` (display), `'Instrument Sans'` (body), `'Space Grotesk'` (mono). Scale: xs (12px) → 7xl (72px). Line-heights: 1.2–2.0 |
| **Spacing** | 8px base grid: `--space-1` (4px) → `--space-30` (120px) |
| **Color** | Neutrals: ink/charcoal/ash/mist/cream/paper/white. Accent: Editorial Magenta `oklch(60% 0.25 350)` with 9-stop tonal ramp |
| **Motion** | Expo-out primary `cubic-bezier(0.16,1,0.3,1)`, plus quint, in-out, in. Durations: 0s → 1.2s |
| **Shadows** | sm/md/lg/accent. Max 0.15 alpha. |
| **Radius** | none(0) → sm(4px) → md(8px) → lg(12px) → xl(16px) → full(9999px) |
| **Z-index** | Named scale: below(−1) → base(0) → raised(1) → overlay(10) → modal(20) → toast(30) → top(40) |

### CSS Usage

```css
/* Import CSS custom properties */
@import '@monoes/monodesign/tokens';

.hero {
  font-family: var(--font-display);
  color: var(--color-ink);
  padding: var(--space-8);
  border-radius: var(--radius-lg);
  transition: transform var(--duration-default) var(--easing-expo-out);
}
```

### TypeScript Usage

```typescript
import { fontFamily, fontSize, spacing, easing, duration, color, accentScale, shadow, radius } from '@monoes/monodesign';

console.log(color.accent);    // oklch(60% 0.25 350)
console.log(spacing[8]);      // 32px
console.log(radius.lg);       // 12px
```

---

## Antipattern Detection (51 Rules)

Source: [`cli/engine/registry/antipatterns.mjs`](file:///Users/morteza/Desktop/tools/monomind/packages/@monoes/monodesign/cli/engine/registry/antipatterns.mjs) — 564 lines, 51 entries.

### Rule Categories

**`slop`** (21 rules) — AI-generation tells that make UIs feel generic:

`side-tab`, `border-accent-on-rounded`, `overused-font`, `single-font`, `flat-type-hierarchy`, `gradient-text`, `ai-color-palette`, `cream-palette`, `nested-cards`, `monotonous-spacing`, `bounce-easing`, `dark-glow`, `icon-tile-stack`, `italic-serif-display`, `hero-eyebrow-chip`, `repeated-section-kickers`, `numbered-section-markers`, `em-dash-overuse`, `marketing-buzzword`, `aphoristic-cadence`, `oversized-h1`, `extreme-negative-tracking`, `broken-image`

**`quality`** (24 rules) — Accessibility and design principle violations:

`gray-on-color`, `low-contrast`, `layout-transition`, `line-length`, `cramped-padding`, `body-text-viewport-edge`, `tight-leading`, `skipped-heading`, `justified-text`, `tiny-text`, `all-caps-body`, `wide-tracking`, `text-overflow`, `clipped-overflow-container`, `design-system-font`, `design-system-color`, `design-system-radius`, `design-system-font-size`, `missing-focus-visible`, `small-touch-target`, `hover-only-affordance`, `image-missing-dimensions`, `dark-scheme-contrast-blindspot`

**Provider-gated** (4 advisory rules, opt-in via `--gpt`/`--gemini`): `gpt-thin-border-wide-shadow`, `repeating-stripes-gradient`, `codex-grid-background`, `theater-slop-phrase`

### Detection Engines

| Engine | Method | Optional dep |
|---|---|---|
| `regex` | Source text / CSS-in-JS scan | none |
| `static-html` | HTMLparser2 static DOM parse | none |
| `browser` | Puppeteer live-page scan | `puppeteer` (optional) |
| `visual` | Visual contrast analysis | `@monoes/monobrowse` (optional) |

### Auto-Fix

`cli/engine/fix/fixers.mjs` implements safe per-rule codemods. `--dry-run` prints unified diffs. `--rule <id,...>` narrows the fix to specific rule IDs.

---

## OKLCH Palette Seed Library

Source: [`packages/@monomind/cli/src/commands/design-palette.ts:29–417`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/design-palette.ts#L29-L417)

- **129 hand-curated seeds** spanning the full hue wheel (0°–360°)
- Each seed: `{ id, oklch: [L, C, H], mood: string, strategy: string }`
- **Hue-zone weighting**: inverse-frequency across 30° buckets — equal probability for all hue regions regardless of seed density
- **Env var override**: `MONODESIGN_PALETTE_SEED`

---

## The `/monodesign` Agent Skill

Source: [`skill/SKILL.src.md`](file:///Users/morteza/Desktop/tools/monomind/packages/@monoes/monodesign/skill/SKILL.src.md) · v2.0.0 · Apache-2.0

Triggers: `/monodesign`, `/design`, `/frontend-design`, plus 40+ natural-language triggers.

### 24 Skill Commands

| Category | Commands |
|---|---|
| Build | `craft`, `shape`, `init`, `document`, `extract`, `components`, `images`, `palette` |
| Evaluate | `critique`, `audit`, `research`, `detect` |
| Refine | `polish`, `bolder`, `quieter`, `distill`, `harden`, `onboard` |
| Enhance | `animate`, `colorize`, `typeset`, `layout`, `delight`, `overdrive` |
| Fix | `clarify`, `adapt`, `optimize` |
| Iterate | `live` |
| Management | `pin`, `unpin`, `hooks` |

### Sub-Agents

| Agent file | Role |
|---|---|
| `skill/agents/monodesign-asset-producer.md` | Image/asset generation |
| `skill/agents/monodesign-manual-edit-applier.md` | Accepts live manual edits during `live` sessions |

---

## Hooks Integration

When enabled (`.monodesign/config.json`), antipattern detection runs automatically after UI file edits:

```json
{
  "hook": {
    "enabled": true,
    "limits": { "maxFindings": 5, "maxChars": 8000 }
  }
}
```

Manage via `monomind design ignores` or `/monodesign hooks <on|off|status|ignore-rule|ignore-file|ignore-value|reset>`.

---

## CLI Subcommands (`monomind design`)

| Command | Purpose |
|---|---|
| `monomind design detect [-t <path>] [--json]` | Scan HTML/CSS for antipatterns |
| `monomind design fix [-t <path>] [--dry-run] [--json] [--rule <ids>]` | Auto-fix with safe codemods |
| `monomind design ignores <list\|add-rule\|add-file\|add-value\|remove-rule>` | Manage detector ignores |
| `monomind design palette [--id <id>] [--from <key>] [--random] [--json]` | Pick OKLCH brand seed |

---

## Design System Consistency

Source: [`cli/engine/design-system.mjs`](file:///Users/morteza/Desktop/tools/monomind/packages/@monoes/monodesign/cli/engine/design-system.mjs) — 815 lines

Parses `DESIGN.md` / `.monodesign/design.json` to enforce consistency rules (`design-system-font`, `design-system-color`, `design-system-radius`, `design-system-font-size`). The skill writes `DESIGN.md`; the detector reads it for drift detection.

Search order: `DESIGN.md` → `.agents/context/DESIGN.md` → `docs/DESIGN.md`.

---

## Package Exports

```json
{
  ".":                   "./src/index.ts",
  "./tokens":            "./src/tokens.css",
  "./engine":            "./cli/engine/detect-antipatterns.mjs",
  "./engine/browser":    "./cli/engine/detect-antipatterns-browser.js"
}
```

**Dependencies:** `css-select`, `css-tree`, `domutils`, `fflate`, `htmlparser2`, `marked`  
**Optional:** `@monoes/monobrowse` (browser detection), `puppeteer` (live URL scanning)

---

## Links

- [GitHub](https://github.com/monoes/monomind)
- [Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

Apache-2.0
