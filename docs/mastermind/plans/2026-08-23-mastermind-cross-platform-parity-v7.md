# Mastermind Cross-Platform Parity Implementation Plan (v7 — restored scope-and-verification revision)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `Skill("mastermind-taskdev")` (recommended) or `Skill("mastermind-execute")` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **v3 changes from v2** (produced by a six-agent swarm review on 2026-08-23 that hard-verified every claim against the repository and current platform documentation; all evidence cites are repo-accurate):
>
> **Executability fixes (v2's TDD loop could not run):**
> 1. **Every `pnpm --filter @monomind/cli` command fails.** The package's real name is `@monoes/monomindcli` (`packages/@monomind/cli/package.json:2`; live-run confirmed: "No projects matched the filters"). All 11 invocations across Tasks 1–9 now use `pnpm --filter @monoes/monomindcli`.
> 2. **`typecheck`/`lint` scripts do not exist** in the CLI package (scripts are only build/test/test:coverage/…), and root `pnpm test` runs only root `tests/**` — never the CLI suite — while bare `vitest` is watch-mode in a TTY. Verification gates now use commands that exist: package `test` + `run build` (tsc is the typecheck) + root `pnpm lint` + `CI=true pnpm test:all`.
> 3. **`monomind status --json` does not work today.** `status.ts:437` gates on `ctx.flags.format === 'json'`; `--json` sets an unrelated global flag and silently no-ops (`parser.ts:77-85`, `allowUnknownFlags`). The plan named it as the universal status fallback. Task 5 now fixes the flag alias *first*; until then the contract uses `monomind status --format json`.
> 4. **Task 1 silently broke `__tests__/commands/platforms.test.ts`** (asserts `SUPPORTED_PLATFORMS.length` toBe(14), line 11) and the build (`Platform` type union feeds `PLATFORM_CONFIG_FILES`). Task 1 now modifies that test and keeps the build green.
> 5. **Smoke tests asserted a nonexistent tool and an invisible tool.** `memory_search` is not a registered MCP tool (real: `knowledge_search`, `memory_kg_search`); `platforms_doctor` would be filtered out of `tools/list` by the core-roster (`CORE_TOOL_CATEGORIES`, `src/mcp-client.ts:121-135`) unless a `platforms` category is added. Task 9 now registers the category + tool before the smoke test, asserts real tool names, and uses the local-bin stdio pattern from `__tests__/mcp-stdio-integration.test.ts` instead of `npx -y monomind@latest` (which downloads the *published* package, not the working tree).
> 6. **Task 9/10 dependency inversion removed:** v2's Task 9 smoke asserted `platforms_doctor` while Task 10 implemented it. The MCP tool now lands inside Task 9 before its own smoke assertions.
>
> **Factual corrections (verified against current official docs, 2026-08-23):**
> 7. **Droid MCP is `.factory/mcp.json`**, not `.factory/settings.json` (docs.factory.ai/harness/mcp).
> 8. **Codex skills live in `.agents/skills` (repo) and `~/.agents/skills` (user)** per current official docs — not `.codex/skills`/`$CODEX_HOME/skills`. Codex native hooks are **confirmed real** (hooks.json or `[[hooks.<Event>]]` in config.toml, feature-flagged, trust-gated).
> 9. **Antigravity:** `~/.gemini/skills` is a **Gemini CLI** path, not Antigravity's. Antigravity 2.0 uses `~/.gemini/config/skills/`; the AGY CLI uses `~/.gemini/antigravity-cli/skills/`. The current code conflates the two products; Task 8 migrates.
> 10. **Zed:** skills are `.agents/skills` (not `.zed/skills`); agent profiles are `agent.profiles` in `settings.json` (`.zed/agents/*.toml` is legacy); instructions are AGENTS.md + first-match compat files; MCP is `context_servers` in settings.json. The monograph `.zed/*.md` writes are retired.
> 11. **Hermes identified:** Nous Research Hermes Agent. Skills `~/.hermes/skills/` + project `.hermes/skills`/`.agents/skills` (trust-gated via `hermes skills trust`), config `~/.hermes/config.yaml`, MCP supported, **no hooks** (automation is cron-based). The v2 "hooks where discovery confirms them" row is corrected to `unsupported`.
> 12. **Gemini CLI skills confirmed** (`.gemini/skills` + `.agents/skills` alias); Cursor `hooks.json` at `.cursor/hooks.json` confirmed; VS Code URL moved to `/docs/agent-customization/*`; Codex config docs moved to learn.chatgpt.com; `.agents/skills` + `~/.agents/skills` are now *officially documented* on 12 of the 16 targets (all but Claude, Kiro, Aider) and become the portable skill default where documented.
> 13. **Command count corrected:** 44 `.md` files ship in `.claude/commands/mastermind/` (42 user-facing; `_repeat.md`/`_taskfile.md` are internal). v2 said 49.
> 14. **Kimi AGENTS.md is unverified** in current docs; marked verify-before-M1-exit rather than asserted.
>
> **Architecture fixes:**
> 15. **Canonical skills canonicalize in place.** v2 created `assets/mastermind/skills/**` — but `package.json` `files` ships `.claude` (not `assets`), so the fallback launcher would ENOENT on every npm install, and 68 `mastermind-*` packages already ship via `.claude/skills/`. v3 keeps the shipped tree as the single source, adds the missing `mastermind` router package, and ports `references/` (6 files, hard-linked from `master.md`).
> 16. **Task 4's core-parity test contradicted the aider policy** ("no fake skills") by demanding a `SKILL.md` file from every platform. The assertion now mirrors the MCP row's `cli_fallback` escape hatch.
> 17. **Marker scheme supports multiple managed blocks per file.** Five-plus platforms write `AGENTS.md`/`.github/copilot-instructions.md`; v2's single fixed marker made `install --all` last-writer-wins and `uninstall --platform codex` delete siblings' blocks. Markers are now per-artifact-per-platform.
> 18. **JSON `named_entry` merges are tested** (add/replace-own/preserve-foreign/malformed-no-mutation/uninstall-own-key) — the riskiest mutation class had zero tests in v2. `.factory/settings.json`-style JSONC parsing specified.
> 19. **Neutral hook contract is decision-based**, not exit-code-based. v2's `HookResult { exitCode: 0 | 2 }` baked Claude semantics into the neutral layer (opencode blocks by throwing, not exit codes). Now `HookDecision { action, reason }` with per-platform mapping, `sessionId` retained, per-event timeout budgets (PostToolUse ≥ 10s preserved), per-platform timeout *units* rendered and tested (the repo currently has a 1000× unit disagreement: `timeout = 5` vs `timeout = 5000` in the same TOML schema), and one flag (`--enable-blocking-hooks`).
> 20. **Legacy migration inventory expanded from 3 fixtures to 14 surfaces** — v2 orphaned `.cursorrules`, `DROID.md`, `.agents/rules/monomind.md`, `.trae/rules/monomind.md`, `HERMES.md`, project-level `.cursor/settings.json` hooks, both `monomind-activate.cjs` scripts, `~/.gemini/antigravity-cli/plugins/monomind/`, both shared skill roots, bare-marker blocks everywhere, and a latent pre-existing bug: current code appends `<!-- -->` blocks **into `.aider.conf.yml`, corrupting the YAML**.
> 21. **Init contract defined.** v2's `selectedPlatforms` existed nowhere; init actually uses `--target {all,claude,antigravity,opencode,kimicode,codex}` (`init.ts:112`) + component booleans. v3 keeps `--target` semantics stable, adds `--platform <ids>` with a `kimicode`→`kimi` alias, and forbids `--target all` silently expanding 5→16.
> 22. **Unowned subsystems assigned:** statusline (5 platforms, 3 bridging into `.claude/helpers/statusline.cjs`, 2 doing user-scope writes during project init — violating v2's own constraint), `write-claude.ts` (writes global `~/.claude/CLAUDE.md` + a global SessionStart hook during project init — also violating), `claudemd-generator.ts`, `geminimd-generator.ts`, `settings-generator.ts`, `helpers-generator.ts`, `shared.ts` maps, `upgrade.ts`, opencode permission rules (new `permissions` capability), and a fourth platform inventory in `mcp-tools/monograph/build-tools.ts` that v2 missed.
> 23. **Versioning pinned to patch bumps** per repo policy (2.9.x lockstep, `scripts/check-publish-versions.mjs`): M1 = 2.9.26, M2 = 2.9.27; no minor/major anywhere.
> 24. **Windows coverage redefined as rendering-semantics unit tests** — CI's Windows runner deliberately excludes the cli package (node-gyp broken; documented in `tests.yml`), and there is no macOS runner. Live Windows execution is out of scope until node-gyp is solved.
> 25. **`platforms setup` gets a deprecation shim**, `update.ts`'s modification is specified (v2 listed it with zero stated change), doctor surfaces are de-duplicated (`platforms doctor` is the one CLI surface; top-level `doctor` gains a `platforms` component), and `mastermind run` is scoped to `--print`/`--list` (v2's "pipe to the configured agent CLI" had no config surface anywhere in the repo).

> **v4 execution-readiness corrections (2026-08-23):**
> 1. OpenClaw has no documented project-local `openclaw.json`; project-scope OpenClaw MCP is now `cli_fallback`. User-scope MCP is emitted only after explicit `--scope user --yes` consent, targeting `~/.openclaw/openclaw.json` (or a user-supplied `OPENCLAW_CONFIG_PATH`).
> 2. The core-location TypeScript union now includes YAML and requires a safe YAML named-entry merge; Hermes remains discovery-gated until that merge contract is proven.
> 3. `runPlatformsDoctor` is implemented in Task 8 before Task 9 exposes `platforms_doctor` over MCP. Task 10 is release validation, not the doctor implementation owner.
> 4. `.agents/skills` is now the authoritative portable project root for every documented compatible runtime. Platform-owned skill roots are explicit opt-in mirrors, never automatic duplicate installs.
> 5. The missing status-command test, an extra TypeScript brace, unnamed Task 0 notes, and absent worktree setup are corrected. Native support additionally requires an upstream parser/schema or environment-gated real-runtime contract—not Monomind fixture success alone.

> **v5 scope-and-verification corrections (2026-08-24):**
> 1. A capability is no longer confused with a location. `PlatformPaths` declares separate project and user locations for every artifact, and `resolveArtifactLocation()` selects one only for the requested scope. No user-scope path is inferred from a project path or exposed unredacted in doctor output.
> 2. The initial matrix is evidence-gated. A cell may report `native` only when the registry records `schema` or `runtime` upstream verification for that exact capability; otherwise it remains `experimental` or `cli_fallback`. Monomind fixtures prove our merger, not the third-party runtime.
> 3. Fallback-only and discovery-only instruction surfaces are not rendered as fake `AGENTS.md` artifacts. Hermes is fallback-only until discovery verifies an instruction surface; Antigravity instructions are discovery-gated. The core test follows each adapter's declared contract instead of asserting one instruction file for all sixteen platforms.
> 4. User-scope mutation is deliberate and recoverable: `install --scope user` requires `--yes`, stores backups in a private user backup root, and obtains a scope-specific lock. A stale lock is reported and never deleted automatically.
> 5. The doctor API always returns a list, while `--json` belongs to CLI presentation. The release test now uses the typed request and destructures its single-platform report, eliminating v4's incompatible test call.

> **v7 review outcome (2026-08-24):**
> v6 is byte-identical to v4 (the Git blob is `2b78c0709acaadcc12dab8967df02f05f125ebb4`), so it contains no independent change to accept or reject. This v7 restores the v5 corrections on top of the current v6 baseline and retains v6's documented platform research. It is the recommended execution plan; v4 and v6 should be treated as superseded duplicates.
>
> 1. Restore `VerificationLevel`, per-capability evidence, and registry-load rejection of any `native` capability lacking schema/runtime proof.
> 2. Restore scope-aware `PlatformPaths`, explicit project/user locations, and `resolveArtifactLocation()` as the only filesystem resolver.
> 3. Require `--scope user --yes` for **every mutating operation** (install, upgrade, uninstall, and legacy migration); plan and doctor stay read-only.
> 4. Restore private scope-specific backup/lock roots; no home config gets an adjacent third-party backup directory, and stale locks are never removed automatically.
> 5. Do not emit instructions for fallback/discovery-only adapters (Hermes, Antigravity, or unverified Kimi); test the declared contract rather than an all-platform `AGENTS.md` assumption.
> 6. Restore the one list-returning doctor domain API, keeping `--json` in the CLI formatter and providing scope at the CLI boundary.

> **Independent review addendum (2026-08-24):** v7's evidence-gating design confirmed sound against two defects an earlier pass of this document had — the Task 4 core-parity test now correctly excuses `experimental` alongside `cli_fallback` (line ~636 `['cli_fallback', 'experimental'].includes(...)`), and Hermes/Antigravity no longer get a fabricated `AGENTS.md` instruction artifact contradicting their own `cli_fallback`/`discovery` capability cells. Both are real fixes. Three items still needed correcting, applied below:
>
> 1. **`assertRegistryIsVerifiable()` has no data to check.** `VerificationLevel` and the assertion that every `native` cell needs `'schema'|'runtime'` evidence are fully specified as *types and a test* (Task 1 Step 1), but no step anywhere populates the actual `verification: Record<Capability, VerificationLevel>` value for any of the 16 adapters, and the capability matrix still marks most cells `n` across most platforms. As written, an implementer has no guidance on what `verification` value each of those ~100+ native cells should carry, so Task 1's own new test (`'never reports native without exact upstream evidence'`) cannot pass without someone inventing evidence levels ad hoc — which is the exact failure mode evidence-gating exists to prevent. **Fixed:** Task 1 gets an explicit step deriving `verification` from citations already in this document (a capability with a linked official schema/config-reference in the Native-platform-review table gets `schema`; one that will only be checked by Task 10's env-gated live-binary job gets `runtime`, deferred to `fixture` until that job exists; everything else is `none` and its `capabilities[x]` must be downgraded from `n`, with the downgrade itself asserted by a test so the registry can't silently drift back to an unbacked `native` claim).
> 2. **Codex hook-schema citation is still imprecise** (carried over from v3/v4 unchanged): the "Comprehensive review" table and Task 6 interfaces still attribute both the milliseconds-based `[[hooks]]` schema and the seconds-based `[[hooks.PreToolUse]]` schema to `codex-generator.ts:111,120`. Independent verification this session confirmed the millisecond schema is actually in `platforms.ts:241` (`setupCodex`); `codex-generator.ts:111,120` is only the seconds-based schema. The underlying 1000× bug is real; only the file attribution was wrong. **Fixed** at both citation sites below.
> 3. **Shared `.agents/skills` root has no deletion-safety scoping.** This revision (like v4/v6) makes `.agents/skills` the single authoritative skill root for 12 of 16 platforms. Legacy-inventory row 4 still scopes `--remove-legacy` only by "marker/frontmatter-verified," with no statement that removal must be file-level and never delete the shared directory while another installed platform still owns files in it. **Fixed:** row 4 and the `--remove-legacy` flag description now say so explicitly, with a matching fixture case added to Task 8.

**Goal:** Make Monomind and Mastermind provide the same supported user outcomes on every supported coding platform through each platform's native configuration surfaces.

**Architecture:** Replace the current collection of overlapping installers with one declarative platform-adapter registry. Mastermind becomes a canonical set of portable `SKILL.md` packages plus a short router instruction; each adapter renders that content into the platform's documented instruction, skill, MCP, command, agent, hook, permission, and status surfaces. The MCP server and `monomind` CLI remain the functional source of truth, so a platform without a native UI surface receives an explicit CLI fallback rather than an unreliable emulation.

**Tech Stack:** TypeScript (repo TS 7.x, ESM with `.js` import suffixes), Node.js, pnpm, Vitest (package `testTimeout` 30s, `maxWorkers` 4), TOML/JSON/JSONC/Markdown renderers, MCP stdio, per-platform fixtures.

## Global Constraints

- Supported runtime universe is exactly: Claude Code, Gemini CLI, Cursor, VS Code, GitHub Copilot CLI, OpenCode, Aider, Kiro, Trae, OpenClaw, Droid, Google Antigravity, Hermes, Codex, Kimi Code, and Zed.
- **The workspace package name is `@monoes/monomindcli`** (directory `packages/@monomind/cli`). All filtered commands use `pnpm --filter @monoes/monomindcli`. The npm distribution name is `monomind`.
- A platform is not declared **supported** until its install, upgrade, uninstall, and smoke fixture passes, and Windows command rendering is covered by **OS-parametrized rendering unit tests** (`mcpCommand(platform, os)` over `win32`/`darwin`/`linux`). Live Windows CI for the cli package is out of scope until the documented node-gyp breakage is fixed; macOS execution is a manual release-checklist item (no macOS runner exists).
- "Parity" means equivalent outcomes, not identical files or forced hooks: project instructions, Mastermind workflows, Monomind MCP tools, graph navigation, memory, organization control, status, safety checks, diagnosis, and clean removal.
- Keep static project instructions below 200 lines; detailed Mastermind procedures must remain in on-demand skills. [Claude Code feature model](https://code.claude.com/docs/en/features-overview)
- **Portable skill ownership:** where a platform documents `.agents/skills` (workspace) or `~/.agents/skills` (user), that root is the sole authoritative Mastermind installation location. Gemini CLI, Cursor, VS Code, Copilot CLI, OpenCode, OpenClaw, Droid, Antigravity, Hermes, Codex, Kimi, and Zed use it. Claude (`.claude/skills`), Kiro (`.kiro/skills`), and Aider (no skills) are exceptions. A platform-owned root may be added only by an explicit `--mirror-platform-skills` option, is tracked separately for uninstall, and never runs by default.
- Do not install SessionStart prompt-injection hooks. Hooks are for deterministic checks, formatting, telemetry, or policy only; all must be fast, stdin-safe, idempotent, and fail open unless the user explicitly enables a blocking policy.
- Preserve user configuration. Every generated block has a stable, **per-artifact-per-platform** Monomind marker (`monomind:start <artifact>:<platform>`); every merge/uninstall modifies only that block or that named JSON/TOML entry. JSON files never receive comment markers.
- **Scope is part of the artifact identity.** `ArtifactIntent` carries `scope: 'project' | 'user'`; every configured artifact resolves through `PlatformPaths`, not string concatenation. Project installs may write only inside `resolveRepoPath(path)`; user installs may write only to the adapter's documented user location and never use the project-relative fallback.
- Do not claim a native capability where the platform does not provide one, or before a per-platform contract fixture **and** target schema/parser or environment-gated runtime test proves it. The registry stores that evidence. Surface the intentional fallback through MCP or the `monomind` CLI and report it in `monomind platforms doctor`.
- Do not make global (user-scope) changes from project initialization unless the user explicitly passes `--scope user --yes`. Existing user-scope writes performed by project init (statusline scripts, global `~/.claude/CLAUDE.md`, global settings hooks) are migrated to explicit user scope or removed (Tasks 5, 8).
- Backups and locks are scope-specific: project scope uses `<repo>/.monomind/backups/` and `<repo>/.monomind/locks/`; user scope uses `~/.monomind/backups/` and `~/.monomind/locks/` with owner-only permissions. Never write backups beside a third-party config file. A lock contains PID and creation time; timeout/stale-lock detection reports a recovery command and never removes another process's lock automatically.
- **Do not rename user-facing platform ids without an alias.** `claw` → `openclaw` and `kimicode` → `kimi` aliases are permanent; new ids require a registry entry; removals require a deprecation cycle: one full release with a warning diagnostic in `platforms doctor` + a shim that still executes the replacement behavior, then removal.
- **Security guards are load-bearing:** `operations.ts` must preserve today's `resolveRepoPath` validation (null-byte/directory checks), `assertWithinRoot` traversal defence (fixed for Windows `\` separators), and the 1 MB config-file read cap (`platforms.ts:446-481`). Hook bridges validate stdin payloads with the repo's Zod input-guard conventions (`src/utils/input-guards.ts`). Doctor/JSON reports sanitize absolute paths (precedent: `update.ts:199-201`).
- **Versioning (hard policy):** only the patch digit may ever increase. M1 ships as `2.9.26`, M2 as `2.9.27`. Changelog entries accumulate under `[Unreleased]` in root `CHANGELOG.md` and move under the patch header at release; `scripts/check-publish-versions.mjs` must pass.

---

## Release & milestone plan

Both milestones ship as **patch releases** with back-compat shims (legacy ids, `setup` deprecation shim, old-marker cleanup) so the auto-updater (`patch: true` by default) rolls them out safely. Migration detectors run on the first `platforms`/`init` invocation after update — not inside the updater.

| Milestone | Version | Tasks | Exit criteria (acceptance gates) |
|---|---|---|---|
| **M1 — Core parity** | 2.9.26 | 0, 1, 2, 3, 4, 7 (core renderers), 8, 9, 10 | G1, G2, G3, G4, G7, G9, G11 + core subset of G10 |
| **M2 — Native enhancement parity** | 2.9.27 | 5 (except the status-JSON fix, which is M1), 6, 7 (enhancement data), 11 | G5, G6, G8 + full G10 |

## Executive decision

**Proceed with a full adapter revision.** Do not repair each existing platform writer independently. The current implementation has four incompatible platform inventories (CLI `platforms.ts`, monograph `platform-skills.ts`, init `--target` choices, and the `claude/cursor/vscode/zed` enums in `mcp-tools/monograph/build-tools.ts`), treats Markdown commands as skills, installs Claude-oriented protocol content into other runtimes, and has no end-to-end contract that proves a generated configuration is valid for its target.

The revision ships in the two milestones above. No platform receives a full Mastermind protocol at session start; the old mechanism caused the prior Codex startup noise and makes all runtimes pay the context cost of workflows they may never use.

## Comprehensive review

### Current implementation findings (v3 additions in bold)

| Finding | Evidence in the repository | Required correction |
|---|---|---|
| There are conflicting platform inventories. | `platforms.ts` lists 14 targets (legacy `claw`); `monograph/src/skills/platform-skills.ts` lists 9; init `--target` offers 5 (`init.ts:112`); **`mcp-tools/monograph/build-tools.ts:176,259,352` hardcodes `claude/cursor/vscode/zed` enums**; init writers implement Kimi separately. | Replace all inventories with one registry and derive CLI help, init, doctor, tests, docs, **and the monograph build-tool enums** from it. |
| The generic installer writes instructions, not native skills. | `platforms.ts:43` writes `.claw/config.md`; `:36` writes deprecated `.cursorrules`; `:44` writes `DROID.md`. | Separate concise instructions from canonical skill packages. |
| The old global setup injects a Claude command file into SessionStart. | `MASTERMIND_ACTIVATE_SCRIPT` (`platforms.ts:100`), installed by `setupCodex`/`setupCursor` as `monomind-activate.cjs`. | Delete and migrate away on upgrade. |
| Codex has two incompatible hook schemas — **with a 1000× timeout-unit disagreement.** | `platforms.ts:241` (`setupCodex`) writes `[[hooks]]` with `timeout = 5000` (ms); `codex-generator.ts:111,120` writes `[[hooks.PreToolUse]]`/`[[hooks.PostToolUse]]` with `timeout = 5`/`10` (seconds) — same TOML schema, 1000× apart, split across two independent writer files. | One Codex adapter; timeout unit rendered per platform schema and asserted by test. |
| Existing "shared" skills were command Markdown files without skill metadata. | `installMastermindSkills` (`platforms.ts:168`) copies command files into `SKILL.md`. | Canonical skill sources first; commands become optional projections. |
| Core runtime features are Claude-shaped. | Codex, OpenCode, Kimi, and Gemini writers bridge into `.claude/helpers` or copy from `.claude/` trees; **the statusline subsystem bridges into `.claude/helpers/statusline.cjs` on 4 platforms; `write-claude.ts:151-152` copies Claude helpers into `.gemini/helpers`.** | Runtime-neutral core contracts; Claude adapters only as render targets. |
| **Project init performs user-scope writes** — violating this plan's own scoping constraint. | `write-claude.ts:262-301` appends to global `~/.claude/CLAUDE.md`; `:308-351` injects a SessionStart hook into global `~/.claude/settings.json`; `write-antigravity.ts` and `write-kimicode.ts:210-248` write user-scope statusline files. | Scope-gate behind `--scope user --yes` or remove with migration. |
| **`monomind status --json` is advertised but broken.** | `status.ts:437` reads `format === 'json'`; `--json` no-ops (`parser.ts:77-85`); the command's own example (`status.ts:798`) advertises it falsely. | Fix the alias in Task 5 before any contract names it. |
| **Current installer corrupts `.aider.conf.yml`** by appending `<!-- -->` HTML-comment blocks into YAML. | `platforms.ts:40` + `:74`. | Migration must de-corrupt; aider conventions go through the documented `read:` key. |
| Current tests prove names and a few file writes, not runtime compatibility. | `__tests__/commands/platforms.test.ts` asserts command metadata **and pins the count to 14**. | Per-platform fixture, merge, uninstall, command-rendering, hook-stdin, and smoke-contract tests. |

### Native-platform review and target policy (fact-checked 2026-08-23)

| Platform | Registry id (aliases) | Native surfaces (verified) | Parity target | Adapter policy |
|---|---|---|---|---|
| Claude Code | `claude` | `CLAUDE.md`, `.claude/skills`, `.mcp.json`, `.claude/settings.json` (hooks, statusLine, permissions), `.claude/agents/`, plugins | Full native parity | Baseline reference adapter. |
| Gemini CLI | `gemini` | `GEMINI.md`, `.gemini/skills` (+ `.agents/skills` alias), `~/.gemini/skills`, hooks in `settings.json`, MCP via `mcpServers` | Full native parity | Native skill/MCP adapter; no Claude helper dependency. Cite GitHub docs (gemini-cli.google.com fetches are unreliable). [Hooks](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md) |
| Cursor | `cursor` | `.cursor/rules/*.mdc`, `.cursor/skills` + `.agents/skills`, `.cursor/mcp.json`, `.cursor/hooks.json` (project) / `~/.cursor/hooks.json` (user) | Full native parity | Never write `.cursorrules`. [Skills](https://cursor.com/docs/context/skills), [hooks](https://cursor.com/docs/agent/hooks) |
| VS Code | `vscode` | `.github/copilot-instructions.md` (auto-detected), `.github/skills` + `.claude/skills` + `.agents/skills`, `.vscode/mcp.json`, custom agents; hooks exist | Full native parity | Dedicated `renderers/vscode.ts` (v2 routed a full-parity platform through `experimental.ts` — incoherent). [Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills) |
| GitHub Copilot CLI | `copilot` | `.github/copilot-instructions.md`/`AGENTS.md`, `.github/skills` + `.agents/skills`, `.github/hooks/*.json` (schema `{"version":1,"hooks":{…}}`) | Core parity + native hooks/skills | MCP via CLI-managed config only → `cli_fallback` until a documented file surface exists. [Skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills), [hooks](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks) |
| OpenCode | `opencode` | `AGENTS.md`, `.opencode/skills` (plural), `.opencode/commands`, `.opencode/agents`, plugins, `mcp` key in `opencode.json`, **permission rules** (bash allow-list, `.env` read-deny in `opencode-generator.ts:69-82`) | Full native parity | Keep the existing direction; render from canonical artifacts. [Skills](https://opencode.ai/docs/skills/) |
| Aider | `aider` | `.aider.conf.yml` with the documented `read:` key pointing at a conventions file; no skills/hooks/status | Core parity with explicit CLI fallback | No fake skills. **Migration de-corrupts the HTML-comment-in-YAML damage.** [Config](https://aider.chat/docs/config/aider_conf.html) |
| Kiro | `kiro` | `.kiro/steering/` (inclusion modes), `.kiro/skills`, `.kiro/mcp.json`, `.kiro/hooks`, `.kiro/agents/[name].json|.md` | Full native parity | Inclusion modes keep only the short router always-loaded. [Steering](https://kiro.dev/docs/steering/), [skills](https://kiro.dev/docs/skills/) |
| Trae | `trae` | `.trae/rules/` verified; skills/MCP/agents **unverifiable** (docs.trae.ai is a JS-rendered SPA) | Core parity first | Discovery-gated; cite no Trae doc URL as authoritative. |
| OpenClaw | `openclaw` (alias: `claw`) | Skill precedence: `<workspace>/skills` → `<workspace>/.agents/skills` → `~/.agents/skills` → `~/.openclaw/skills` (state dir); workspace `AGENTS.md`; user config `~/.openclaw/openclaw.json`; plugins; hooks | Core parity with project MCP CLI fallback | Never write project `openclaw.json` or `.claw/config.md`. Render MCP only for explicit user scope (or explicit `OPENCLAW_CONFIG_PATH`). [Skills](https://docs.openclaw.ai/tools/skills), [configuration](https://docs.openclaw.ai/configuration) |
| Droid | `droid` | `AGENTS.md`, `.factory/skills` (project) / `~/.factory/skills`, **`.factory/mcp.json`** (project) / `~/.factory/mcp.json` (user), `.factory/hooks.json`, plugins | Full native parity (commands/agents `experimental` until validation) | Greenfield today (repo has only `DROID.md` legacy) — every native claim requires Task 9 fixture coverage plus Task 10 upstream parser/runtime validation. [Skills](https://docs.factory.ai/harness/skills), [MCP](https://docs.factory.ai/harness/mcp) |
| Google Antigravity | `antigravity` | Two surfaces, picked by discovery: 2.0 → `.agents/skills` (workspace) + `~/.gemini/config/skills/`; AGY CLI → `~/.gemini/antigravity-cli/skills/`. JSON hooks in customization dir; rules; MCP; plugins | Full native parity (discovery-gated) | **`~/.gemini/skills` is Gemini CLI's, never Antigravity's.** Replaces `setupAntigravity` + `geminimd-generator.ts` surfaces. [Hooks](https://antigravity.google/docs/hooks) |
| Hermes | `hermes` | Nous Research Hermes Agent: `~/.hermes/skills/` + project `.hermes/skills`/`.agents/skills` (trust-gated), `~/.hermes/config.yaml`, MCP; **no hooks** | Core parity first | Discovery probe records paths; hooks stay `unsupported`. [Docs](https://hermes-agent.nousresearch.com/docs) |
| Codex | `codex` | `AGENTS.md`, **`.agents/skills` (repo) / `~/.agents/skills` (user)**, `.codex/config.toml` (`[mcp_servers]`, `[[hooks.<Event>]]` — native hooks confirmed, feature-flagged off by default), `hooks.json` alternative | Full native parity | Keep native project integration; remove legacy activation writer; hooks remain opt-in (matches Codex's own default-off). [Config](https://learn.chatgpt.com/docs/config-file/config-reference), [skills](https://learn.chatgpt.com/docs/build-skills.md) |
| Kimi Code | `kimi` (alias: `kimicode`) | `.kimi-code/skills` + `.agents/skills`, `.kimi-code/mcp.json`, plugins (`kimi.plugin.json`: commands/agents/hooks/mcpServers), `[[hooks]]` in `~/.kimi-code/config.toml` | Full native parity only where evidence-gated | **AGENTS.md instruction file unverified** — keep it `experimental`/fallback until a target schema or runtime test confirms it; Monomind fixtures alone are insufficient. Plugin slash commands require manual `/plugins install` → `activation: manual-step` surfaced in doctor. [Skills](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html), [plugins](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html) |
| Zed | `zed` | **AGENTS.md** (primary; first-match compat list), **`.agents/skills`** (flat layout), `agent.profiles` in `.zed/settings.json` (legacy `.zed/agents/*.toml`), `context_servers` MCP | Core parity then native enhancements | Retire monograph's `.zed/*.md` writes; discovery validates layout. [Agents](https://zed.dev/docs/ai/agents), [skills](https://zed.dev/docs/ai/skills.md) |

### Capability contract

Every adapter declares one of `native`, `cli_fallback`, `unsupported`, or `experimental` for each capability. **`experimental` upgrades to `native` only after its Task 9 installation fixture and Task 10 upstream parser/runtime contract pass; it never blocks M1 core parity.** A `native` cell is invalid at registry-load time without `schema` or `runtime` evidence for that exact capability. An `activation: 'manual-step'` annotation (Kimi plugins) may accompany `native` and is surfaced in doctor.

| Capability | Functional definition | Minimum parity requirement |
|---|---|---|
| Project instructions | The agent receives concise project operating rules. | Native instruction file or generated `AGENTS.md` equivalent. |
| Mastermind router | The agent can discover which Mastermind workflow applies. | One concise always-on router plus available skill names. |
| Mastermind workflows | The agent can load the full procedure for plan, review, debug, research, execution, org, and memory work. | Canonical `SKILL.md` package natively, or `monomind mastermind run <skill> --print` (implemented in Task 2). |
| Monomind tools | The agent can query graph, impact, memory, organizations, events, and diagnostics. | Named MCP server; documented CLI fallback only if MCP is unavailable. |
| Commands | A user can invoke workflows intentionally. | Native command aliases where documented; otherwise documented `monomind` CLI equivalents. |
| Agents | A user can run specialized roles. | Native subagent manifest where available; otherwise `monomind org run` plus an explainer skill. |
| Hooks | Deterministic pre/post validation and learning. | `experimental` until the adapter contract test proves native schema, payload, and timeout units; opt-in only. |
| Status | A user can view runtime, MCP, graph, memory, and hook health. | Native status line/command if available; otherwise `monomind status --format json` (Task 5 adds the `--json` alias) and a platform command wrapper. |
| Permissions | Safety policy for tool/file use where the platform has a native permission surface. | Native permission entries (Claude settings permissions, opencode permission rules); `unsupported` elsewhere. |
| Upgrade/removal | The integration is idempotent and reversible. | Dry-run, diff, backup, merge, uninstall, and stale legacy cleanup. |

### Canonical registry capability matrix (implemented verbatim in Task 1)

`n` = native, `f` = cli_fallback, `u` = unsupported, `e` = experimental. `reqDisc` = requiresDiscovery. In the committed M1 registry, any currently unproven `n` cell is conservatively emitted as `e` or `f` until its evidence record reaches `schema` or `runtime`; the table is the target contract, while the generated compatibility document reports the evidence-gated current state.

| Platform | instructions | skills | mcp | commands | agents | hooks | status | lifecycle | permissions | reqDisc |
|---|---|---|---|---|---|---|---|---|---|---|
| claude | n | n | n | n | n | n | n | n | n | no |
| gemini | n | n | n | f | u | n | f | n | u | no |
| cursor | n | n | n | f | u | n | f | n | u | no |
| vscode | n | n | n | f | n | e | f | n | u | no |
| copilot | n | n | f | f | u | n | f | n | u | no |
| opencode | n | n | n | n | n | n | n | n | n | no |
| aider | n | f | f | f | f | u | f | n | u | no |
| kiro | n | n | n | f | n | n | f | n | u | no |
| trae | n | e | e | f | e | e | f | n | u | yes |
| openclaw | n | n | f | f | f | n | f | n | u | no |
| droid | n | n | n | e | e | n | f | n | u | no |
| antigravity | e | n | n | f | e | n | f | n | u | yes |
| hermes | f | e | e | f | u | u | f | n | u | yes |
| codex | n | n | n | f | e | n | f | n | u | no |
| kimi | n | n | n | n | n | n | f | n | u | no |
| zed | n | n | n | f | e | u | f | n | u | yes |

## File structure

| File or directory | Responsibility |
|---|---|
| `packages/@monomind/cli/src/platform-adapters/types.ts` | Canonical types, capability enum (9 capabilities), install scopes, artifact model, `PlatformPaths`, `InstallRequest`, `DiscoveryResult`, diagnostics. |
| `packages/@monomind/cli/src/platform-adapters/registry.ts` | The only platform list: 16 adapters, capability matrix above, exact-capability verification evidence, legacy aliases (`claw`, `kimicode`), `requiresDiscovery`. |
| `packages/@monomind/cli/src/platform-adapters/paths.ts` | Scope-aware artifact-location resolution, scope-specific backup/lock roots, and path-redaction helpers. |
| `packages/@monomind/cli/src/platform-adapters/core.ts` | Builds neutral instruction, skill, MCP, command, status, hook, and permission intents. |
| `packages/@monomind/cli/src/platform-adapters/renderers/*.ts` | **Sixteen** platform renderers (including `vscode.ts`) + `experimental.ts` serving `{trae, hermes}` and discovery-fallback for antigravity/zed enhancement data. |
| `packages/@monomind/cli/src/platform-adapters/operations.ts` | Plan, apply, upgrade, uninstall, backup, doctor orchestration; preserves `resolveRepoPath`/`assertWithinRoot`/1 MB cap; pid-suffixed tmp+rename atomic writes (precedent `shared.ts`). |
| `packages/@monomind/cli/src/platform-adapters/merge.ts` | Multi-block managed-marker merge/remove (md/toml/yaml), JSON/JSONC/YAML named-entry merge/remove, legacy bare-marker recognition. YAML mutation is permitted only after a parser/serializer preservation contract is tested. |
| `packages/@monomind/cli/src/platform-adapters/discovery.ts` | Version/path/schema probes for trae, hermes, antigravity (2.0 vs CLI), zed, and the MCP file locations of openclaw/droid/kimi. |
| `packages/@monomind/cli/src/platform-adapters/migration.ts` | `LEGACY_SURFACE_INVENTORY` (14 rows, below) + marker-upgrade + de-corruption logic. |
| `packages/@monomind/cli/src/mastermind/manifest.ts` | Canonical Mastermind skill manifest, aliases, and reference-file links. |
| `packages/@monomind/cli/src/commands/mastermind.ts` | `monomind mastermind run <skill> --print` / `--list` — the CLI fallback launcher. |
| `packages/@monomind/cli/.claude/skills/mastermind*/**` | **The canonical skill source (already npm-shipped via `files: ['.claude']`).** The router package `mastermind/` is added here; `references/` ships alongside it. |
| `packages/@monomind/cli/src/mcp-tools/platforms-tools.ts` | `platforms_doctor` MCP tool (thin wrapper over doctor orchestration). |
| `packages/@monomind/cli/src/commands/platforms.ts` | Thin CLI facade: install/upgrade/doctor/uninstall + deprecation `setup` shim. |
| `packages/@monomind/cli/src/init/*` | Calls registry adapters; see the disposition table below. |
| `packages/@monomind/cli/__tests__/platform-adapters/**` | Unit, fixture, merge/uninstall, hook-contract, rendering, and smoke tests (package-root `__tests__/` convention; imports use relative `.js` suffixes; `resource-governor.setup.ts` applies). |
| `docs/platforms/compatibility.md` | Generated capability matrix; CI-checked against the registry (`platforms docs --check`). |
| `docs/platforms/migration-guide.md` | Exact upgrade/removal safety behavior. |

### Init writer disposition (every `src/init/` file has exactly one owner)

| File | Disposition |
|---|---|
| `mcp-generator.ts` | Task 4: `createMCPServerEntry` extracted into `renderers/mcp.ts` (keeps its Windows `cmd /c` handling); generator becomes a wrapper. Sole writer of `.mcp.json`. |
| `write-codex.ts`, `codex-generator.ts` | Tasks 4/6: fold into the codex renderer; delete legacy `[[hooks]]` writer after migration exists. |
| `write-opencode.ts`, `opencode-generator.ts` | Tasks 4/5/6: fold into the opencode renderer, including permission rules and the hooks plugin. |
| `write-antigravity.ts`, `geminimd-generator.ts` | Tasks 4/5: fold into the antigravity renderer; user-scope statusline writes move behind `--scope user --yes`; `~/.gemini/skills` writes migrate to Antigravity's real paths. |
| `write-kimicode.ts`, `kimi-generator.ts` | Tasks 4/5/6: fold into the kimi renderer; user-scope statusline writes move behind `--scope user --yes`. |
| `write-claude.ts` | Task 8: **global `~/.claude/CLAUDE.md` append and global settings SessionStart hook are removed** (they violate scope policy); project-level writes fold into the claude renderer. |
| `claudemd-generator.ts` | Task 4: becomes the content input for the claude renderer's instruction artifact (single instruction owner). |
| `settings-generator.ts`, `statusline-generator.ts` | Task 5: settings hooks/statusLine become claude-renderer enhancement intents; the statusline script becomes the runtime-neutral status renderer's Claude projection (adopted, not duplicated). |
| `helpers-generator.ts` | Task 6: defines where the runtime-neutral hook policy code ships; `.claude/helpers` becomes a render target only. |
| `shared-instructions-generator.ts` | Task 4: classified as a neutral core artifact (`.agents/shared_instructions.md`), rendered via adapters. |
| `copy-assets.ts`, `shared.ts`, `upgrade.ts` | Task 2: `SKILLS_MAP`/`COMMANDS_MAP`/`AGENTS_MAP` sources redirect to the manifest-driven list; upgrade sync uses the same source. One distribution mechanism. |
| `write-runtime-config.ts`, `write-sample-org.ts`, `write-capabilities.ts` | Runtime-neutral; unchanged (capabilities doc has no platform inventory — verified). |
| `executor.ts`, `index.ts`, `types.ts` | Task 8: executor dispatches to adapters per the init contract below. |

## Implementation tasks

### Task 0: Freeze the executable baseline (M1)

**Files:**
- Modify: none (verification + scaffolding only)

- [ ] **Step 1: Create the isolated implementation worktree**

```bash
git worktree add -b worktree/mastermind-platform-parity .worktrees/mastermind-platform-parity HEAD
cd .worktrees/mastermind-platform-parity
git status --short
```

Expected: a clean dedicated worktree on `worktree/mastermind-platform-parity`. Do all remaining plan tasks, tests, and commits there; do not modify the primary working tree.

- [ ] **Step 2: Verify the toolchain the plan depends on**

```bash
pnpm --filter @monoes/monomindcli exec -- node -e "console.log(require('./package.json').name, require('./package.json').version)"
pnpm --filter @monoes/monomindcli test
pnpm --filter @monoes/monomindcli run build
pnpm lint
CI=true pnpm test:all
```

Expected: package name prints `@monoes/monomindcli` (version 2.9.x); all four gates pass on a clean checkout. **If any gate is already red, record it in the task notes before proceeding — do not label later failures as caused by this plan.**

- [ ] **Step 3: Record the fixed vocabulary in the execution run notes**

Record in the execution run notes (not a new repository file): filter string `@monoes/monomindcli`; typecheck = `run build` (tsc); lint = root `pnpm lint` (biome); final gate = `CI=true pnpm test:all` (workspace-wide); focused test = `pnpm --filter @monoes/monomindcli exec vitest run <path>`; package `testTimeout` is 30000ms; tests run under `__tests__/setup/resource-governor.setup.ts`.

### Task 1: Freeze the capability baseline and registry vocabulary (M1)

**Files:**
- Create: `src/platform-adapters/types.ts`, `src/platform-adapters/registry.ts`
- Create: `__tests__/platform-adapters/registry.test.ts`
- Modify: `src/commands/platforms.ts`
- Modify: `__tests__/commands/platforms.test.ts` (**v2 missed this — the existing test pins the count to 14 and must be updated in the same commit**)

**Interfaces:**
- `PlatformId` (16 canonical ids), `Capability` (9 values), `SupportLevel`, `VerificationLevel`, `PlatformPaths`, `PlatformAdapter`, `PLATFORM_REGISTRY`, `PLATFORM_IDS`, `LEGACY_PLATFORM_ALIASES`, `resolvePlatformId()`, `assertRegistryIsVerifiable()`.
- `PLATFORM_REGISTRY` implements the capability matrix in this document with evidence-gating. The compatibility doc, doctor, and tests are generated from it; the target table is never allowed to make an unsupported assertion look native.

- [ ] **Step 1: Write the failing registry test**

```ts
import { describe, expect, it } from 'vitest';
import { PLATFORM_REGISTRY, PLATFORM_IDS, resolvePlatformId, CAPABILITIES } from '../../src/platform-adapters/registry.js';

describe('platform registry', () => {
  it('has one unique adapter for all sixteen supported targets', () => {
    expect(new Set(PLATFORM_IDS).size).toBe(PLATFORM_IDS.length);
    expect([...Object.keys(PLATFORM_REGISTRY)].sort()).toEqual([...PLATFORM_IDS].sort());
  });

  it('declares all nine capabilities for every adapter', () => {
    for (const id of PLATFORM_IDS) {
      expect(Object.keys(PLATFORM_REGISTRY[id].capabilities).sort()).toEqual([...CAPABILITIES].sort());
    }
  });

  it('never reports native without exact upstream evidence', () => {
    expect(() => assertRegistryIsVerifiable(PLATFORM_REGISTRY)).not.toThrow();
    for (const adapter of Object.values(PLATFORM_REGISTRY)) {
      for (const capability of CAPABILITIES) {
        if (adapter.capabilities[capability] === 'native') {
          expect(['schema', 'runtime']).toContain(adapter.verification[capability]);
        }
      }
    }
  });

  it('snapshots the contractual capability matrix', () => {
    expect(PLATFORM_REGISTRY).toMatchSnapshot(); // reviewed against the plan's matrix table
  });

  it('normalizes legacy ids', () => {
    expect(resolvePlatformId('claw')).toBe('openclaw');
    expect(resolvePlatformId('kimicode')).toBe('kimi');
    expect(resolvePlatformId('not-a-platform')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement types and registry**

```ts
export const CAPABILITIES = [
  'instructions', 'skills', 'mcp', 'commands', 'agents', 'hooks', 'status', 'lifecycle', 'permissions',
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type SupportLevel = 'native' | 'cli_fallback' | 'unsupported' | 'experimental';
export type VerificationLevel = 'none' | 'fixture' | 'schema' | 'runtime';
export type PlatformId =
  | 'claude' | 'gemini' | 'cursor' | 'vscode' | 'copilot' | 'opencode' | 'aider'
  | 'kiro' | 'trae' | 'openclaw' | 'droid' | 'antigravity' | 'hermes' | 'codex'
  | 'kimi' | 'zed';

/** Published CLI ids that must keep working. Normalize at the CLI boundary only. */
export const LEGACY_PLATFORM_ALIASES: Readonly<Record<string, PlatformId>> = Object.freeze({
  claw: 'openclaw',
  kimicode: 'kimi',
});

export interface PlatformAdapter {
  id: PlatformId;
  displayName: string;
  capabilities: Record<Capability, SupportLevel>;
  /** Evidence for the rendered artifact, not merely a Monomind-owned fixture. */
  verification: Record<Capability, VerificationLevel>;
  activationNotes?: Readonly<Partial<Record<Capability, 'manual-step'>>>;
  paths: PlatformPaths;
  requiresDiscovery: boolean;
}

export function assertRegistryIsVerifiable(registry: Record<PlatformId, PlatformAdapter>): void {
  for (const adapter of Object.values(registry)) {
    for (const capability of CAPABILITIES) {
      if (adapter.capabilities[capability] === 'native'
          && !['schema', 'runtime'].includes(adapter.verification[capability])) {
        throw new Error(`${adapter.id}.${capability} is native without upstream verification`);
      }
    }
  }
}
```

- [ ] **Step 3 (independent-review addition — closes the gap where `assertRegistryIsVerifiable` had a test but no data): Populate `verification` for every adapter, and downgrade unbacked `native` cells**

The target capability matrix in this document marks most cells `n`, but `verification` values are never assigned anywhere else in this plan, so Task 1's own registry test (`'never reports native without exact upstream evidence'`) has nothing to check against. Derive `verification` mechanically from citations already in this document, not by invention:

- `'schema'` — the capability has a linked official schema/config-reference doc in the Native-platform-review table (e.g. Claude's `.mcp.json`, OpenCode's `opencode.json` `mcp` key, Codex's `[mcp_servers]` in `config.toml`) that a renderer's output can be validated against.
- `'runtime'` — reserved for capabilities Task 10's env-gated live-binary job actually exercises (droid/hermes/antigravity today); `'fixture'` until that job exists for a given platform, even if the schema is documented.
- `'none'` — no third-party evidence exists yet. **Any capability at `'none'` must have its `capabilities[x]` value in the same commit downgraded from `n` to `e` (experimental) or `f` (cli_fallback) in the actual `PLATFORM_REGISTRY` implementation** — the target table in this document is aspirational; the committed registry is not allowed to diverge from what `verification` actually backs.

Add a second registry test asserting this invariant holds in the other direction too — no `capabilities[x] === 'native'` may ship without a `verification[x]` of `'schema'` or `'runtime'` recorded in the same PR, so a future change can't silently promote a cell to native without adding its evidence:

```ts
it('never promotes a capability to native in the same change without recording its evidence source', () => {
  // executed against the PR diff in CI, not the runtime registry alone —
  // see docs/platforms/verification-ledger.md for the citation each 'schema'/'runtime' entry must link to.
});
```

Record the resulting per-adapter evidence table in `docs/platforms/verification-ledger.md` (one row per platform/capability, linking back to the citation in this document that justifies `'schema'` or `'runtime'`) so a reviewer never has to trust an uncited `native` claim.

- [ ] **Step 4: Replace duplicate platform arrays and keep the build green**

`SUPPORTED_PLATFORMS` in `platforms.ts` becomes a re-export of `PLATFORM_IDS`; the legacy `Platform` type union and `PLATFORM_CONFIG_FILES` map survive **until Task 8** (narrow them via `satisfies` against `PlatformId | 'claw'` or cast at the boundary) so `tsc` stays green. Update `__tests__/commands/platforms.test.ts` to derive the count from `PLATFORM_IDS.length` (never a literal again). Sweep the hard-coded "all 14 platforms" strings in option/example help text (`platforms.ts:637,663`). Do not touch `commands/browse-platform.ts`'s unrelated `SUPPORTED_PLATFORMS` (social platforms) beyond a disambiguating comment.

- [ ] **Step 5: Run the focused verification**

```bash
pnpm --filter @monoes/monomindcli exec vitest run __tests__/platform-adapters/registry.test.ts __tests__/commands/platforms.test.ts
pnpm --filter @monoes/monomindcli run build
```

Expected: PASS; sixteen adapters; nine capabilities each; matrix snapshot matches this document; every `native` cell has `'schema'`/`'runtime'` verification recorded (`assertRegistryIsVerifiable` does not throw); `claw`/`kimicode` aliases resolve; build compiles.

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/src/platform-adapters packages/@monomind/cli/src/commands/platforms.ts packages/@monomind/cli/__tests__/commands/platforms.test.ts packages/@monomind/cli/__tests__/platform-adapters docs/platforms/verification-ledger.md
git commit -m "refactor(platforms): add canonical adapter registry with legacy id aliases and verification ledger"
```

### Task 2: Canonicalize Mastermind skill packages, the router, and the CLI fallback launcher (M1)

**Files:**
- Create: `src/mastermind/manifest.ts`
- Create: `.claude/skills/mastermind/SKILL.md` (the router package — **inside the already-shipped tree**, not a new `assets/` tree)
- Create: `.claude/skills/mastermind/references/*.md` (port the 6 reference files from `.claude/commands/mastermind/references/`)
- Create: `src/commands/mastermind.ts`
- Create: `__tests__/mastermind/manifest.test.ts`
- Modify: `src/commands/index.ts` (add to `COMMAND_LOADERS` **and** `CATEGORY_NAMES` so grouped help shows it)
- Modify: `src/init/copy-assets.ts`, `src/init/shared.ts`, `src/init/upgrade.ts` (redirect `SKILLS_MAP`/`COMMANDS_MAP`/`AGENTS_MAP` to the manifest-driven list — v2 listed `copy-assets.ts` with no stated change and left `shared.ts`/`upgrade.ts` drifting)

**Interfaces:**
- `MASTERMIND_SKILLS: readonly MastermindSkill[]` — name, description, aliases, source (resolved against the shipped `.claude/skills/` tree via the existing `findSourceDir` mechanism), references.
- `renderSkillPackage(skill, target): string` — valid `SKILL.md`, `name`+`description` frontmatter, no Claude-only variables (`$CLAUDE_PROJECT_DIR`), no platform-specific env, relative links resolve inside the package.
- `monomind mastermind run <skill> [--print] [--list]` — resolves name-or-alias, prints the rendered package to stdout. **Scoped to `--print`/`--list` only**; v2's "pipes it to the configured agent CLI" had no config surface anywhere in the repo and is cut. This command must exist before any adapter declares a skills `cli_fallback`.

- [ ] **Step 1: Write the failing canonical-skill test**

```ts
it('renders a portable Mastermind skill with required frontmatter and resolving links', () => {
  const skill = MASTERMIND_SKILLS.find(({ name }) => name === 'mastermind-plan')!;
  const rendered = renderSkillPackage(skill, 'codex');
  expect(rendered).toMatch(/^---\nname: mastermind-plan\ndescription: .+\n---\n/m);
  expect(rendered).not.toContain('$CLAUDE_PROJECT_DIR');
  for (const link of extractRelativeLinks(rendered)) {
    expect(resolveWithinPackage(skill, link)).toBeTruthy();
  }
});

it('covers every workflow family in the capability contract', () => {
  const names = MASTERMIND_SKILLS.map(({ name }) => name);
  for (const family of ['router', 'plan', 'review', 'debug', 'research', 'execute', 'org', 'memory']) {
    expect(names.some((name) => name === 'mastermind' || name === `mastermind-${family}`)).toBe(true);
  }
});

it('counts the shipped tree deterministically', () => {
  // 44 command files today (42 user-facing + _repeat/_taskfile); the count may only
  // change through a manifest change reviewed against this test.
  expect(countFiles('.claude/commands/mastermind', '*.md')).toBe(44);
});
```

- [ ] **Step 2: Reconcile the manifest against the existing shipped packages**

The shipped tree already contains 68 `mastermind-*` packages (including `mastermind-plan`, `mastermind-review`, `mastermind-debug`, `mastermind-research`, `mastermind-execute`, `mastermind-memory`). For each of the 8 manifest entries: map it to its existing shipped package or mark it net-new (`mastermind` router; `mastermind-org` — org work today is spread across runorg/createorg/orgs commands and must be consolidated). **Audit each mapped body for Claude-specific variables, tool names, and paths** — the portability assertion in Step 1 will fail against Claude-written bodies, and fixing them is in scope. Legacy `/mastermind:*` command files keep shipping during M1; the manifest is the only place new skills may be added, and each addition requires frontmatter plus a fixture test (record this in the manifest file header). The v2 `mode: 'automatic' | 'manual'` field is dropped — no platform consumes it; invocation guidance lives in the description prose.

- [ ] **Step 3: Write the router as concise always-available guidance**

```markdown
---
name: mastermind
description: Route a request to the relevant Mastermind workflow (plan, review, debug, research, execute, org, memory).
---

# Mastermind Router

Use `mastermind-plan` before multi-file implementation, `mastermind-review` for audits,
`mastermind-debug` for failures, `mastermind-research` for open questions. Load only
the selected skill. Use Monograph before broad repository search when the platform
exposes the Monomind MCP server. Without MCP/native skills, run
`monomind mastermind run <skill> --print` in the terminal and paste the procedure.
Per-platform tool mappings live in `references/`.
```

- [ ] **Step 4: Implement `monomind mastermind run`**

`src/commands/mastermind.ts` reads `MASTERMIND_SKILLS`, resolves name-or-alias, renders the canonical package for a neutral target, and writes it to stdout with `--print`; `--list` prints the manifest; unknown names print the skill list and exit 1. Register in `COMMAND_LOADERS` and `CATEGORY_NAMES` (`src/commands/index.ts:15-52,72-92`).

- [ ] **Step 5: Redirect the distribution maps**

`shared.ts` `SKILLS_MAP`/`COMMANDS_MAP`/`AGENTS_MAP` and `upgrade.ts` sync derive their mastermind entries from `MASTERMIND_SKILLS` so init, upgrade, and adapters share one source.

- [ ] **Step 6: Run focused verification and commit**

```bash
pnpm --filter @monoes/monomindcli exec vitest run __tests__/mastermind/manifest.test.ts __tests__/commands/platforms.test.ts
git add packages/@monomind/cli/src/mastermind packages/@monomind/cli/.claude/skills/mastermind packages/@monomind/cli/src/commands/mastermind.ts packages/@monomind/cli/src/commands/index.ts packages/@monomind/cli/src/init packages/@monomind/cli/__tests__/mastermind
git commit -m "feat(mastermind): canonicalize portable skill packages and CLI fallback launcher"
```

Expected: PASS; every skill has metadata, resolvable source and references, no Claude-only variables; `mastermind run --list` covers every manifest entry and alias.

### Task 3: Build neutral artifact intents and safe merge operations (M1)

**Files:**
- Create: `src/platform-adapters/core.ts`, `src/platform-adapters/operations.ts`, `src/platform-adapters/merge.ts`
- Create: `__tests__/platform-adapters/merge.test.ts`

**Interfaces (defined once, consumed unchanged by Tasks 7–10 — v2 left `InstallRequest` undefined and four tasks invented different shapes):**

```ts
export interface InstallRequest {
  platform: PlatformId;          // canonical only; resolvePlatformId at the CLI boundary
  scope: 'project' | 'user';
  path?: string;                 // repo root; defaults to cwd
  yes?: boolean;                 // required for any user-scope mutation
  dryRun?: boolean;
  enableHooks?: boolean;         // opt-in hooks install (see Task 6)
  enableBlockingHooks?: boolean; // alias — one flag surface, see Task 6 Step 2
  discovery?: DiscoveryResult;   // required when adapter.requiresDiscovery
}

/** Shared preflight contract for every command that can mutate a selected scope. */
export interface MutationRequest extends Omit<InstallRequest, 'discovery'> {
  removeLegacy?: boolean;
}
```

- `planInstall(request): Promise<PlatformPlan>` — side-effect free.
- `resolveArtifactLocation(adapter, kind, scope, environment): ResolvedArtifactLocation | undefined` — the only conversion from adapter data to a filesystem path. It returns `undefined` for a fallback/unverified/discovery-only surface and emits a diagnostic rather than inventing a file.
- `applyPlan(plan): Promise<ApplyResult>` — writes only after preflight; rejects `scope: 'user'` unless `yes === true`; atomic (pid-suffixed tmp + rename, precedent in `shared.ts`); scope-specific cross-process lock for every apply/upgrade/uninstall/migration mutation.
- `upgradePlatforms(request: MutationRequest)` / `uninstallPlatform(request: MutationRequest)` / `migrateLegacyInstall(request: MutationRequest)` — use the same `scope` and `yes` preflight as `installPlatform`; no mutating code path may bypass it.
- `mergeManagedBlock(content, marker)` / `removeManagedBlock(content, artifact, platform)` — **multi-block capable**: markers are `monomind:start <artifact>:<platform>` / `monomind:end <artifact>:<platform>`; several managed blocks may coexist in one file (AGENTS.md is written by up to five platforms); removal touches exactly one.
- `mergeNamedEntry(json, path, entry)` / `removeNamedEntry(json, path, name)` — JSON object merge by key (idempotent, foreign keys preserved byte-for-byte).
- `LEGACY_BLOCK_MARKERS = ['<!-- monomind:start -->', '# monomind:start', '<!-- monomind:end -->', '# monomind:end']` — recognized for migration only.
- `operations.ts` preserves `resolveRepoPath`, `assertWithinRoot` (Windows-separator-safe), and the 1 MB cap.

`PlatformPaths` has a location per scope, rather than the former `projectArtifacts`/`userArtifacts` lists:

```ts
type Location = { path: string; format?: ArtifactIntent['format']; entryPath?: readonly string[] };
export interface PlatformPaths {
  instruction?: Partial<Record<InstallScope, Location | 'discovery' | 'cli_fallback'>>;
  skillRoot?: Partial<Record<InstallScope, Location | 'discovery' | 'cli_fallback'>>;
  mcp?: Partial<Record<InstallScope, Location | 'discovery' | 'cli_fallback'>>;
}
```

Locations must be explicit for each rendered scope. Examples asserted in tests: Codex project/user skills are `.agents/skills`/`~/.agents/skills`; Droid MCP is `.factory/mcp.json`/`~/.factory/mcp.json`; OpenClaw project MCP is `cli_fallback` and user MCP is `~/.openclaw/openclaw.json` (or the explicit config-path override); unknown Claude user MCP stays `cli_fallback` until its documented location is represented. Path presentation goes through `redactUserPath()`.

- [ ] **Step 1: Write failing merge, idempotency, multi-block, and JSON tests**

```ts
it('replaces only the managed TOML block and keeps user configuration', () => {
  const current = '[features]\nhooks = true\n\n# user comment\n';
  const once = mergeManagedBlock(current, 'hooks:codex', '[[hooks.PreToolUse]]\n');
  const twice = mergeManagedBlock(once, 'hooks:codex', '[[hooks.PreToolUse]]\n');
  expect(twice).toBe(once);
  expect(twice).toContain('# user comment');
});

it('supports sibling managed blocks from different platforms in one file', () => {
  let content = '# repo intro\n';
  content = mergeManagedBlock(content, 'instructions:codex', 'codex rules\n');
  content = mergeManagedBlock(content, 'instructions:opencode', 'opencode rules\n');
  expect(content).toContain('codex rules');
  expect(content).toContain('opencode rules');
  const afterUninstall = removeManagedBlock(content, 'instructions', 'codex');
  expect(afterUninstall).not.toContain('codex rules');
  expect(afterUninstall).toContain('opencode rules');
});

it('uninstalls only Monomind-owned content', () => {
  expect(removeManagedBlock('# before\n# monomind:start x:claude\nowned\n# monomind:end x:claude\n# after\n', 'x', 'claude'))
    .toBe('# before\n# after\n');
});

it('merges and removes JSON named entries without touching foreign keys', () => {
  const user = JSON.stringify({ mcpServers: { other: { command: 'x' } }, editor: { font: 12 } });
  const once = mergeNamedEntry(user, ['mcpServers', 'monomind'], { command: 'npx' });
  const twice = mergeNamedEntry(once, ['mcpServers', 'monomind'], { command: 'npx' });
  expect(JSON.parse(twice).mcpServers.other).toEqual({ command: 'x' });
  expect(JSON.parse(twice).editor).toEqual({ font: 12 });
  expect(twice).toBe(once);
  const removed = removeNamedEntry(twice, ['mcpServers'], 'monomind');
  expect(JSON.parse(removed).mcpServers.other).toEqual({ command: 'x' });
});

it('yields a diagnostic and no mutation on malformed JSON', () => {
  const result = safeJsonMerge('{ broken', ['mcpServers', 'monomind'], {});
  expect(result.diagnostics[0]).toMatch(/^ERROR:/);
  expect(result.content).toBe('{ broken');
});

it('does not mutate YAML until its named-entry round trip preserves foreign content', () => {
  const source = '# user comment\nmcp:\n  other:\n    command: x\n';
  const result = safeYamlNamedEntryMerge(source, ['mcp', 'monomind'], { command: 'npx' });
  expect(result.diagnostics).toEqual([]);
  expect(result.content).toContain('# user comment');
  expect(parseYaml(result.content).mcp.other).toEqual({ command: 'x' });
});

it.each([
  ['codex', 'skill', 'project', '.agents/skills'],
  ['codex', 'skill', 'user', '<home>/.agents/skills'],
  ['droid', 'mcp', 'project', '.factory/mcp.json'],
  ['droid', 'mcp', 'user', '<home>/.factory/mcp.json'],
])('%s resolves %s in %s scope only to its declared location', (platform, kind, scope, expected) => {
  expect(resolveArtifactLocation(PLATFORM_REGISTRY[platform], kind, scope, fixtureEnvironment()).displayPath).toBe(expected);
});

it('rejects an unconfirmed user-scope mutation without creating a backup or lock', async () => {
  await expect(installPlatform({ platform: 'codex', scope: 'user' })).rejects.toThrow('--yes');
  await expect(upgradePlatforms({ platform: 'codex', scope: 'user' })).rejects.toThrow('--yes');
  await expect(uninstallPlatform({ platform: 'codex', scope: 'user' })).rejects.toThrow('--yes');
  await expect(migrateLegacyInstall({ platform: 'codex', scope: 'user' })).rejects.toThrow('--yes');
  expect(await userBackupRootIsEmpty()).toBe(true);
});
```

- [ ] **Step 2: Implement typed artifact intents**

```ts
export type ArtifactKind = 'instruction' | 'skill' | 'mcp' | 'command' | 'agent' | 'hook' | 'status' | 'plugin' | 'permission';
export interface ArtifactIntent {
  kind: ArtifactKind;
  path: string;
  content: string;                 // for named_entry kinds: the entry payload
  marker?: string;                 // required for managed_block
  entryPath?: readonly (string | number)[]; // required for named_entry
  scope: 'project' | 'user';
  replace: 'managed_block' | 'named_entry' | 'create_if_missing';
  format?: 'md' | 'toml' | 'json' | 'jsonc' | 'yaml' | 'sh';
}
```

- [ ] **Step 3: Implement dry-run, backup, and atomic application**

```ts
export async function installPlatform(request: InstallRequest): Promise<ApplyResult> {
  const plan = await planInstall(request);
  if (request.dryRun) return { changed: [], skipped: [], diagnostics: plan.diagnostics, plan };
  return applyPlan(plan);
}
```

`applyPlan` backs up each mutated file into `<repo>/.monomind/backups/<timestamp>/` for project scope or `~/.monomind/backups/<timestamp>/` for user scope (user directories mode `0700`), routes `managed_block` vs `named_entry` by `replace`, uses the JSONC-tolerant parser for `format: 'jsonc'`, and never rewrites TOML full-file (managed comment block inside, or surgical entry splice preserving comments/order). The corresponding lock is held in the matching `.monomind/locks/` root and records PID/start time; a timeout or stale lock gives a no-mutation diagnostic and manual recovery instruction. YAML named-entry mutation is enabled only after the round-trip test above preserves comments and foreign keys; until then the Hermes adapter remains `cli_fallback` and reports the reason.

- [ ] **Step 4: Run focused verification**

```bash
pnpm --filter @monoes/monomindcli exec vitest run __tests__/platform-adapters/merge.test.ts
```

Expected: PASS; second application is a no-op; dry-run writes nothing; uninstall restores user content; malformed files yield diagnostics with zero mutation; sibling blocks survive targeted uninstall.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/platform-adapters packages/@monomind/cli/__tests__/platform-adapters/merge.test.ts
git commit -m "feat(platforms): add managed artifact planning and safe multi-format merges"
```

### Task 4: Implement instructions, skills, and MCP for every platform (M1)

**Files:**
- Create: `src/platform-adapters/renderers/instructions.ts`, `renderers/skills.ts`, `renderers/mcp.ts`
- Create: `__tests__/platform-adapters/core-parity.test.ts`
- Modify: `src/init/mcp-generator.ts`, `src/init/write-codex.ts`, `src/init/write-opencode.ts`, `src/init/write-antigravity.ts`, `src/init/write-kimicode.ts`, `src/init/claudemd-generator.ts`, `src/init/geminimd-generator.ts`, `src/init/shared-instructions-generator.ts`
- Modify: `packages/@monomind/monograph/src/skills/platform-skills.ts` **and its test `platform-skills.extra.test.ts` in lockstep**, plus `packages/@monomind/cli/src/mcp-tools/monograph/build-tools.ts` (the fourth inventory v2 missed)

**Interfaces:**
- `renderCoreArtifacts(adapter, options): ArtifactIntent[]` — concise instruction, router/package skills, one named `monomind` MCP entry for every `native` capability; CLI-fallback diagnostics for every `cli_fallback`.
- `mcpCommand(platform, os)` — owns Windows (`cmd /c …`) and POSIX rendering; extracted from today's `createMCPServerEntry` (`mcp-generator.ts:12-42,99-107`) which already handles Windows — reuse, don't reinvent. `.mcp.json` has exactly one writer: the claude renderer via `renderers/mcp.ts`; `mcp-generator.ts` becomes a wrapper.

- [ ] **Step 1: Write the all-target core-parity test**

```ts
const testOptions = { path: fixtureRoot, scope: 'project', os: 'linux' } as const; // defined here, reused by Tasks 5-10

it.each(PLATFORM_IDS)('%s renders only artifacts permitted by its verified contract', (platform) => {
  const adapter = PLATFORM_REGISTRY[platform];
  const plan = renderCoreArtifacts(adapter, testOptions);
  const hasInstruction = plan.some(({ kind }) => kind === 'instruction');
  expect(hasInstruction || ['cli_fallback', 'experimental'].includes(adapter.capabilities.instructions)).toBe(true);
  if (adapter.capabilities.instructions !== 'native') expect(hasInstruction).toBe(false);
  const hasSkill = plan.some(({ kind }) => kind === 'skill');
  expect(hasSkill || ['cli_fallback', 'experimental'].includes(adapter.capabilities.skills)).toBe(true); // v2 forced fake skills on aider — fixed
  if (adapter.capabilities.skills === 'cli_fallback') {
    expect(plan_diagnostics(plan)).toContain('mastermind run');
  }
  const hasMcp = plan.some(({ kind }) => kind === 'mcp');
  expect(hasMcp || ['cli_fallback', 'experimental'].includes(adapter.capabilities.mcp)).toBe(true);
});
```

- [ ] **Step 2: Make the short instruction platform-neutral and marker-scoped**

```markdown
<!-- monomind:start instructions:claude -->
# Monomind

Use the `monomind` MCP tools for graph navigation, impact analysis, memory, and organization work.
For multi-step work, load the applicable `mastermind-*` skill; do not load all workflows at once.
If MCP is unavailable, run `npx -y monomind@latest doctor` and use `npx -y monomind@latest` commands.
<!-- monomind:end instructions:claude -->
```

- [ ] **Step 3: Render the full verified location table (all 16 rows — data, not renderer logic)**

```ts
const PLATFORM_PATHS: Record<PlatformId, PlatformPaths> = {
  claude: { instruction: { project: { path: 'CLAUDE.md' }, user: 'cli_fallback' }, skillRoot: { project: { path: '.claude/skills' }, user: { path: '<home>/.claude/skills' } }, mcp: { project: { path: '.mcp.json', format: 'json', entryPath: ['mcpServers', 'monomind'] }, user: 'cli_fallback' } },
  gemini: { instruction: { project: { path: 'GEMINI.md' } }, skillRoot: { project: { path: '.agents/skills' }, user: { path: '<home>/.agents/skills' } }, mcp: { project: { path: '.gemini/settings.json', format: 'json', entryPath: ['mcpServers', 'monomind'] } } },
  cursor: { instruction: { project: { path: '.cursor/rules/monomind.mdc' } }, skillRoot: { project: { path: '.agents/skills' }, user: { path: '<home>/.agents/skills' } }, mcp: { project: { path: '.cursor/mcp.json', format: 'json', entryPath: ['mcpServers', 'monomind'] } } },
  vscode: { instruction: { project: { path: '.github/copilot-instructions.md' } }, skillRoot: { project: { path: '.agents/skills' }, user: { path: '<home>/.agents/skills' } }, mcp: { project: { path: '.vscode/mcp.json', format: 'json', entryPath: ['servers', 'monomind'] } } },
  copilot: { instruction: { project: { path: '.github/copilot-instructions.md' } }, skillRoot: { project: { path: '.agents/skills' }, user: { path: '<home>/.agents/skills' } }, mcp: { project: 'cli_fallback', user: 'cli_fallback' } },
  opencode: { instruction: { project: { path: 'AGENTS.md' } }, skillRoot: { project: { path: '.agents/skills' }, user: { path: '<home>/.agents/skills' } }, mcp: { project: { path: 'opencode.json', format: 'jsonc', entryPath: ['mcp', 'monomind'] } } },
  aider: { instruction: { project: { path: 'CONVENTIONS.md' } }, mcp: { project: 'cli_fallback', user: 'cli_fallback' } },
  kiro: { instruction: { project: { path: '.kiro/steering/monomind.md' } }, skillRoot: { project: { path: '.kiro/skills' } }, mcp: { project: { path: '.kiro/mcp.json', format: 'json', entryPath: ['mcpServers', 'monomind'] } } },
  trae: { instruction: { project: { path: '.trae/rules/monomind.md' } }, skillRoot: { project: 'discovery' }, mcp: { project: 'cli_fallback' } },
  openclaw: { instruction: { project: { path: 'AGENTS.md' } }, skillRoot: { project: { path: '.agents/skills' }, user: { path: '<home>/.agents/skills' } }, mcp: { project: 'cli_fallback', user: { path: '<home>/.openclaw/openclaw.json', format: 'json', entryPath: ['mcpServers', 'monomind'] } } },
  droid: { instruction: { project: { path: 'AGENTS.md' } }, skillRoot: { project: { path: '.agents/skills' }, user: { path: '<home>/.agents/skills' } }, mcp: { project: { path: '.factory/mcp.json', format: 'json', entryPath: ['mcpServers', 'monomind'] }, user: { path: '<home>/.factory/mcp.json', format: 'json', entryPath: ['mcpServers', 'monomind'] } } },
  antigravity: { instruction: { project: 'discovery' }, skillRoot: { project: { path: '.agents/skills' }, user: 'discovery' }, mcp: { project: 'discovery', user: 'discovery' } },
  hermes: { instruction: { project: 'cli_fallback', user: 'cli_fallback' }, skillRoot: { project: { path: '.agents/skills' }, user: { path: '<home>/.agents/skills' } }, mcp: { project: 'cli_fallback', user: 'discovery' } },
  codex: { instruction: { project: { path: 'AGENTS.md' } }, skillRoot: { project: { path: '.agents/skills' }, user: { path: '<home>/.agents/skills' } }, mcp: { project: { path: '.codex/config.toml', format: 'toml', entryPath: ['mcp_servers', 'monomind'] } } },
  kimi: { instruction: { project: { path: 'AGENTS.md' } }, skillRoot: { project: { path: '.agents/skills' }, user: { path: '<home>/.agents/skills' } }, mcp: { project: { path: '.kimi-code/mcp.json', format: 'json', entryPath: ['mcpServers', 'monomind'] } } },
  zed: { instruction: { project: { path: 'AGENTS.md' } }, skillRoot: { project: { path: '.agents/skills' }, user: { path: '<home>/.agents/skills' } }, mcp: { project: { path: '.zed/settings.json', format: 'jsonc', entryPath: ['context_servers', 'monomind'] } } },
};
```

- [ ] **Step 4: Reconcile the monograph registries**

`platform-skills.ts` consumes `PLATFORM_REGISTRY` (or reduces to a renderer called by adapters) — its 9-target list, `.zed/*.md` writes, and `.vscode/*.json` writes are retired; its test moves in the same commit. `build-tools.ts` platform enums derive from the registry. Existing targets (`.cursor/rules`, `.kiro/steering/monograph.md`, `.github/copilot-instructions.md`) become adapter data.

- [ ] **Step 5: Preserve CLI fallbacks for Aider, Copilot MCP, and undiscovered Trae/Hermes**

Every `cli_fallback` path emits a diagnostic naming `monomind mastermind run --print`, `monomind status --format json`, and `monomind platforms doctor`. OpenClaw additionally states that project-scope MCP is unavailable and that user-scope installation requires `--scope user --yes` or a supplied `OPENCLAW_CONFIG_PATH`. `discovery` emits no artifact until its probe attests the target version, path, and schema.

- [ ] **Step 6: Run focused verification and commit**

```bash
pnpm --filter @monoes/monomindcli exec vitest run __tests__/platform-adapters/core-parity.test.ts
git add packages/@monomind/cli/src/platform-adapters packages/@monomind/cli/src/init packages/@monomind/monograph/src/skills packages/@monomind/cli/src/mcp-tools/monograph
git commit -m "feat(platforms): provide core Mastermind and MCP parity on verified surfaces"
```

Expected: PASS; every adapter renders exactly the verified instruction/skill/MCP artifacts its capability contract permits; no fallback or discovery-only adapter receives a fabricated file; every non-fallback MCP target renders a named entry in its verified scoped file/entry path; OS-parametrized command rendering covered.

### Task 5: Add native commands, agents, status, and permissions (M2 — except Step 1, which is M1)

**Files:**
- Create: `src/platform-adapters/renderers/commands.ts`, `renderers/agents.ts`, `renderers/status.ts`
- Create: `__tests__/platform-adapters/enhancement-parity.test.ts`
- Create: `__tests__/commands/status.test.ts`
- Modify: `src/commands/status.ts` (**first**: add the `--json` alias)
- Modify: `src/init/opencode-generator.ts`, `src/init/kimi-generator.ts`, `src/init/codex-generator.ts`, `src/init/settings-generator.ts`, `src/init/statusline-generator.ts`, `src/init/write-antigravity.ts`, `src/init/write-kimicode.ts`

**Interfaces:**
- `commandAliases(skill, adapter): ArtifactIntent[]` — typed entries, not v2's mixed map:

```ts
export const COMMAND_ALIASES: readonly { name: string; kind: 'skill' | 'cli'; invoke: string }[] = [
  { name: 'plan', kind: 'skill', invoke: 'mastermind-plan' },
  { name: 'review', kind: 'skill', invoke: 'mastermind-review' },
  { name: 'debug', kind: 'skill', invoke: 'mastermind-debug' },
  { name: 'research', kind: 'skill', invoke: 'mastermind-research' },
  { name: 'execute', kind: 'skill', invoke: 'mastermind-execute' },
  { name: 'org', kind: 'cli', invoke: 'monomind org run' },
  { name: 'memory', kind: 'cli', invoke: 'monomind memory' },
  { name: 'status', kind: 'cli', invoke: 'monomind status --format json' },
  { name: 'doctor', kind: 'cli', invoke: 'monomind platforms doctor' },
];
```

- `renderStatus(adapter): { intent?: ArtifactIntent; diagnostic?: string }` — discriminated result (v2's `undefined` + `!` assertion pushed `undefined` into plans).
- Agent definitions carry a per-platform tool policy rendering: claude `tools:` frontmatter list, opencode `permission` block, kimi `tools:` comma string — fixture-tested per schema; the "explicit tool policy" expectation is only asserted where the platform schema is verified.
- **Statusline adoption:** the existing statusline subsystem (Claude `.claude/helpers/statusline.cjs` via `statusline-generator.ts`; antigravity/kimi user-scope scripts; opencode `/monomind-status`; codex `[tui] status_line`) is *adopted* into `renderStatus` per platform — preserving the caching/300ms-cap technique — not duplicated by a greenfield renderer. User-scope statusline writes happen only under `--scope user --yes`.

- [ ] **Step 1 (M1): Fix and pin the status fallback**

`status.ts` accepts `--json` (parser-level alias to `--format json`), its options array declares it, and a test executes `monomind status --json` and parses the output as JSON. All contract references may then use `--json`.

- [ ] **Step 2: Write failing enhancement parity assertions**

```ts
// Native command claims are limited to platforms with shipped code today;
// droid/kimi stay 'experimental'/'manual-step' until Task 9 fixtures and Task 10 upstream validation pass (v2 over-claimed greenfield platforms).
it.each(['claude', 'opencode'] as const)('%s has native command aliases', (platform) => {
  const rendered = renderEnhancements(PLATFORM_REGISTRY[platform], testOptions);
  expect(rendered.intents.some(({ kind }) => kind === 'command')).toBe(true);
});

it.each(PLATFORM_IDS)('%s reports native status or CLI fallback', (platform) => {
  const { status } = PLATFORM_REGISTRY[platform].capabilities;
  expect(status === 'native' || status === 'cli_fallback').toBe(true);
});

it('renders opencode permission rules as permission intents', () => {
  const rendered = renderEnhancements(PLATFORM_REGISTRY.opencode, testOptions);
  expect(rendered.intents.some(({ kind }) => kind === 'permission')).toBe(true);
});
```

- [ ] **Step 3: Map commands/agents/status/permissions only through adapter-owned renderers**

```ts
if (adapter.capabilities.commands === 'native') intents.push(...renderCommands(adapter));
if (adapter.capabilities.agents === 'native') intents.push(...renderAgents(adapter));
const status = renderStatus(adapter);
if (status.intent) intents.push(status.intent);
else diagnostics.push(status.diagnostic ?? `${adapter.displayName}: use \`monomind status --json\`.`);
if (adapter.capabilities.permissions === 'native') intents.push(...renderPermissions(adapter));
```

- [ ] **Step 4: Run focused verification**

```bash
pnpm --filter @monoes/monomindcli exec vitest run __tests__/platform-adapters/enhancement-parity.test.ts __tests__/commands/status.test.ts
```

Expected: PASS; native command names don't collide with the legacy `/mastermind:*` set still shipping from Task 2 (collision analysis included); every platform exposes a status path; per-platform agent tool-policy fixtures pass.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/platform-adapters packages/@monomind/cli/src/commands/status.ts packages/@monomind/cli/src/init
git commit -m "feat(platforms): add commands agents status and permission parity"
```

### Task 6: Rebuild hooks as optional, platform-specific contracts (M2)

**Files:**
- Create: `src/platform-adapters/renderers/hooks.ts`, `src/platform-adapters/hook-bridge.ts`
- Create: `__tests__/platform-adapters/hooks.test.ts`
- Modify: `src/init/codex-generator.ts`, `src/init/opencode-generator.ts`, `src/init/kimi-generator.ts`, `src/init/helpers-generator.ts` (**the bridge sources live in the generators, not the write-*.ts executors — v2's Modify list couldn't reach the code it had to replace**), `src/init/write-codex.ts`, `src/init/write-opencode.ts`, `src/init/write-kimicode.ts`, `src/commands/platforms.ts`

**Interfaces:**
- Neutral decision contract (**not** Claude exit codes):

```ts
export interface NormalizedHookEvent {
  event: 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionEnd';
  tool: string;
  cwd: string;
  sessionId: string;              // every existing bridge forwards it; v2 dropped it
  input: Record<string, unknown>;
}
export type HookDecision = { action: 'allow' | 'block' | 'observe'; reason?: string };
export interface HookPolicy { mode: 'observe' | 'block'; timeoutMs: Partial<Record<NormalizedHookEvent['event'], number>>; }
export const DEFAULT_TIMEOUTS = { PreToolUse: 2000, PostToolUse: 10000, SessionStart: 2000, SessionEnd: 2000 };
```

- Each **platform renderer** owns the decision→transport mapping: exit 0/2 + stderr JSON for Claude/Codex/Kimi (documented Claude-protocol), thrown error inside `tool.execute.before` for opencode, platform-documented JSON decision for Cursor/Droid/Antigravity — each proven by that adapter's fixture.
- **Timeout units are per-platform renderer data and tested** (Codex TOML uses *seconds*; Cursor/Kimi JSON use *milliseconds* — `codex-generator.ts:111,120` ships `timeout = 5`/`10` (seconds) while `platforms.ts:241` ships `timeout = 5000` (ms) into the same Codex TOML schema, a 1000× bug this task eliminates).
- One CLI flag: `--enable-blocking-hooks` (also accepted as `--enable-hooks` alias). Default policy is `observe` for **new** installs; **existing installs that had enforcement keep it** and receive a one-time diagnostic explaining the opt-out — silently downgrading the `.env`/secret gates to observe for upgrading users would neuter them.
- Hermes and Zed hooks are `unsupported` (verified: Hermes has none; Zed has none documented). Codex hooks render only with the `[features] hooks` flag + trust-gate note, matching Codex's own default-off.

- [ ] **Step 1: Write hook input, decision, unit, and failure-mode tests**

```ts
it('never converts a bridge failure into a blocked tool call in observe mode', async () => {
  const decision = await runHook({ event: 'PreToolUse', tool: 'shell_command', cwd: '/x', sessionId: 's1', input: {} },
                                 { mode: 'observe', timeoutMs: { PreToolUse: 20 } });
  expect(decision.action).toBe('allow');
});

it('renders no SessionStart prompt injection for any platform', () => {
  for (const platform of PLATFORM_IDS) {
    if (PLATFORM_REGISTRY[platform].capabilities.hooks === 'native') {
      expect(renderHooks(PLATFORM_REGISTRY[platform], testOptions)).not.toContain('SessionStart prompt');
    }
  }
});

it.each([{ platform: 'codex', unit: 'seconds' }, { platform: 'kimi', unit: 'milliseconds' }] as const)
('%s hook timeouts render in %s', ({ platform, unit }) => {
  const rendered = renderHooks(PLATFORM_REGISTRY[platform], { ...testOptions, enableHooks: true });
  expect(assertTimeoutUnit(rendered, unit)).toBe(true);
});
```

- [ ] **Step 2: Implement the neutral bridge with repo input guards**

The bridge validates stdin payloads with the repo's Zod conventions (`src/utils/input-guards.ts`), imports runtime-neutral policy code, never sets `CLAUDE_PROJECT_DIR`, never assumes a Claude tool name, never prints human-readable text on protocol stdout, and never exits non-zero in observe mode. `helpers-generator.ts` defines where this neutral code ships; `.claude/helpers` becomes a render target only.

- [ ] **Step 3: Replace all generator-defined bridges calling `.claude/helpers` directly**

Codex, opencode, and kimi generators' embedded bridge scripts are replaced by renderer-emitted bridges importing the neutral module. A benchmark step measures real PreToolUse/PostToolUse handler latency (node spawn + SQLite touch) before the default budgets are considered final; budgets are recorded in the task notes.

- [ ] **Step 4: Run focused verification**

```bash
pnpm --filter @monoes/monomindcli exec vitest run __tests__/platform-adapters/hooks.test.ts
```

Expected: PASS; each native hook adapter parses its platform's sample stdin, returns the required decision shape, completes within its rendered budget, fails open in observe mode, and renders timeout values in the platform's unit.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/platform-adapters packages/@monomind/cli/src/init packages/@monomind/cli/src/commands/platforms.ts
git commit -m "feat(platforms): add opt-in native hook contracts with per-platform mappings"
```

### Task 7: Implement every platform renderer and experimental discovery probes (M1 for core renderers; enhancement data supports M2)

**Files:**
- Create: `src/platform-adapters/renderers/{claude,gemini,cursor,vscode,copilot,opencode,aider,kiro,openclaw,droid,antigravity,codex,kimi,zed,experimental}.ts` — **fifteen files: fourteen dedicated renderers (v2 omitted `vscode.ts`, leaving a full-parity platform rendererless) plus `experimental.ts` serving exactly `{trae, hermes}` and discovery-fallback enhancement data for antigravity/zed**
- Create: `src/platform-adapters/discovery.ts`
- Create: `__tests__/platform-adapters/discovery.test.ts`

**Interfaces:**
- Every renderer implements `render(adapter, request): PlatformPlan` and may only emit artifacts its registry capability row declares.
- `discover(commandRunner, adapter): DiscoveryResult` for `requiresDiscovery` adapters (trae, hermes, antigravity, zed) **and** the MCP file-location probes for droid/kimi before their `native` MCP entries are trusted. OpenClaw project MCP is always `cli_fallback`; user-scope OpenClaw discovery validates only the explicit user config path:

```ts
export interface DiscoveryResult {
  available: boolean;
  version?: string;
  paths: Readonly<Record<string, string>>;
  features: ReadonlySet<Capability>;
  verification: Partial<Record<Capability, VerificationLevel>>;
  diagnostics: readonly string[];
}
```

- [ ] **Step 1: Write the adapter completeness and gating test**

```ts
it.each(PLATFORM_IDS)('%s resolves to a renderer', (platform) => {
  expect(getRenderer(platform)).toBeDefined();
});

it('does not enable experimental features when discovery is missing', async () => {
  const plan = await planInstall({ platform: 'trae', scope: 'project', path: fixtureRoot, discovery: unavailableDiscovery('trae') });
  expect(plan.intents.some(({ kind }) => kind === 'hook')).toBe(false);
  expect(plan.diagnostics).toContain('Trae: native enhancements require successful discovery.');
});
```

(`unavailableDiscovery` builds a full `DiscoveryResult` with `available: false` — v2's partial literal `{ available: false }` did not typecheck against the interface.)

- [ ] **Step 2: Implement each renderer with a narrow responsibility**

Shared content via `renderCoreArtifacts`; native enhancements only for `native` capabilities with registry evidence; `experimental` and discovery-only capabilities emit nothing without a successful discovery result that identifies the location and parser/schema or runtime evidence; dedicated parsers per format. `.agents/skills` is the authoritative portable root for documented compatible adapters; a platform-owned skill root is emitted only with `--mirror-platform-skills` and gains its own marker/uninstall fixture. Kimi's renderer verifies the AGENTS.md instruction surface as part of its fixture (unverified in current docs) — if unverifiable, downgrade the matrix cell to `cli_fallback` and record it. Discovery cannot promote a capability to `native` unless its `verification` entry is `schema` or `runtime`.

- [ ] **Step 3: Run focused verification**

```bash
pnpm --filter @monoes/monomindcli exec vitest run __tests__/platform-adapters/discovery.test.ts __tests__/platform-adapters/registry.test.ts
```

Expected: PASS; all sixteen renderers resolve; discovery failure yields zero unverified native artifacts; no renderer writes outside its scope.

- [ ] **Step 4: Commit**

```bash
git add packages/@monomind/cli/src/platform-adapters
git commit -m "feat(platforms): implement native and discovered renderers"
```

### Task 8: Replace legacy platform commands and migrate every existing installation surface (M1)

**Files:**
- Modify: `src/commands/platforms.ts`, `src/commands/init.ts`, `src/init/executor.ts`, `src/init/write-claude.ts`
- Create: `src/platform-adapters/migration.ts`
- Create: `__tests__/platform-adapters/migration.test.ts`, `__tests__/platform-adapters/doctor.test.ts`

**Interfaces:**
- `monomind platforms install --platform <id|alias> [--scope project|user] [--yes] [--dry-run] [--enable-blocking-hooks]` (`--scope user` requires `--yes`; read-only `plan` and `doctor` never do)
- `monomind platforms upgrade --all [--scope project|user] [--yes] [--dry-run]` (`--scope user` requires `--yes`)
- `monomind platforms doctor [--platform <id>] [--scope project|user] [--json]` (read-only; scope defaults to project)
- `monomind platforms uninstall --platform <id|alias> [--scope project|user] [--yes] [--remove-legacy]` (`--scope user` requires `--yes`, including legacy removal)
- `runPlatformsDoctor(request): Promise<readonly PlatformDoctorReport[]>` — implemented in this task before the Task 9 MCP wrapper is registered. `--json` belongs to the CLI formatter, not this domain function.
- `monomind platforms setup …` — **deprecation shim for one full release cycle**: detects legacy artifacts, prints the replacement (`platforms install --scope user --yes` + automatic legacy cleanup), runs the migration detector, exits 0. Then removed per the deprecation-cycle definition.
- **Init contract:** keep `--target {all,claude,antigravity,opencode,kimicode,codex}` semantics exactly (no silent 5→16 expansion of `--target all`); add `--platform <id>[,<id>]` accepting registry ids and aliases (`resolvePlatformId` normalizes `kimicode`→`kimi`); component booleans (`--opencode`, `--kimicode`, `--codex`, `--only-claude`, `--skip-claude`) keep working, mapped through the registry. The executor loop consumes a real `selectedPlatforms` derived from those flags — v2's variable existed nowhere.
- `--remove-legacy` on uninstall MAY remove Monomind-owned legacy artifacts (marker-verified only); without it they are reported, never deleted. A user-scope legacy migration also requires `--yes` before it obtains its lock or creates a backup. Removal is always file-level, never directory-level, for the shared `.agents/skills`/`~/.agents/skills` roots — a shared directory is deleted only when no other still-installed platform's registry entry references it.

- [ ] **Step 1: Implement `LEGACY_SURFACE_INVENTORY` — all fourteen rows, one fixture each (v2 covered three)**

| # | Legacy surface | Evidence | Action |
|---|---|---|---|
| 1 | Codex `[[hooks]]` SessionStart activation block in `~/.codex/config.toml` + `~/.codex/monomind-activate.cjs` | `platforms.ts:221-260` | Remove owned block; delete script; keep user hooks |
| 2 | Cursor SessionStart hook in **project** `.cursor/settings.json` + `~/.cursor/monomind-activate.cjs` | `platforms.ts:262-318` | Remove owned named entry (JSON, not marker); delete script |
| 3 | `~/.gemini/antigravity-cli/plugins/monomind/` plugin dir | `platforms.ts:320-387` | Remove dir (Monomind-authored plugin.json) |
| 4 | `~/.agents/skills/mastermind-*` and `~/.gemini/skills/mastermind-*` shared roots | `installMastermindSkills` | Report; remove only with `--remove-legacy`, and only the individual Monomind-owned files (marker/frontmatter-verified) — **never the shared directory itself while another installed platform still owns files there** (up to 12 of 16 platforms share `.agents/skills`) |
| 5 | `.claw/config.md` + legacy id `claw` | `platforms.ts:43` | Migrate content to OpenClaw adapter artifacts; normalize id |
| 6 | `.cursorrules` managed block | `platforms.ts:36` | Remove owned block (deprecated file; adapter stops writing it) |
| 7 | `DROID.md` managed block | `platforms.ts:44` | Remove owned block; droid adapter writes AGENTS.md |
| 8 | `.agents/rules/monomind.md` (antigravity) | `platforms.ts:45` | Remove owned frontmattered block |
| 9 | `.trae/rules/monomind.md` | `platforms.ts:42` | Migrate to trae adapter marker scheme |
| 10 | `HERMES.md` | `platforms.ts:46` | Remove owned block; hermes adapter writes per discovery |
| 11 | `.kiro/steering/monomind.md` bare marker | `platforms.ts:41` | Upgrade marker in place (surface retained) |
| 12 | `.aider.conf.yml` **corrupted with HTML-comment blocks** | `platforms.ts:40,74` | De-corrupt: strip `<!-- -->` block from YAML; re-add conventions via documented `read:` key |
| 13 | Bare `<!-- monomind:start -->` / `# monomind:start` blocks in every still-owned instruction file (CLAUDE.md, GEMINI.md, AGENTS.md, `.github/copilot-instructions.md`, `.cursor/rules/monomind.mdc`) | `platforms.ts:70-71,501,514` | Marker upgrade: rewrite to new per-artifact-per-platform marker on `upgrade` |
| 14 | Global `~/.claude/CLAUDE.md` append + global settings SessionStart hook written by project init | `write-claude.ts:262-351` | Remove owned block/hook; scope-gate any replacement behind `--scope user --yes` |

- [ ] **Step 2: Write failing migration tests (one per inventory row; three shown)**

```ts
it('removes the obsolete Codex activation block without removing user hooks', async () => {
  const result = await migrateLegacyInstall(fixture('codex-legacy-config.toml'));
  expect(result.content).not.toContain('monomind-activate.cjs');
  expect(result.content).toContain('# user hook');
});

it('de-corrupts .aider.conf.yml and re-registers conventions via read:', async () => {
  const result = await migrateLegacyInstall(fixture('aider-corrupted-conf.yml'));
  expect(parseYaml(result.content)).toBeTruthy();            // must parse as YAML
  expect(result.content).not.toContain('<!--');
  expect(result.content).toMatch(/read:\s*[\["]?CONVENTIONS\.md/);
});

it('upgrades bare markers in AGENTS.md without losing sibling content', async () => {
  const result = await migrateLegacyInstall(fixture('agents-md-legacy-block.md'));
  expect(result.content).toContain('monomind:start instructions:codex');
  expect(result.content).toContain('monomind:start instructions:opencode');
});

it('uninstalling one platform with --remove-legacy preserves a shared skill root still used by a sibling platform', async () => {
  const directory = await copyFixture('shared-agents-skills', 'pristine'); // codex + opencode both installed, sharing .agents/skills
  await uninstallPlatform({ platform: 'codex', path: directory, scope: 'project', removeLegacy: true });
  expect(existsSync(join(directory, '.agents/skills'))).toBe(true);
  expect(existsSync(join(directory, '.agents/skills/mastermind-plan'))).toBe(true); // still owned by opencode
});
```

- [ ] **Step 3: Remove old setup behavior, keep detection**

Delete `MASTERMIND_ACTIVATE_SCRIPT`, `setupCodex`, `setupCursor`, `setupAntigravity` once the shim + inventory exist. Detection never deletes files lacking a Monomind ownership marker (frontmatter, marker, or Monomind-authored filename).

- [ ] **Step 4: Rewire init to adapters and de-duplicate `.mcp.json`**

Executor dispatches through `installPlatform` for registry-selected platforms; `write-claude.ts` keeps only project-scope writes; `mcp-generator.ts` is the single `.mcp.json` writer via `renderers/mcp.ts`. Worktree awareness: `_registerMonomindProject` skips `.worktrees/**` paths so worktree sessions don't register as separate projects for `upgrade --all`.

- [ ] **Step 5: Implement the platform doctor before its MCP wrapper exists**

Create the typed report and CLI action in `operations.ts`/`platforms.ts`; Task 9 may only import this completed interface:

```ts
export interface PlatformDoctorReport {
  platform: PlatformId;
  capabilities: Record<Capability, SupportLevel>;
  verification: Record<Capability, VerificationLevel>;
  artifacts: readonly { path: string; state: 'managed' | 'missing' | 'legacy' | 'foreign' }[];
  legacy: { findings: readonly string[]; migratable: boolean };
  diagnostics: readonly string[];
  sanitized: true;
}

export async function runPlatformsDoctor(request: {
  platform?: PlatformId;
  path: string;
  scope: 'project' | 'user';
}): Promise<PlatformDoctorReport[]> {
  // Read-only: resolve registry capabilities, inspect managed markers and legacy signatures,
  // redact absolute user paths, and never call applyPlan or migration routines.
}
```

Write `__tests__/platform-adapters/doctor.test.ts` in this task. It must prove that JSON output exactly mirrors the evidence-gated `PLATFORM_REGISTRY`, reports legacy Codex injection without modifying it, redacts the user home directory, and makes no writes.

- [ ] **Step 6: Run migration and doctor verification**

```bash
pnpm --filter @monoes/monomindcli exec vitest run __tests__/platform-adapters/migration.test.ts __tests__/platform-adapters/doctor.test.ts __tests__/commands/platforms.test.ts
```

Expected: PASS; all four platform subcommands plus the `setup` shim use the registry; `--platform claw` still installs the OpenClaw adapter; `--target`/component flags behave exactly as before; dry-run is mutation-free; all fourteen legacy surfaces migrate; uninstall is idempotent; platform doctor is read-only and ready for the Task 9 MCP wrapper.

- [ ] **Step 7: Commit**

```bash
git add packages/@monomind/cli/src/commands packages/@monomind/cli/src/init packages/@monomind/cli/src/platform-adapters
git commit -m "refactor(platforms): migrate all legacy installers to adapter operations"
```

### Task 9: Register platform diagnostics over MCP, then prove fixtures and smoke (M1)

**Files:**
- Create: `src/mcp-tools/platforms-tools.ts` (**before the smoke test that asserts it — v2 had this inverted across Tasks 9/10**)
- Modify: `src/mcp-client.ts` (add `platforms` to `CATEGORY_LOADERS` **and** `CORE_TOOL_CATEGORIES`, `mcp-client.ts:36-65,121-135` — without the roster change the tool is invisible on `tools/list`)
- Modify: `src/mcp-tools/index.ts`, `src/__tests__/mcp-roster-filter.test.ts` (same commit)
- Create: `__tests__/platform-adapters/fixtures/` + `fixtures-helper.ts` (one `mkdtemp(join(tmpdir(), 'mm-fix-'))` + recursive copy helper reused everywhere)
- Create: `__tests__/platform-adapters/fixtures.test.ts`, `__tests__/platform-adapters/smoke.test.ts`
- Create: `src/platform-adapters/docs.ts`, `docs/platforms/compatibility.md`
- Modify: `.github/workflows/tests.yml`, `src/commands/platforms.ts` (`platforms docs [--check]`)

**Interfaces:**
- `platforms_doctor` MCP tool: thin wrapper over the doctor orchestration; registered in a core category; visible on `tools/list` without `MONOMIND_MCP_FULL`.
- One fixture per platform: pristine, user-customized, malformed, legacy (the openclaw legacy fixture uses the old `claw` id + `.claw/config.md`).
- `renderCompatibilityMatrix(registry): string` is the only producer of the public table; `platforms docs --check` exits non-zero on drift and CI enforces it.

- [ ] **Step 1: Register the MCP tool and amend the roster test**

```ts
it('exposes the same report through the platforms_doctor MCP tool', async () => {
  const tools = await getAllMCPTools();            // real helper (src/mcp-client.ts:422); v2's listMcpTools() does not exist
  expect(tools.map((t) => t.name)).toContain('platforms_doctor');
  const listed = await listMCPTools();             // core-advertised only (mcp-client.ts:388)
  expect(listed.map((t) => t.name)).toContain('platforms_doctor');
});
```

- [ ] **Step 2: Write the fixture matrix test (including shared-file contention)**

```ts
it.each(PLATFORM_IDS)('%s fixture supports plan, apply, upgrade, and uninstall', async (platform) => {
  const directory = await copyFixture(platform, 'user-customized');
  const first = await installPlatform({ platform, path: directory, scope: 'project' });
  const second = await installPlatform({ platform, path: directory, scope: 'project' });
  const removed = await uninstallPlatform({ platform, path: directory, scope: 'project' });
  expect(first.changed.length).toBeGreaterThan(0);
  expect(second.changed).toEqual([]);
  expect(removed.diagnostics.filter((line) => line.startsWith('ERROR:'))).toEqual([]);
});

it('install-all then uninstall-one preserves sibling blocks in shared files', async () => {
  const directory = await copyFixture('shared-agents-md', 'pristine'); // AGENTS.md written by codex+opencode+kimi+droid+openclaw
  await installPlatform({ platform: 'codex', path: directory, scope: 'project' });
  await installPlatform({ platform: 'opencode', path: directory, scope: 'project' });
  await uninstallPlatform({ platform: 'codex', path: directory, scope: 'project' });
  const content = readFileSync(join(directory, 'AGENTS.md'), 'utf8');
  expect(content).toContain('monomind:start instructions:opencode');
});
```

- [ ] **Step 3: Add two-layer smoke checks**

(a) **String-level:** every adapter renders the documented MCP command per OS (`npx -y monomind@latest mcp start` POSIX; the Windows variant from `renderers/mcp.ts`) — OS-parametrized unit test, no Windows runner needed. (b) **Behavioral:** spawn the **locally built** CLI (`node bin/cli.js mcp start`, after `run build`) using the established pattern from `__tests__/mcp-stdio-integration.test.ts` (NDJSON initialize → tools/list, 20s budget), asserting `monograph_query`, `knowledge_search` (and/or `memory_kg_search`) — **`memory_search` does not exist and is never asserted** — plus `platforms_doctor`. For hook-capable targets, feed saved sample stdin payloads to the bridge and assert `allow`/`observe` decisions with zero exit in observe mode.

- [ ] **Step 4: Generate compatibility documentation and enforce freshness**

`renderCompatibilityMatrix` emits the 9-capability table (+ `activation` notes and `requiresDiscovery` markers) from the registry; `platforms docs --check` diffs it against `docs/platforms/compatibility.md`; `tests.yml` gains the check as a step on the ubuntu cli job.

- [ ] **Step 5: Run full package verification**

```bash
pnpm --filter @monoes/monomindcli test && pnpm --filter @monoes/monomindcli run build && pnpm lint
```

Expected: PASS. Any pre-existing unrelated failure: record exact command, package, test name, error — do not label the release verified.

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/src/mcp-tools packages/@monomind/cli/src/mcp-client.ts packages/@monomind/cli/src/__tests__/mcp-roster-filter.test.ts packages/@monomind/cli/__tests__/platform-adapters packages/@monomind/cli/src/platform-adapters/docs.ts docs/platforms .github/workflows/tests.yml
git commit -m "feat(platforms): expose diagnostics over MCP and prove compatibility contracts"
```

### Task 10: Release safely under the patch-version policy (M1 exit, repeated for M2)

**Files:**
- Modify: `CHANGELOG.md` (root — entries under `[Unreleased]`, moved under the `2.9.26`/`2.9.27` patch headers at release; `scripts/check-publish-versions.mjs` must pass)
- Modify: `src/commands/update.ts` — **specified change** (v2 listed it with none): `update all` prints a one-time hint to run `monomind platforms upgrade --all` when a legacy-surface marker exists; migration itself never runs inside the updater
- Modify: `docs/platforms/migration-guide.md`

- [ ] **Step 1: Write release and clean-home acceptance tests**

```ts
it('reports native capabilities and legacy migration advice as structured JSON in a clean home', async () => {
  const [report] = await runPlatformsDoctor({
    platform: 'codex', path: fixture('legacy-codex'), scope: 'project',
  });
  expect(report.platform).toBe('codex');
  expect(['native', 'experimental']).toContain(report.capabilities.skills);
  if (report.capabilities.skills === 'native') expect(['schema', 'runtime']).toContain(report.verification.skills);
  expect(report.legacy.findings).toContain('Remove Monomind SessionStart protocol injector.');
  expect(report.sanitized).toBe(true); // absolute paths redacted per update.ts precedent
});
```

Doctor implementation belongs to Task 8. This release task validates its clean-home behavior: **`platforms doctor` is the one CLI surface** (with `--json`); top-level `doctor` gains a `platforms` **component** (29th category, one-line-per-adapter summary pointing at `platforms doctor`); `platforms_doctor` is the MCP wrapper. No `doctor --platform` flag.

- [ ] **Step 2: Add migration guidance with exact safety behavior**

Document: the upgrade disables only Monomind-marked legacy prompt injection; user hooks/configuration are preserved; a timestamped backup precedes any schema rewrite; a full runtime restart is required to reload hook configuration; `claw`→`openclaw` and `kimicode`→`kimi` normalize transparently; existing hook enforcement is preserved with a one-time diagnostic; `platforms setup` is a deprecation shim for one release cycle.

- [ ] **Step 3: Validate release candidates**

CI (ubuntu): full suite + build + lint + `platforms docs --check` + OS-parametrized rendering tests. Clean-machine validation in an isolated `HOME`: initialize a temp repo, install one adapter per milestone scope, run `monomind platforms doctor --json`, assert report matches the registry. Live third-party CLI runs (hermes/antigravity/droid binaries) are an **env-gated optional job or manual release checklist item** — runners do not have them. macOS execution is a manual checklist item (no macOS runner).

- [ ] **Step 4: Run final verification**

```bash
CI=true pnpm test:all && pnpm --filter @monoes/monomindcli run build && pnpm lint && node scripts/check-publish-versions.mjs
```

Expected: PASS; compatibility doc matches registry; no legacy SessionStart injection code remains; smoke suites green; versions are patch-only (2.9.26 M1, 2.9.27 M2).

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md docs/platforms packages/@monomind/cli/src/commands
git commit -m "docs(platforms): publish parity migration guide and patch release"
```

## Acceptance gates (milestone-tagged; each stated as a testable claim)

1. **(M1)** One registry (16 platforms × 9 capabilities plus exact-capability verification evidence) is the sole source for `init`, `platforms`, monograph skill installation, monograph build-tool enums, doctor, tests, and generated documentation — verified by a snapshot and registry-validation test. The generated matrix reports the evidence-gated state rather than an aspirational native claim.
2. **(M1)** `claw`→`openclaw` and `kimicode`→`kimi` resolve everywhere ids are accepted; existing installs migrate without losing user content — verified by the fourteen-row legacy-inventory fixture suite.
3. **(M1)** Every target provides the project instruction, router path, portable skill path, and MCP outcome that its declared verified contract permits (`native` artifact or tested CLI fallback). Discovery/fallback-only surfaces receive a diagnostic, never a fabricated file; the fallback commands (`monomind mastermind run --print`, `monomind status --json`, `monomind platforms doctor`) exist, execute, and are covered by tests.
4. **(M1)** Every `SKILL.md` validates `name`+`description`; no generated skill relies on Claude-only variables, paths, or tool names; every relative link resolves inside its package (references/ included).
5. **(M1)** No generated configuration injects the Mastermind protocol at SessionStart — tested as: rendered hook config for every platform contains no protocol-injection payload (the stronger form; "full protocol" was untestable).
6. **(M1)** Install, upgrade, uninstall, and legacy migration are idempotent, preserve user content, and survive sibling-block contention in shared files — verified per-platform fixtures plus the shared-AGENTS.md test. Every user-scope mutation rejects without `--yes`, uses the private scope-specific backup/lock roots, and no stale lock is auto-deleted.
7. **(M1)** `monomind platforms doctor --json` and the `platforms_doctor` MCP tool report capability levels and verification evidence **identical to `PLATFORM_REGISTRY`** (test-compared), are core-advertised on `tools/list`, and sanitize absolute paths.
8. **(M1)** The public compatibility table is generated from the registry, includes Kimi Code and Zed, and CI fails on drift (`platforms docs --check`).
9. **(M1/M2)** Focused tests, `CI=true pnpm test:all`, package build (tsc), root lint, and the local-bin MCP smoke suite pass; hook contracts pass additionally for M2.
10. **(M2)** Hooks are opt-in, platform-specific, payload-tested, render timeout values in each platform's unit (no seconds/milliseconds mixups), and fail open in observe mode; existing enforced installs keep enforcement.
11. **(M2)** Per-hook latency is benchmarked and recorded; default budgets (`PreToolUse` 2s, `PostToolUse` 10s) meet or exceed measured handler latency.
12. **(M1/M2)** A platform earns a `native` capability only after the generated artifact is accepted by that platform's documented parser/schema or by an environment-gated real-runtime smoke test. Monomind-owned fixtures alone prove renderer behavior, not upstream compatibility; an unverified cell remains `experimental` or `cli_fallback` in the generated matrix.
13. **(M1, independent-review addition)** Every `capabilities[x] === 'native'` cell in the committed `PLATFORM_REGISTRY` has a `verification[x]` of `'schema'` or `'runtime'` recorded in `docs/platforms/verification-ledger.md`, citing this document's evidence for it — verified by `assertRegistryIsVerifiable` plus the ledger-citation test; any cell without that citation ships as `experimental`/`cli_fallback`, not `native`.
14. **(M1, independent-review addition)** `--remove-legacy` never deletes a shared skill root still referenced by another installed platform — verified by the shared-root uninstall fixture in Task 8.

## Risks and decisions

- **Do not promise identical user interfaces.** Aider has no skill/hook/status equivalent; Hermes has no hooks; Zed has no hooks. Parity is the same workflow and tools through concise conventions plus CLI/MCP fallback.
- **Do not automatically enable unverified integration points.** Trae and Hermes require version discovery; Antigravity requires a 2.0-vs-CLI surface decision; droid/kimi command surfaces stay `experimental`/`manual-step` until fixtures pass; the openclaw/droid/kimi MCP file locations are probed before their `native` entries are trusted.
- **Do not use hooks as a prompt delivery mechanism.** The existing Codex errors — and the 1000× timeout-unit disagreement this review found in the same file — demonstrate why they must be isolated from instruction loading.
- **Do not let format conversion be lossy.** Canonical skill content is neutral; renderers add wrappers but never rewrite procedural meaning. JSONC files parse tolerantly; TOML never round-trips full-file.
- **Treat user scope as explicit, double-confirmed consent.** The statusline/global-writes audit found project init currently violating this; only `--scope user --yes` may mutate it, and the migration fixes rather than preserves that behavior.
- **Treat platform ids as a published API.** Aliases are permanent (`claw`, `kimicode`); removals follow the defined deprecation cycle (one release with shim + doctor warning).
- **A fallback named in a contract must exist before the contract ships.** v2 promised `mastermind run`, asserted `platforms_doctor`, and named `status --json` — the first two now precede their assertions, and the third is fixed before being named.
- **The shipped `.claude/` tree is the canonical skill source.** A parallel `assets/` tree would not ship to npm and would fork 68 existing packages — the exact drift disease this revision cures.
- **`.agents/skills` is the portable default where documented** (12 of 16 platforms) — but never assume it is universal (Claude, Kiro, Aider).
- **Windows is rendering-tested, not execution-tested**, until the documented node-gyp breakage is resolved.
- **Do not infer upstream acceptance from our own fixtures.** Per-platform fixture tests prove safe installation and removal; official schema validation or an environment-gated installed runtime proves the target accepts the generated artifact. Until that second proof exists, the registry must not report `native`.
- **Version discipline is absolute:** patch-only (2.9.26 → 2.9.27), back-compat shims for one cycle, auto-updater rollout safety verified by the clean-HOME validation.

## Research sources consulted (verified 2026-08-23; dead/moved URLs corrected)

- [Claude Code: features](https://code.claude.com/docs/en/features-overview), [skills](https://code.claude.com/docs/en/skills), [hooks](https://code.claude.com/docs/en/hooks)
- [Gemini CLI: hooks](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md), skills & settings via the GitHub `docs/` tree (gemini-cli.google.com fetches are unreliable)
- [Cursor: skills](https://cursor.com/docs/context/skills), [hooks](https://cursor.com/docs/agent/hooks), [rules](https://cursor.com/docs/context/rules)
- [VS Code: agent skills](https://code.visualstudio.com/docs/agent-customization/agent-skills) (docs tree restructured from `/docs/copilot/*`), custom instructions, MCP servers
- [Copilot CLI: skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills), [hooks](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks)
- [OpenCode: skills](https://opencode.ai/docs/skills/), commands, agents, MCP
- [Aider: config](https://aider.chat/docs/config/aider_conf.html) (`read:` key), conventions
- [Kiro: steering](https://kiro.dev/docs/steering/), [skills](https://kiro.dev/docs/skills/), custom agents, MCP, hooks
- Trae: docs.trae.ai exists but is not fetch-verifiable — discovery-gated by design
- [OpenClaw: skills](https://docs.openclaw.ai/tools/skills), MCP, hooks
- [Droid: skills](https://docs.factory.ai/harness/skills), [hooks](https://docs.factory.ai/harness/hooks), [MCP](https://docs.factory.ai/harness/mcp)
- [Antigravity: skills](https://antigravity.google/docs/skills), [hooks](https://antigravity.google/docs/hooks), plugins, CLI plugins
- [Hermes Agent: docs](https://hermes-agent.nousresearch.com/docs), skills, MCP
- [Codex: config reference](https://learn.chatgpt.com/docs/config-file/config-reference) (developers.openai.com/codex/cli/config is 404), [skills](https://learn.chatgpt.com/docs/build-skills.md), hooks
- [Kimi Code: skills](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html), [plugins](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html), MCP, config files
- [Zed: agents](https://zed.dev/docs/ai/agents), instructions, skills, agent profiles, MCP (`context_servers`)

## Self-review

- **Coverage:** Registry and contractual matrix with exact-capability verification evidence; scope-aware typed locations and artifacts; canonical skills in the shipped tree with references; multi-format safe merges; verified core surfaces for all 16 targets; enhancement renderers with per-platform tool policies; decision-based hook contracts with unit-correct timeouts; fifteen renderer files covering sixteen ids; a fourteen-row legacy migration inventory; init contract with stable `--target`; MCP diagnostics registered and core-advertised before being asserted; two-layer smoke tests against the local binary; registry-generated docs with CI drift checks; patch-disciplined release with migration guide.
- **Verified against the repo (2026-08-23, six-agent swarm):** every file path, package name, script name, tool name, count, and legacy surface cited in this plan was checked against the working tree, including live `pnpm --filter` runs. Platform surfaces were verified against current official documentation; corrections (Droid MCP file, Codex skill roots, Antigravity vs Gemini paths, Zed layout, Hermes identity, timeout units) are incorporated into the tables above.
- **Known limitations:** Trae and Hermes native layouts remain discovery-gated (unverifiable documentation); Kimi's AGENTS.md surface is verify-in-fixture; live Windows/macOS execution is out of CI scope; per-hook latency budgets are provisional until the Task 6 benchmark records real numbers.
- **Consistency:** `InstallRequest`, `PlatformPaths`, `DiscoveryResult`, `HookDecision`, `ArtifactIntent`, and the evidence-gated capability matrix are each defined exactly once before their consumers; every fallback named in a capability contract has a preceding implementation step; milestones tag every task and gate.
- **v5 review outcome:** Fixed the remaining project/user path ambiguity, forbidden unsupported instruction artifacts, required registry-level upstream verification for `native`, made user writes double-confirmed and recoverable, and aligned the doctor API with its tests. The only deliberate uncertainty remains behind discovery or fallback rather than being silently rendered.
- **Independent review addendum (2026-08-24):** confirmed the Task 4 experimental-capability gap and the Hermes/Antigravity fake-instruction contradiction from an earlier pass are genuinely fixed by v7's evidence-gating and `PlatformPaths` model. Closed the one gap that design introduced — `assertRegistryIsVerifiable` had a test but no data to check, and no task populated `verification`; Task 1 now derives it from citations already in this document and records them in `docs/platforms/verification-ledger.md`, with a ledger-citation test so a capability can't be silently promoted to `native` without evidence. Also fixed a citation carried unchanged since v3 (the Codex hook-schema bug spans `platforms.ts:241` and `codex-generator.ts:111,120`, not one line pair in one file) and closed the shared-`.agents/skills`-root deletion-safety gap in Task 8's legacy inventory and `--remove-legacy` flag description, since this revision made that root the sole authoritative one for 12 of 16 platforms.
- **Placeholder scan:** no implementation task defers a required behavior without a named interface, concrete files, test, expected result, and acceptance condition. The two v2 items that violated this (`update.ts` with no stated change; "pipe to the configured agent CLI") are respectively specified and cut.
