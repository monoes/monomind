# Component Specifications

Variants, sizes, states, and anatomy for core UI components. Use during `shape`, `critique`, and `extract` workflows to ensure components are fully specified.

For the interactive state system (focus rings, disabled CSS, ARIA patterns), see `component-states.md`. For token references, see `token-architecture.md`. For the Editorial Sanctuary component specs (CTA, nav, card, email input), see `design-principles.md`.

---

## Button

### Variants

| Variant | Background | Text | Border | Use case |
|---------|------------|------|--------|----------|
| `default` | `--color-ink` | `--color-surface` | none | Primary actions |
| `secondary` | `--color-mist` | `--color-ink` | none | Secondary actions |
| `outline` | transparent | `--color-ink` | `1px --color-border` | Tertiary actions |
| `ghost` | transparent | `--color-ink` | none | Subtle actions |
| `link` | transparent | `--color-accent` | none | Inline navigation |
| `destructive` | `oklch(55% 0.22 27)` | white | none | Dangerous actions |

### Sizes

| Size | Height | Padding X | Padding Y | Font size |
|------|--------|-----------|-----------|-----------|
| `sm` | 32px | 12px | 6px | 14px |
| `default` | 40px | 16px | 8px | 14px |
| `lg` | 48px | 24px | 12px | 16px |
| `icon` | 40px | 0 | 0 | — |

### States

| State | Treatment |
|-------|-----------|
| default | Base appearance |
| hover | Background shifts to `--color-accent` (primary variant) |
| active | Darkest variant — `oklch(42% 0.22 350)` |
| focus | Focus ring — see `component-states.md` |
| disabled | 50% opacity + `cursor: not-allowed` + `pointer-events: none` |
| loading | 70% opacity + spinner, button disabled |

### Anatomy

```
┌──────────────────────────────────────┐
│  [icon]   Label Text   [icon]        │
└──────────────────────────────────────┘
     ↑                       ↑
  leading icon          trailing icon
```

**Editorial Sanctuary CTA note:** Primary CTAs use `border-radius: 0`, uppercase label, `letter-spacing: 0.08em`. See `design-principles.md`.

---

## Input

### Variants

| Variant | Description |
|---------|-------------|
| `text` | Standard single-line text |
| `textarea` | Multi-line text |
| `select` | Dropdown selection |
| `checkbox` | Boolean toggle |
| `radio` | Single-from-group selection |
| `switch` | On/off toggle |

### Sizes

| Size | Height | Padding | Font size |
|------|--------|---------|-----------|
| `sm` | 32px | 8px 12px | 14px |
| `default` | 40px | 8px 12px | 14px |
| `lg` | 48px | 12px 16px | 16px |

### States

| State | Border | Ring |
|-------|--------|------|
| default | `--color-border` | none |
| hover | `--color-ash` | none |
| focus | `--color-accent` | `--color-accent-dim` (3px) |
| error | `oklch(55% 0.22 27)` | `oklch(55% 0.22 27 / 0.2)` |
| disabled | `--color-mist` | none |

### Anatomy

```
Label                    (required marker if applicable)
┌────────────────────────────────────────┐
│  [icon]   Placeholder / Value  [clear] │
└────────────────────────────────────────┘
Helper text — or error message in error state
```

**Rule:** Always pair with a `<label>`. Placeholder alone is not a label. Helper text is persistent; error text appears after blur on invalid input.

---

## Card

### Variants

| Variant | Shadow | Border | Use case |
|---------|--------|--------|----------|
| `default` | none at rest → `--shadow-md` on hover | `1px --color-border` | Standard container |
| `elevated` | `--shadow-lg` | none | Prominent / featured content |
| `outline` | none | `1px --color-border` | Subtle container |
| `interactive` | none → `--shadow-md` | `1px --color-border` | Clickable card |

**Flat-by-default rule:** Cards have no shadow at rest. Shadow appears only on hover or deliberate elevation. See `design-principles.md` Rule 7.

### Anatomy

```
┌─────────────────────────────────────┐
│  Card Header                        │
│    Title                            │
│    Description                      │
├─────────────────────────────────────┤
│  Card Content                       │
│    Main content area                │
│                                     │
├─────────────────────────────────────┤
│  Card Footer                        │
│    Actions                          │
└─────────────────────────────────────┘
```

### Spacing

| Area | Padding |
|------|---------|
| header | 24px 24px 0 |
| content | 24px |
| footer | 0 24px 24px |
| gap between sections | 16px |

**Never nest cards.** Nested cards are an absolute antipattern. Use a list, section divider, or table instead.

---

## Badge / Tag

### Variants

| Variant | Background | Text |
|---------|------------|------|
| `default` | `--color-ink` | white |
| `secondary` | `--color-mist` | `--color-ink` |
| `outline` | transparent | `--color-ink` |
| `success` | `oklch(55% 0.18 145 / 0.15)` | `oklch(40% 0.18 145)` |
| `warning` | `oklch(72% 0.17 60 / 0.15)` | `oklch(52% 0.17 60)` |
| `destructive` | `oklch(55% 0.22 27 / 0.15)` | `oklch(40% 0.22 27)` |

### Sizes

| Size | Padding | Font size | Height |
|------|---------|-----------|--------|
| `sm` | 2px 6px | 11px | 18px |
| `default` | 4px 8px | 12px | 22px |
| `lg` | 4px 10px | 13px | 26px |

**Typography rule:** Badge labels are uppercase, tracked (`letter-spacing: 0.06em`), max 3 words.

---

## Alert / Callout

### Variants

| Variant | Icon | Background | Border |
|---------|------|------------|--------|
| `info` | ⓘ | `oklch(92% 0 0)` | `oklch(80% 0 0)` |
| `success` | ✓ | `oklch(55% 0.18 145 / 0.08)` | `oklch(55% 0.18 145 / 0.3)` |
| `warning` | ⚠ | `oklch(72% 0.17 60 / 0.08)` | `oklch(72% 0.17 60 / 0.3)` |
| `destructive` | ✕ | `oklch(55% 0.22 27 / 0.08)` | `oklch(55% 0.22 27 / 0.3)` |

### Anatomy

```
┌─────────────────────────────────────┐
│  [icon]  Title                  [×] │
│          Supporting description     │
└─────────────────────────────────────┘
```

**Side-tab rule:** Never use a colored `border-left` stripe on callouts. Use full border + background tint instead. See `antipatterns-catalog.md` (`side-tab`).

---

## Dialog / Modal

### Sizes

| Size | Max-width | Use case |
|------|-----------|----------|
| `sm` | 384px | Simple confirmations |
| `default` | 512px | Standard dialogs |
| `lg` | 640px | Forms, complex content |
| `xl` | 768px | Data-heavy dialogs |
| `full` | 100vw − 32px | Full-screen on mobile |

### Anatomy

```
┌─────────────────────────────────────────┐
│  Dialog Header                       [×]│
│    Title                                │
│    Description (optional)               │
├─────────────────────────────────────────┤
│  Dialog Content                         │
│    Scrollable area                      │
│                                         │
├─────────────────────────────────────────┤
│  Dialog Footer                          │
│                        [Cancel] [Action]│
└─────────────────────────────────────────┘
```

**Rules:**
- Always provide a close affordance (✕ button + ESC key)
- Confirm before closing a dialog with unsaved changes
- Don't use dialogs for primary navigation flows
- Destructive confirm dialogs: action button uses destructive variant and is placed right; Cancel is left

---

## Table

### Row States

| State | Background |
|-------|------------|
| default | `--color-surface` |
| hover | `--color-paper` |
| selected | `oklch(60% 0.25 350 / 0.08)` |
| striped (alt) | `--color-paper` / `--color-surface` |

### Cell Alignment

| Content type | Alignment |
|--------------|-----------|
| Text | Left |
| Numbers / currency | Right |
| Status / badges | Center |
| Actions | Right |

### Spacing

| Element | Value |
|---------|-------|
| Cell padding | 12px 16px |
| Header padding | 12px 16px |
| Row height (compact) | 40px |
| Row height (default) | 48px |
| Row height (comfortable) | 56px |

**Accessibility:** Column headers use `scope="col"`. Sortable columns use `aria-sort="ascending|descending|none"`. Interactive rows have `role="button"` or are wrapped in `<a>`.
