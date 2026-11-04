# Extract `orgrt` into `@monoes/orgrt` — feasibility analysis

Status: analysis only. Verdict: **the cut is not clean; no code was moved.**
Snapshot: `packages/@monomind/cli/src/orgrt` = 344 `.ts` files (+2 `.py` aider shims), ~69k lines.

## 1. Import graph

### orgrt -> rest of cli/src (outbound; would become package-to-cli imports)
About 20 distinct modules, ~45 import sites:

| cli module | used by (orgrt) | nature |
|---|---|---|
| `utils/resource-governor`, `utils/json-file` | 6 / 5 sites | pure leaf (no imports) |
| `utils/optional-deps`, `optional-deps-verify` | 5 / 1 | **cycle**: optional-deps imports `orgrt/sandbox-stubs-ledger` |
| `latest-models`, `model-guard` | 6 / 5 | small leaf pair (latest-models -> model-guard only) |
| `types` (`OrgDef`/`BusEvent`/`ORG_DIR`, `CommandOption`) | ~17 (documents/*) | type-heavy, near-leaf |
| `catalog/{blueprints,snapshot,digest,types}` | 4+3 | **cycle**: catalog/{snapshot,scan,stage,frontmatter} import `orgrt/skill-library`, `orgrt/fence`, `orgrt/skill-import` |
| `mesh/{hub,managed-presence,session-files}` | 3 (role-mesh) | **cycle**: mesh/hub, hub-main import `orgrt/daemon-lock` |
| `decision/{picks,jev,catalogs}` | 3 | decision/picks, catalogs import orgrt (cycle) |
| `pricing/model-pricing`, `memory/memory-kg` (type), `services/config-file-manager` | 1 each | memory/ is being refactored by another agent |

### rest of cli -> orgrt (inbound)
- 76 non-test source files: ~58 `commands/org-*.ts`, `agent-*`, `doctor-*`, `config-basic`; `catalog/*`, `mesh/hub*`, `decision/*`, `mcp-tools/{org-skill-tools,terminal-tools-core}`, `init/*`, `utils/paths`, `protocol-capabilities`, `latest-models`, `pricing`; plus ~25 plain `src/ui/*.mjs` (e.g. `ui/server.mjs` imports `../orgrt/run-liveness.js`), which resolve against `dist/src/orgrt/*`.
- 463 test files reference orgrt (`__tests__/**`, `src/__tests__`, `__tests__/setup/*.setup.ts`).
- 122 distinct deep module paths (`orgrt/x.js`) are imported from outside; there is no public barrel (`orgrt/index.ts` does not exist).
- Non-TS references: `scripts/check-doc-refs.mjs`, `claude-sdk-maintenance.mjs`, `sections-hardening-mutation(s).mjs`, `.github/workflows/claude-sdk-refresh.yml` (hard-coded `src/orgrt/claude-sdk.ts`), cli `build` script copies `src/orgrt/aider/*.py` to `dist/src/orgrt/aider`.

## 2. Why it is not clean
Four real cycles (orgrt<->catalog, orgrt<->mesh, orgrt<->decision, orgrt<->utils/optional-deps) plus ~20 cli modules outbound. A separate package forbids cycles, so catalog, mesh daemon-lock, decision and the shared types must move first. `catalog/*` and `decision/*` consumers are themselves commands, and `skill-import.ts` / `org-sign-review.ts` are concurrently edited by the security-policy agent (guaranteed conflicts if moved now). `types.ts` and `memory-kg` are also in other agents' scope.

## 3. Proposed direction
`@monoes/monomindcli` -> `@monoes/orgrt` -> `@monoes/org-core` (tiny leaf package).
`@monoes/org-core` (move first, in this order, each as its own green commit):
1. `utils/json-file`, `utils/resource-governor`, `model-guard`, `latest-models`, `pricing/model-pricing`.
2. `types.ts` (OrgDef etc.) split into org types vs CLI command types (`CommandOption` stays in cli).
3. Break cycles by moving the *orgrt side* of each pair down: `skill-library` (parseFrontmatter, skillRoots), `fence`, `skill-import` helpers, `daemon-lock`, `sandbox-stubs-ledger` into org-core, or move `catalog/*` (+`blueprints`) wholesale into orgrt and have `commands/catalog.ts` import it.
4. `mesh/{managed-presence,session-files,hub}` pieces used by role-mesh: move into org-core or inject via a parameter (`role-mesh` takes `meshDir` as an argument).
5. Add `orgrt/index.ts` barrel for the ~122 externally used symbols (watch eager load cost: commands load lazily today; use subpath exports `@monoes/orgrt/*` instead of one barrel).

## 4. Publish implications
- New names `@monoes/orgrt` (+ `@monoes/org-core`), `packages/@monoes/*` is already in `pnpm-workspace.yaml`, so no workspace edit; `pnpm-lock.yaml` changes and must be committed.
- Version policy: independent versions like `@monomind/memory` (2.24.1) vs cli (2.29.1); add both to `scripts/check-publish-versions.mjs` and `pnpm run check:versions`; cli must depend on an exact/`workspace:` range that gets rewritten at publish.
- `exports` map with subpaths `./*` -> `dist/*.js` + types; `files: ["dist","!dist/**/__tests__/**"]`; ship `aider/*.py` via the same `copy-into` build step (moves from cli build script).
- `scripts/check-cli-pack.mjs` must be extended so the cli tarball is verified to resolve `@monoes/orgrt` (and the `.mjs` UI files switch from `../orgrt/x.js` to `@monoes/orgrt/x.js`).
- Tests: ~160 orgrt tests under `cli/__tests__/orgrt` and `src/__tests__` move with the package; vitest workspace and `__tests__/setup/*.setup.ts` paths need updating; doc-ref and workflow paths above need rewriting.
- Rollout: three npm publishes in dependency order (org-core, orgrt, cli).

## 5. Remaining work (recommended sequence, after security-policy and memory agents land)
Steps 3.1-3.4 above as independent green PRs (each removes one cycle); then create `@monoes/orgrt` with `git mv`, rewrite 76+25+463 import sites by codemod, update scripts/workflows, extend pack check. Estimate: 5-6 PRs.
