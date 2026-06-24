---
name: monodesign-document
description: Create or update DESIGN.md — extract and codify the design system from the codebase into a portable, AI-readable design reference that anchors all future monodesign work.
type: design-sub-command
argument-hint: "[project path]"
user-invocable: true
---

# Monodesign: Document

Create or update `DESIGN.md` — the design system reference for this project. Every `/monodesign` sub-command uses DESIGN.md to make on-brand decisions without asking the same questions repeatedly.

DESIGN.md is the portable export of the project's design system: colors, typography, spacing, components, and conventions — extracted from what's actually in the code, not invented.

Read `reference/document.md` from the monodesign skill directory for the full protocol.

## Discovery

**Extract from codebase:**
```bash
# Find CSS custom properties
grep -r "^--" src/ --include="*.css" --include="*.scss" -h | sort -u

# Find font declarations
grep -r "font-family\|@font-face\|@import.*font" src/ -h | sort -u

# Find color values
grep -rE "#[0-9a-fA-F]{3,8}|oklch\(|rgb\(|hsl\(" src/ -h | sort -u | head -50
```

**Also read:**
- `tailwind.config.js/ts` — theme configuration
- `tokens.css`, `theme.css`, `variables.css`, or equivalent
- A representative component to understand CSS conventions

## DESIGN.md Structure

```markdown
# Design System

## Brand Identity
**Name**: [product name]
**System**: [design system name, e.g. "Neo kinpaku system"]
**Strategy**: [Restrained | Committed | Full palette | Drenched]
**Theme**: [dark | light | both]

## Colors (OKLCH)

### Brand
| Token | Value | Use |
|---|---|---|
| --color-brand | oklch(…) | Primary accent |
| --color-brand-muted | oklch(…) | Secondary accent |

### Surfaces
[table]

### Text
[table]

## Typography

| Role | Font | Size | Weight | Line Height |
|---|---|---|---|---|
| Display | [family] | clamp(3rem, 5vw, 5rem) | 800 | 1.1 |
| Heading 1 | … | … | … | … |
| Body | … | 1rem | 400 | 1.6 |
| Caption | … | 0.875rem | 400 | 1.4 |

## Spacing Scale
[4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128]

## Components
[Brief description of key shared components and their variants]

## Conventions
- File naming: [convention]
- Token naming: [convention]  
- Component import style: [named/default/barrel]
```
