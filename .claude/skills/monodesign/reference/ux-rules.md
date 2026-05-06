# UX Rules — Implementation-Level Guidance

170+ rules across 10 categories, ordered by priority. Use during `audit`, `critique`, and `review` workflows to catch implementation-level issues that antipattern detection misses.

---

## Priority 1: Accessibility (CRITICAL)

| ID | Rule | Check |
|----|------|-------|
| `color-contrast` | Minimum 4.5:1 for normal text; 3:1 for large text (18px+ or 14px+ bold) | WCAG AA |
| `focus-states` | Visible focus rings on all interactive elements (2–4px outline) | Never remove outlines |
| `alt-text` | Descriptive alt text for all meaningful images; `alt=""` for decorative | |
| `aria-labels` | aria-label for icon-only buttons; all interactive elements labeled | |
| `keyboard-nav` | Tab order matches visual order; all actions reachable without a mouse | |
| `form-labels` | `<label for="">` wired to every input; no placeholder-as-label | |
| `skip-links` | "Skip to main content" link for keyboard users | |
| `heading-hierarchy` | Sequential h1→h2→h3, no level skips | |
| `color-not-only` | Never convey information by color alone — add icon or text | |
| `dynamic-type` | Support system text scaling; no truncation as text grows | |
| `reduced-motion` | `@media (prefers-reduced-motion: reduce)` wraps all animations | Non-negotiable |
| `escape-routes` | Cancel/back affordance in all modals and multi-step flows | |
| `keyboard-shortcuts` | Preserve system accessibility shortcuts | |

---

## Priority 2: Touch & Interaction (CRITICAL)

| ID | Rule | Check |
|----|------|-------|
| `touch-target-size` | Min 44×44pt interactive area; expand hit area beyond visual bounds if needed | |
| `touch-spacing` | Minimum 8px gap between adjacent touch targets | |
| `hover-vs-tap` | Primary interactions are click/tap; hover is enhancement only | |
| `loading-buttons` | Disable button during async operations; show spinner or progress | |
| `error-feedback` | Clear error messages near the problem element | |
| `cursor-pointer` | `cursor: pointer` on all clickable elements | Web |
| `tap-delay` | `touch-action: manipulation` to remove 300ms delay | Web |
| `press-feedback` | Visual feedback on press (opacity, scale, ripple) within 80–150ms | |
| `drag-threshold` | Movement threshold before starting drag to avoid accidental drags | |

---

## Priority 3: Performance (HIGH)

| ID | Rule | Check |
|----|------|-------|
| `image-optimization` | WebP/AVIF, responsive `srcset`/`sizes`, lazy load non-critical | |
| `image-dimension` | Declare `width`/`height` or `aspect-ratio` to prevent CLS | Core Web Vitals |
| `font-loading` | `font-display: swap` or `optional`; preload critical fonts only | |
| `critical-css` | Above-the-fold CSS loads first (inline critical or early stylesheet) | |
| `bundle-splitting` | Split code by route/feature (React Suspense, dynamic import) | |
| `reduce-reflows` | Batch DOM reads then writes; no layout thrashing | |
| `content-jumping` | Reserve space for async content (skeleton screens, aspect-ratio boxes) | |
| `virtualize-lists` | Virtualize lists of 50+ items | |
| `debounce-throttle` | Debounce/throttle for scroll, resize, and input events | |
| `progressive-loading` | Skeleton/shimmer for operations >1s; never a blocking spinner | |

---

## Priority 4: Style Selection (HIGH)

| ID | Rule | Check |
|----|------|-------|
| `consistency` | One visual style across all pages; no mid-product style drift | |
| `no-emoji-icons` | SVG icons only (Heroicons, Lucide, Phosphor); never emojis as icons | |
| `effects-match-style` | Shadows, blur, radius aligned with chosen style | |
| `state-clarity` | Hover/pressed/disabled states are visually distinct | |
| `elevation-consistent` | Consistent shadow scale for cards, sheets, modals | |
| `icon-style-consistent` | One icon set; consistent stroke weight and corner radius | |
| `primary-action` | One primary CTA per screen; secondary actions visually subordinate | |
| `blur-purpose` | Blur indicates background dismissal (modals, sheets); never decorative | |

---

## Priority 5: Layout & Responsive (HIGH)

| ID | Rule | Check |
|----|------|-------|
| `viewport-meta` | `width=device-width, initial-scale=1`; never disable zoom | |
| `mobile-first` | Design mobile-first; scale up to tablet and desktop | |
| `breakpoint-consistency` | Systematic breakpoints: 375 / 768 / 1024 / 1440 | |
| `readable-font-size` | Min 16px body on mobile (avoids iOS auto-zoom) | |
| `line-length-control` | Mobile 35–60 chars; desktop 60–75 chars | |
| `horizontal-scroll` | No horizontal scroll on mobile | |
| `spacing-scale` | 4pt/8dp incremental spacing system | |
| `container-width` | Consistent max-width on desktop (max-w-6xl / 7xl) | |
| `z-index-management` | Defined layered z-index scale (0 / 10 / 20 / 40 / 100 / 1000) | |
| `fixed-element-offset` | Fixed navbar/bottom bar reserves safe padding for underlying content | |
| `viewport-units` | Prefer `min-h-dvh` over `100vh` | |
| `visual-hierarchy` | Hierarchy via size, spacing, contrast — not color alone | |

---

## Priority 6: Typography & Color (MEDIUM)

| ID | Rule | Check |
|----|------|-------|
| `line-height` | `1.5`–`1.75` for body text (`1.6` is the Editorial Sanctuary target) | |
| `line-length` | `max-width: 65ch` on paragraph containers | |
| `font-pairing` | Heading and body fonts have distinct personalities | |
| `font-scale` | Consistent type scale (12 / 14 / 16 / 18 / 24 / 32) | |
| `weight-hierarchy` | Bold headings (600–700), regular body (400), medium labels (500) | |
| `color-semantic` | Semantic color tokens (primary, secondary, error, surface); no raw hex in components | |
| `color-dark-mode` | Dark mode uses desaturated/lighter tonal variants; test contrast independently | |
| `color-accessible-pairs` | All foreground/background pairs meet 4.5:1 (AA) or 7:1 (AAA) | |
| `color-not-decorative-only` | Functional colors (error, success) also use icon or text — no color-only meaning | |
| `letter-spacing` | Avoid tight tracking on body text; track only micro-labels, buttons, uppercase | |
| `number-tabular` | Tabular/monospaced figures for data columns, prices, timers | |

---

## Priority 7: Animation (MEDIUM)

| ID | Rule | Check |
|----|------|-------|
| `duration-timing` | 150–300ms for micro-interactions; complex transitions ≤400ms | |
| `transform-performance` | Animate `transform` and `opacity` only; never width/height/top/left | |
| `easing` | `ease-out` for entering; `ease-in` for exiting; never linear for UI | |
| `motion-meaning` | Every animation expresses cause-effect; no purely decorative motion | |
| `spring-physics` | Prefer spring/physics curves over cubic-bezier for natural feel | |
| `exit-faster` | Exit animations 60–70% of enter duration — feels responsive | |
| `stagger-sequence` | Stagger list/grid entrances 30–50ms per item | |
| `interruptible` | Animations are interruptible; user action cancels in-progress animation | |
| `no-blocking-animation` | UI stays interactive during animations; never block input | |
| `scale-feedback` | Subtle scale (0.95–1.05) on press for tappable cards/buttons | |
| `layout-shift-avoid` | Animations must not trigger reflow or CLS | |
| `loading-states` | Skeleton or progress indicator when loading exceeds 300ms | |
| `excessive-motion` | Animate 1–2 key elements per view max | |

---

## Priority 8: Forms & Feedback (MEDIUM)

| ID | Rule | Check |
|----|------|-------|
| `input-labels` | Visible label per input — no placeholder-as-label | |
| `error-placement` | Error message below the related field | |
| `submit-feedback` | Loading → then success/error state on submit | |
| `required-indicators` | Required fields marked (asterisk + sr-only explanation) | |
| `empty-states` | Helpful message and action when no content | |
| `toast-dismiss` | Auto-dismiss toasts in 3–5s | |
| `confirmation-dialogs` | Confirm before all destructive actions | |
| `disabled-states` | Disabled: reduced opacity (0.38–0.5) + cursor change + semantic attribute | |
| `progressive-disclosure` | Reveal complex options progressively; don't overwhelm upfront | |
| `inline-validation` | Validate on blur, not on keystroke; show error only after user finishes | |
| `password-toggle` | Show/hide toggle for password fields | |
| `error-clarity` | Error messages state cause + how to fix (not just "Invalid input") | |
| `focus-management` | After submit error, auto-focus the first invalid field | |
| `error-summary` | Multiple errors get a summary at top with anchor links to each field | |
| `toast-accessibility` | Toasts use `aria-live="polite"` — never steal focus | |
| `undo-support` | Allow undo for destructive or bulk actions | |
| `multi-step-progress` | Multi-step flows show step indicator; allow back navigation | |
| `timeout-feedback` | Request timeout shows clear feedback with retry option | |

---

## Priority 9: Navigation Patterns (HIGH)

| ID | Rule | Check |
|----|------|-------|
| `back-behavior` | Back navigation is predictable and consistent; preserves scroll/state | |
| `deep-linking` | All key screens reachable via URL for sharing | |
| `nav-label-icon` | Navigation items have both icon and text label | |
| `nav-state-active` | Current location visually highlighted (color, weight, or indicator) | |
| `nav-hierarchy` | Primary nav vs secondary nav are clearly separated | |
| `modal-escape` | Modals/dialogs have a clear close affordance | |
| `search-accessible` | Search easily reachable from top bar or primary nav | |
| `breadcrumb-web` | Breadcrumbs for 3+ level deep hierarchies | Web |
| `state-preservation` | Back restores previous scroll position, filter state, and input | |
| `overflow-menu` | When actions exceed space, use overflow/more menu instead of cramming | |
| `navigation-consistency` | Navigation placement same across all pages | |
| `modal-vs-navigation` | Modals are not used for primary navigation flows | |
| `focus-on-route-change` | After page transition, move focus to main content for screen readers | |
| `destructive-nav-separation` | Dangerous actions (delete, logout) spatially separated from normal nav | |

---

## Priority 10: Charts & Data (LOW)

| ID | Rule | Check |
|----|------|-------|
| `chart-type` | Match chart to data: trend → line, comparison → bar, proportion → pie/donut | |
| `color-guidance` | Accessible color palettes; no red/green-only pairs (colorblind) | |
| `data-table` | Table alternative for screen readers; charts alone are not accessible | |
| `legend-visible` | Always show legend; position near the chart | |
| `tooltip-on-interact` | Tooltips on hover/focus showing exact values | |
| `axis-labels` | Label axes with units; avoid truncated labels | |
| `responsive-chart` | Charts reflow or simplify on small screens | |
| `empty-data-state` | Meaningful empty state when no data | |
| `no-pie-overuse` | No pie/donut for >5 categories; use bar chart | |
| `gridline-subtle` | Grid lines are low-contrast (e.g. gray-200); don't compete with data | |
| `focusable-elements` | Interactive chart elements are keyboard-navigable | |
| `screen-reader-summary` | Text summary or aria-label describing chart's key insight | |
| `tooltip-keyboard` | Tooltip content keyboard-reachable; not hover-only | |
| `sortable-table` | Data tables support sorting with `aria-sort` | |
| `animation-optional` | Chart entrance animations respect `prefers-reduced-motion` | |

---

## Quick Decision: When to use this reference

| You're doing | Jump to |
|---|---|
| Accessibility review | Priority 1 |
| Mobile/touch audit | Priority 2 |
| Performance audit | Priority 3 |
| Animation review | Priority 7 |
| Form UX | Priority 8 |
| Navigation review | Priority 9 |
| Data visualization | Priority 10 |
| Full pre-ship review | Use `pre-delivery-checklist.md` |
