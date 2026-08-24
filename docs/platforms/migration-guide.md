# Platform migration guide

`monomind platforms setup` is a deprecation shim for one release cycle. It no longer installs SessionStart prompt injectors, global plugins, or oversized startup prompts.

Use `monomind platforms doctor --json` to inspect the evidence-gated state, then run `monomind platforms upgrade --all`. User-scope changes require `--scope user --yes`; project scope is the default.

Migration removes only Monomind-marked legacy blocks, named entries, and Monomind-owned activation scripts. User hooks and unrelated configuration are preserved. A timestamped backup is made before any file rewrite, and a stale mutation lock is reported rather than removed automatically.

If an existing Monomind installation enforced a blocking hook, its enforcement is retained. The upgrade reports that retained state once so the operator can deliberately opt out; it never silently downgrades enforcement to observe mode.

The aliases `claw` → `openclaw` and `kimicode` → `kimi` continue to work. Restart the relevant coding runtime after changing its configuration so it reloads hooks and MCP settings.

`--remove-legacy` is intentionally conservative: it removes verified files, never an entire shared skills root while another installed platform may use it.

## Release validation checklist

Before a release, run the full suite, build, lint, and `monomind platforms docs --check`; then validate one project-scoped adapter in an isolated `HOME` with `monomind platforms doctor --json`. Windows rendering is covered by parameterized tests. macOS runtime validation and live Hermes, Antigravity, and Droid CLI checks are manual release checks when those binaries are available; no adapter is promoted to native solely from Monomind fixtures.
