# Component System

Build production-quality component libraries with consistent visual language, design tokens, developer-ready CSS, and proper accessibility.

## Token-First Approach

Every component is built on semantic tokens. Never hard-code values — always reference the token system. Use the OKLCH token system from `tokens.css` as the foundation; extend it with semantic aliases per project.

```css
:root {
  /* Semantic aliases (project-specific — map to OKLCH tokens) */
  --bg-primary: var(--color-cream);
  --bg-elevated: var(--color-paper);
  --text-primary: var(--color-ink);
  --text-secondary: var(--color-charcoal);
  --text-muted: var(--color-ash);
  --border-subtle: var(--color-mist);
  --interactive: var(--color-accent);
  --interactive-hover: var(--color-accent-hover);
}

[data-theme="dark"] {
  --bg-primary: oklch(10% 0.002 350);
  --bg-elevated: oklch(15% 0.003 350);
  --text-primary: oklch(94% 0 0);
  --text-secondary: oklch(75% 0 0);
  --text-muted: oklch(55% 0 0);
  --border-subtle: oklch(22% 0 0);
}
```

## Theme System

Every new project gets light/dark/system toggle. Never default to one without a scene sentence that forces the answer (see shared design laws).

```html
<!-- Theme toggle — place in header navigation -->
<div class="theme-toggle" role="radiogroup" aria-label="Color theme">
  <button class="theme-toggle-option" data-theme="light" aria-checked="false">Light</button>
  <button class="theme-toggle-option" data-theme="dark" aria-checked="false">Dark</button>
  <button class="theme-toggle-option" data-theme="system" aria-checked="true">System</button>
</div>
```

```javascript
class ThemeManager {
  constructor() {
    this.current = localStorage.getItem('theme') || 'system';
    this.apply(this.current);
    document.querySelector('.theme-toggle')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.theme-toggle-option');
      if (btn) this.apply(btn.dataset.theme);
    });
  }

  apply(theme) {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
    }
    this.current = theme;
    document.querySelectorAll('.theme-toggle-option').forEach(btn =>
      btn.setAttribute('aria-checked', String(btn.dataset.theme === theme))
    );
  }
}
document.addEventListener('DOMContentLoaded', () => new ThemeManager());
```

## Core Components

### Button

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-body);
  font-weight: 500;
  text-decoration: none;
  border: none;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
  user-select: none;

  &:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    pointer-events: none;
  }
}

/* Sizes */
.btn--sm  { padding: var(--space-2) var(--space-4); font-size: var(--font-size-sm); }
.btn--md  { padding: var(--space-3) var(--space-6); font-size: var(--font-size-base); }
.btn--lg  { padding: var(--space-4) var(--space-8); font-size: var(--font-size-lg); }

/* Primary — solid accent fill */
.btn--primary {
  background-color: var(--color-accent);
  color: var(--color-paper);
  border-radius: var(--radius-none); /* editorial: no rounding */

  &:hover:not(:disabled) {
    background-color: var(--color-accent-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }
}

/* Secondary — outlined */
.btn--secondary {
  background-color: transparent;
  color: var(--color-accent);
  border: 1.5px solid var(--color-accent);
  border-radius: var(--radius-none);

  &:hover:not(:disabled) {
    background-color: var(--color-accent-dim);
  }
}

/* Ghost — no border */
.btn--ghost {
  background-color: transparent;
  color: var(--text-secondary);

  &:hover:not(:disabled) {
    background-color: var(--color-mist);
    color: var(--text-primary);
  }
}
```

### Form Input

```css
.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.01em;
}

.form-input {
  padding: var(--space-3) var(--space-4);
  border: 1.5px solid var(--border-subtle);
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--font-size-base);
  font-family: var(--font-body);
  border-radius: var(--radius-sm);
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);

  &::placeholder { color: var(--text-muted); }

  &:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px var(--color-accent-dim);
  }

  &[aria-invalid="true"] {
    border-color: oklch(50% 0.2 25);
  }
}

.form-error {
  font-size: var(--font-size-sm);
  color: oklch(50% 0.2 25);
}
```

### Card

Cards are not the default layout answer — use them only when content requires clear grouping. Never nest cards.

```css
.card {
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: box-shadow var(--duration-base) var(--ease-out),
              transform var(--duration-base) var(--ease-out);

  &:where([href], [tabindex], [role="button"]):hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }
}

.card__media {
  aspect-ratio: 16 / 9;
  overflow: hidden;

  img { width: 100%; height: 100%; object-fit: cover; }
}

.card__body {
  padding: var(--space-6);
}

.card__title {
  font-size: var(--font-size-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}
```

### Navigation

```css
.nav {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-4) var(--space-8);
}

.nav__link {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  letter-spacing: 0.02em;
  position: relative;
  transition: color var(--duration-fast) var(--ease-out);

  &::after {
    content: '';
    position: absolute;
    left: 0; bottom: -2px;
    width: 100%; height: 1px;
    background-color: var(--color-accent);
    transform: scaleX(0);
    transform-origin: right;
    transition: transform var(--duration-base) var(--ease-out);
  }

  &:hover, &[aria-current="page"] {
    color: var(--text-primary);
  }

  &:hover::after, &[aria-current="page"]::after {
    transform: scaleX(1);
    transform-origin: left;
  }
}
```

## Responsive Layout System

Mobile-first. Grid collapses from desktop to tablet to mobile. Use CSS Grid for 2D layouts, Flexbox for 1D.

```css
.container {
  width: 100%;
  margin-inline: auto;
  padding-inline: var(--space-4);
}

@media (min-width: 640px)  { .container { max-width: 640px;  padding-inline: var(--space-6); } }
@media (min-width: 768px)  { .container { max-width: 768px;  } }
@media (min-width: 1024px) { .container { max-width: 1024px; padding-inline: var(--space-8); } }
@media (min-width: 1280px) { .container { max-width: 1280px; } }
@media (min-width: 1536px) { .container { max-width: 1400px; } }

/* Auto-responsive grid — no breakpoint classes needed */
.grid-auto {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: var(--space-6);
}

/* Explicit column grid */
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8); }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-6); }

@media (max-width: 768px) {
  .grid-2, .grid-3 { grid-template-columns: 1fr; }
}

/* Sidebar layout */
.layout-sidebar {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--space-12);
  align-items: start;
}

@media (max-width: 1024px) {
  .layout-sidebar { grid-template-columns: 1fr; }
}
```

## Accessibility Baseline

Required on every component:
- 4.5:1 contrast for body text; 3:1 for large text (≥24px or 18.5px bold)
- 44×44px minimum touch target
- Focus-visible on all interactive elements — never `outline: none` without replacement
- Keyboard navigation: tab order matches visual order
- All images have `alt` text; decorative images have `alt=""`
- Form inputs have associated `<label>` elements (not just placeholder text)
- Error messages use `aria-describedby`, not just color

## Component States Required

For every interactive component, define all states before shipping:

| State | Required behavior |
|---|---|
| Default | Base appearance |
| Hover | Visible feedback (not just cursor change) |
| Focus-visible | Distinct ring; keyboard users need this |
| Active | Pressed indication |
| Disabled | Reduced opacity + `cursor: not-allowed` |
| Loading | Spinner or skeleton; disable interaction |
| Error | Red border/icon + error message |
| Success | Confirmation feedback |
| Empty | Helpful empty state with action |

## File Structure

```
styles/
├── tokens.css          # Design tokens (OKLCH palette, spacing, motion)
├── reset.css           # Opinionated reset
├── typography.css      # Type hierarchy classes
├── layout.css          # Container, grid, section patterns
├── components.css      # All component styles
├── utilities.css       # Helper classes (.sr-only, .visually-hidden)
└── main.css            # Import orchestration

scripts/
├── theme-manager.js    # Light/dark/system toggle
└── main.js             # App init
```
