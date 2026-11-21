# Monodesign

> Design intelligence for agents: anti-pattern detection, deterministic auto-fix, and a curated OKLCH palette library. Available as MCP tools on every platform (Claude Code, Kimi Code, Antigravity, opencode) and as CLI commands.

## MCP tools

| Tool | What it does |
|---|---|
| `monodesign_palette` | Pick an OKLCH brand seed from the 129-seed curated library — anchor color, mood, and composition strategy. Deterministic with `from: "<product-name>"`, specific with `id: "seed-021"`. |
| `monodesign_detect` | Detect design anti-patterns (overused fonts, tiny text, gradient text, glow, layout issues) in HTML/CSS. Runs **in-process** — no subprocess. Pass `target` (file/dir) or inline `content`. |
| `monodesign_fix` | Auto-fix anti-patterns with the bundled deterministic codemod. **Defaults to `dry_run: true`** (preview diffs); set `dry_run: false` to write. Optional `rules` filter. |

## CLI equivalents

```bash
monomind design detect -t ./src          # scan for anti-patterns
monomind design fix -t ./src --dry-run   # preview fixes
monomind design palette --from "my-app"  # deterministic brand seed
```

The MCP tools and CLI share the same engine (`@monoes/monodesign`). The MCP `monodesign_detect` runs in-process via the engine's `detectHtml` for HTML files/dirs/inline content (so cascade-dependent findings like low contrast and computed sizes are caught) and `detectText`/`walkDir` for everything else. `monomind design detect` and both `fix` paths spawn the bundled monodesign CLI; the MCP `monodesign_fix` is bounded at 2 minutes.

## Notes

- The palette library is 129 hand-curated OKLCH seeds with inverse-hue-frequency weighting, so every hue zone is roughly equally likely. `--from` hashes the key (sha256) for a stable pick.
- Detection honors inline `monodesign-disable*` waivers in the scanned files.
- There is intentionally **no hex output** in palette results — compose from `oklch()` at runtime if needed.
- Portions of monodesign are based on Impeccable (Apache-2.0) by Paul Bakaus; see `packages/@monoes/monodesign/NOTICE.md`.
