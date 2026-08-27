# Component States

Interactive state system for all UI components: state definitions, priority, focus rings, disabled/loading/error patterns, and ARIA semantics.

---

## State Definitions

| State | Trigger | Visual change |
|-------|---------|---------------|
| `default` | None | Base appearance |
| `hover` | Mouse over | Slight color/background shift |
| `focus` | Tab or click | Focus ring (see below) |
| `active` | Mouse/touch down | Darkest color state |
| `disabled` | `disabled` attribute | Reduced opacity, no interaction |
| `loading` | Async in progress | Spinner + reduced opacity, no interaction |
| `error` | Validation failure | Error color on border + ring |

### State Priority

When multiple states apply simultaneously, highest priority wins:

```
1. disabled  ← always wins
2. loading
3. active
4. focus
5. hover
6. default
```

---

## Standard Transition

Apply to all interactive elements:

```css
.interactive {
  transition-property: color, background-color, border-color, box-shadow, opacity;
  transition-duration: var(--duration-fast);   /* 150ms */
  transition-timing-function: var(--ease-out); /* cubic-bezier(0.16, 1, 0.3, 1) */
}
```

| Property | Duration | Easing |
|----------|----------|--------|
| Color changes | 150ms | `var(--ease-out)` |
| Background | 150ms | `var(--ease-out)` |
| Transform | 200ms | `var(--ease-out)` |
| Opacity | 150ms | `var(--ease-out)` |
| Shadow | 200ms | `var(--ease-out)` |

**Never** use `transition: all` — it catches layout properties and causes jank.

---

## Focus Ring

Use `focus-visible` (not `focus`) to avoid showing rings on mouse click.

```css
.focusable:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px var(--color-bg),          /* offset — matches page background */
    0 0 0 4px var(--color-accent-veil); /* ring — Magenta Veil */
}
```

| Property | Value |
|----------|-------|
| Ring width | 2px |
| Ring offset | 2px (matches page background) |
| Ring color | `var(--color-accent-veil)` — `oklch(60% 0.25 350 / 0.25)` |

For inputs, the container gets the focus ring on `:focus-within`:

```css
.input-wrapper:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-dim);
}
```

**Never use `outline: none` without a visible replacement.** This breaks keyboard navigation and fails accessibility requirements.

---

## Disabled State

```css
.disabled,
[disabled],
[aria-disabled="true"] {
  opacity: 0.5;
  pointer-events: none;
  cursor: not-allowed;
}
```

| Property | Value |
|----------|-------|
| Opacity | 0.5 (0.38 minimum for WCAG 3:1) |
| Pointer events | none |
| Cursor | not-allowed |

**ARIA:**
```html
<!-- Form controls: use disabled attribute -->
<button disabled>Submit</button>
<input disabled type="text">

<!-- Non-form interactive elements: use aria-disabled -->
<div role="button" aria-disabled="true" tabindex="-1">Action</div>
```

---

## Loading State

```css
.loading {
  position: relative;
  pointer-events: none;
  opacity: 0.7;
}
```

### Spinner placement by component

| Component | Spinner position |
|-----------|-----------------|
| Button | Replaces leading icon, or center of icon-only button |
| Input | Trailing position |
| Card | Center overlay with translucent scrim |
| Page section | Center of section |
| Full page | Center of viewport |

**ARIA:**
```html
<button aria-busy="true" aria-describedby="loading-msg" disabled>
  <span aria-hidden="true"><!-- spinner SVG --></span>
  <span id="loading-msg" class="sr-only">Saving...</span>
</button>
```

**Rule:** Always disable the trigger element during loading. Never allow double-submit.

---

## Error State

```css
.field-error .input {
  border-color: var(--color-error);           /* oklch(55% 0.22 27) */
}

.field-error .input:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-bg),
    0 0 0 4px oklch(55% 0.22 27 / 0.25);
}

.error-message {
  color: var(--color-error);
  font-size: var(--font-size-sm);
  margin-top: 4px;
}
```

| Element | Treatment |
|---------|-----------|
| Input border | `var(--color-error)` |
| Input focus ring | `oklch(55% 0.22 27 / 0.25)` |
| Error message text | `var(--color-error)` |
| Error icon | `var(--color-error)` |

**Rules:**
- Position error message directly below the field (not at page top)
- Clear error on valid input (validate on blur, not on keystroke)
- Auto-focus the first invalid field after a failed submit
- Use `role="alert"` or `aria-live="polite"` on the error message

**ARIA:**
```html
<div class="field" role="group">
  <label for="email">Email</label>
  <input
    id="email"
    type="email"
    aria-invalid="true"
    aria-describedby="email-error"
  >
  <span id="email-error" role="alert" class="error-message">
    Enter a valid email address.
  </span>
</div>
```

---

## Color Variants — CSS Pattern

Use CSS custom properties scoped to the component for variant colors. Never hard-code variant colors directly on the element:

```css
/* Pattern */
.btn {
  --btn-bg: var(--color-ink);
  --btn-fg: var(--color-surface);
  background: var(--btn-bg);
  color: var(--btn-fg);
}

.btn.secondary {
  --btn-bg: var(--color-mist);
  --btn-fg: var(--color-ink);
}

.btn.destructive {
  --btn-bg: var(--color-error);
  --btn-fg: white;
}
```

This pattern means dark mode only needs to override semantic tokens — component variant CSS stays unchanged.

---

## Size Variants — CSS Pattern

```css
/* Pattern */
.btn {
  --btn-height: 40px;
  --btn-px: var(--space-2);   /* 16px */
  --btn-font: var(--font-size-sm);
  height: var(--btn-height);
  padding-inline: var(--btn-px);
  font-size: var(--btn-font);
}

.btn.sm {
  --btn-height: 32px;
  --btn-px: 12px;
  --btn-font: var(--font-size-xs);
}

.btn.lg {
  --btn-height: 48px;
  --btn-px: var(--space-3);   /* 24px */
  --btn-font: var(--font-size-base);
}
```

---

## ARIA State Reference

Quick reference for the most commonly missed ARIA attributes:

| Situation | Attribute | Example |
|-----------|-----------|---------|
| Currently selected (tabs, nav) | `aria-selected="true"` | `<button role="tab" aria-selected="true">` |
| Expanded/collapsed | `aria-expanded="true/false"` | `<button aria-expanded="false" aria-controls="menu">` |
| Loading | `aria-busy="true"` | `<button aria-busy="true">` |
| Disabled (non-form) | `aria-disabled="true"` | `<div role="button" aria-disabled="true">` |
| Invalid input | `aria-invalid="true"` | `<input aria-invalid="true">` |
| Error description | `aria-describedby` | `<input aria-describedby="field-error">` |
| Live region | `aria-live="polite"` | `<div aria-live="polite">` (for toasts, status) |
| Alert / urgent | `role="alert"` | `<span role="alert">Error message</span>` |
| Sorted column | `aria-sort` | `<th aria-sort="ascending">Name</th>` |
| Controls another element | `aria-controls` | `<button aria-controls="dropdown-menu">` |
