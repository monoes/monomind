---
name: monodesign-ui-quality
description: "Use when building, restyling or reviewing web UI with monomind's monodesign tools: detect HTML/CSS anti-patterns, apply fixes and pick an OKLCH palette. Tool workflow for detect, fix dry-run and palette; not general design critique."
tags: ["design","frontend","monomind","ui"]
tools: ["monodesign_detect","monodesign_fix","monodesign_palette"]
license: Apache-2.0
source: https://github.com/monoes/monomind
---
# Monodesign UI quality

Your monodesign tools arrive prefixed with the provider name (for example
`monomind__monodesign_detect`). They are deterministic and cheap — run them on
every UI change, not only at the end.

## Tools

- `monodesign_detect` — scan a file or directory (`target`) or inline
  `content` for design anti-patterns. Returns rule ids with locations.
- `monodesign_fix` — codemod for detected issues. **Always run with
  `dry_run: true` first**, read the diff, then `dry_run: false` to write.
  Narrow with `rules` (comma-separated rule ids) when only some fixes are wanted.
- `monodesign_palette` — pick a brand seed colour (OKLCH) with a mood and a
  composition strategy. Use `from: "<product name>"` for a stable choice, or
  `id` for a specific seed.

## Workflow

1. **New UI or rebrand:** `monodesign_palette` once, record the seed id in your
   handoff so later work reuses the same palette instead of inventing another.
2. **After writing or changing markup/CSS:** `monodesign_detect` on the files
   you touched.
3. **Fix:** `monodesign_fix` dry run → review → apply. Anything the codemod
   can't fix, fix by hand and re-run detect until clean.
4. **Handoff:** report remaining findings you chose to keep and why (a brand
   requirement, say) so the reviewer doesn't re-flag them.

Detect does not replace looking at the result: when a browser or screenshot
tool is available, check the rendered page too.
