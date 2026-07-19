---
name: monodesign-layout
description: Fix the structure, not the surface — diagnose a layout's actual problem (monotone spacing, weak hierarchy, identical card grids) and restructure spacing, grids, and composition for the project's register.
type: design-sub-command
argument-hint: "[target file, route, or component]"
user-invocable: true
---

# Monodesign: Layout

Space is the most underused design tool. Find the layout's actual problem and fix the structure, not the surface. Read `reference/layout.md` from the monodesign skill directory for the full protocol.

## Register-aware structure

- **Brand**: asymmetric compositions, fluid spacing with `clamp()`, intentional grid-breaking for emphasis. Rhythm through contrast — tight groupings paired with generous separations.
- **Product**: predictable grids, consistent densities, familiar navigation patterns. Responsive behavior is structural (collapse sidebar, responsive table), not fluid typography. Consistency IS an affordance.
- **Native** (`ios` / `android` / `adaptive`): follow the Layout section of `reference/ios.md` / `reference/android.md` — platform navigation, insets, and touch targets, never web CSS tooling.

## Two isolated assessments (required)

Spawn two parallel sub-agents (isolation is the point — neither sees the other's output):

1. **Layout assessment**: works through the full "Assess Current Layout" checklist from the reference, returning per-item findings that cite file, selector, or value.
2. **Mechanical pre-scan**: runs the bundled detector scoped to layout:

   ```bash
   node {{scripts_path}}/detect.mjs --json --scope layout [target files or dirs]
   ```

   When the project documents a spacing scale, also grep arbitrary Tailwind spacing (`gap-[`, `p-[`, `m-[`, `z-[`) and judge those hits against it.

If no sub-agent tool is available, run both yourself — assessment first, pre-scan second, so deterministic findings can't anchor the visual judgment.

## Then

Synthesize both assessments, propose the structural fix (spacing rhythm, grid restructure, hierarchy weight), apply it, and re-run the detector to confirm the layout-scope findings are resolved.
