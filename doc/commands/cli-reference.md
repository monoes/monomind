# CLI Command Reference

> All 32 top-level `monomind` commands, verified against `packages/@monomind/cli/src/commands/index.ts:15-49` (the `COMMAND_LOADERS` map) plus a live `node bin/cli.js --help` run on the built dist (reported `v2.9.3`). The category grouping is defined statically in `CATEGORY_NAMES` (`src/commands/index.ts:68-74`); real `Command` objects are attached on demand by `getCommandsByCategory()` (`src/commands/index.ts:141-150`) and `loadAllCommands()` (`src/commands/index.ts:126-130`), with `getCommand`/`getCommandAsync` as the single-command entry points (`src/commands/index.ts:106-112`). Subcommand counts for `doc`, `analyze`, and `org` are read directly from each command's own `subcommands:` array, not estimated.

**Note on `--help` coverage:** a live run of `monomind --help` (v2.9.3) shows all 32 commands except `report-crash` — including `org`, `design`, and `crash-reporting`, which a prior version of this note incorrectly claimed were missing (re-checked directly against `getCommandsByCategory()`, `index.ts:141-150`, and the actual CLI output — all three are present). `report-crash` alone is absent, and that's intentional: it's the only command with `hidden: true` (`report-crash.ts:16`), an internal command shelled out to by monotask/mono-clip crash handlers, not meant for interactive use. This doc lists all 32 regardless of what `--help` shows.

## Full command list (32)

| Command | Purpose | Subcommands |
|---|---|---|
| `init` | Initialize all supported coding systems by default: Claude Code, Antigravity, OpenCode, Kimi Code, and Codex. Use `--target <system>` for one system (`claude`, `antigravity`, `opencode`, `kimicode`, or `codex`); `--codex`, `--opencode`, and `--kimicode` remain aliases. Skills are written to `.claude/skills/` and mirrored to `.gemini/skills/` and `.agents/skills/` for multi-runtime support. | 5 — wizard (`init-wizard.ts:18`), check, skills, hooks (`init-subcommands.ts:20`), upgrade (`init-upgrade.ts:19`) |
| `start` | Start the MonoMind orchestration system | 3 — stop, restart, quick |
| `status` | Show system status (watch mode supported) | 3 — agents, tasks, memory |
| `agent` | Agent lifecycle (in-process, no separate MCP server needed) | 7 — spawn, list, status, stop, metrics, pool, health |
| `monoswarm` | Multi-agent coordination — topology, roster, and vote state. See [Monoswarm](../concepts/monoswarm.md). | 6 — init, start, status, stop, scale, coordinate |
| `memory` | Memory management — local SQLite + local embeddings. See [Memory Command Reference](./memory.md). | 12 — init, store, edit, retrieve, search, list, delete, templates, stats, configure, export, import (export/import: `--format okf` only — any other value is rejected at runtime, `memory-transfer.ts:91`) |
| `doc` | Second Brain — document ingestion & retrieval | 8 — ingest, search, list, export, remove, reconcile, import, eval |
| `task` | Task creation and lifecycle | 5 — create, list, status, cancel, assign |
| `session` | Session state management | 6 — list, save, restore, delete, current, replay |
| `mcp` | MCP server management (Core Engine: `@monoes/mcp` `v1.0.1`, CLI: `@monoes/monomindcli` `v2.9.3`). See [MCP Command Reference](./mcp.md) & [MCP Server Concept](../concepts/mcp-server.md). | 9 — start, stop, status, health, restart, tools, toggle, exec, logs |
| `hooks` | Self-learning hooks + <!-- doc-count:workers -->9<!-- /doc-count:workers --> background workers | 28 — pre/post-edit, pre/post-command, pre/post-task, session-end, session-restore, route, explain, pretrain, metrics, transfer, list, intelligence, notify, worker, statusline, coverage-route, coverage-suggest, coverage-gaps, model-route, model-outcome, model-stats, plus deprecated `route-task` & `session-start`, plus aliases `pre-bash`/`post-bash` |
| `security` | Security scanning, CVE, threat modeling, AI defense | 6 — scan, cve, audit, secrets, defend, redteam. `audit` reads/writes a real JSONL audit trail (`--action list/log/export/clear`), populated by the destructive-ops, secrets, and monofence PreToolUse gates. `redteam` lists its 20-prompt/4-category attack library for manual review by default (`--dry-run`), or with `--target <url>` POSTs each prompt as `{ prompt, category }`, evaluates the `{ response }` via monofence-ai's `scanOutput()`, and drives the exit code off `--threshold` (unsafe-response rate). |
| `performance` | Profiling, benchmarking, real metrics | 4 — benchmark, profile, metrics, bottleneck |
| `guidance` | Wire enforcement gates into Claude Code hooks | 1 — setup |
| `autopilot` | Autonomous task execution — persistent swarm run to completion | 8 — status, enable, disable, config, reset, log, predict, check |
| `config` | Configuration management | 7 — init, get, set, providers, reset, export, import |
| `doctor` | System diagnostics — flat command, no subcommands | 0 — flags only: `--fix`, `--install`, `--verbose`, `--component` (`--component` accepts one of 28 named categories — see below) |
| `completions` | Shell completion scripts | 4 — bash, zsh, fish, powershell |
| `analyze` | Codebase analysis — diff classification, change risk | 7 — diff, code, deps, ast, complexity, symbols, imports |
| `route` | Task-to-agent routing (keyword + embedding cascade). See [Route Command Reference](./route.md) & [Routing Concept](../concepts/routing.md). | 9 — task (default), semantic, list-agents, stats, feedback, reset, export, import, coverage (alias: cov) |
| `monograph` | Knowledge graph CLI (delegates to `@monoes/monograph` `v1.5.7`). See [Monograph Command Reference](./monograph.md) & [Monograph Concept](../concepts/monograph.md). | 6 — build, wiki, search, stats, watch, lsp |
| `tokens` | Token usage tracking + cost dashboard | 4 — dashboard, summary, today, lean-delta |
| `search` | Universal search (`search scan` refreshes fingerprint) | 1 — scan |
| `providers` | AI provider management | 4 — list, configure, remove, test |
| `update` | Self-update check for `@monomind` packages | 5 — check, all, history, rollback, clear-cache |
| `cleanup` | Remove monomind project artifacts | 0 — flat command, flags only |
| `platforms` | Install/uninstall Monograph context for AI platforms | 3 — install, uninstall, setup |
| `browse` | Browser automation via CDP (`@monoes/monobrowse`) | action/platform/workflow builders |
| `design` | Design tooling — anti-pattern detection, OKLCH palette seeding | 4 — detect, fix, ignores, palette |
| `org` | SDK org runtime v2 — daemon-controlled agent orgs | 33 — run, stop, pause, resume, reload, status, serve, supervisor, test-loop, logs, watch, report, **memory** (stats\|search\|rules\|rollback), costs, inbox, flow, questions, answer, approve, deny, gates, gate-approve, gate-reject, replay, resume-from (resumes live execution from a checkpoint — distinct from replay's debug-only event replay), branch, decisions, create, validate, migrate, list, delete, mark-complete |
| `report-crash` | File a GitHub issue for a crash (internal; used by panic handlers) | – |
| `crash-reporting` | Configure crash reporting | 3 — enable, disable, status |

`org` has grown well past its original set — pause/resume/reload (daemon lifecycle), watch/costs/flow/decisions (observability), inbox (cross-org messaging), approve/deny/gates/gate-approve/gate-reject (human-in-the-loop gating), and replay/resume-from/branch (time-travel debugging and checkpoint resume — `resume-from` restores live execution from a checkpoint, distinct from `replay`'s debug-only event replay) bring it to 33 subcommands total. For the full architecture (SDK-session-per-role model, human-in-the-loop flow, config schema), see [Org Runtime v2](../concepts/org-runtime.md).

**Hooks availability:** all 28 `hooks` subcommands are always registered in the CLI parser — this doesn't depend on whether the optional `@monoes/hooks` package resolved at install time.

## Entry points

- Umbrella bin: `monomind` → `./bin/cli.js` (root `package.json` "bin"). CLI package bins: `cli`, `monomind` → `./bin/cli.js`, plus `monomind-mcp` → `./bin/mcp-server.js`.
- Run via `npx monomind@latest <cmd>`. Register as an MCP server with `claude mcp add monomind -- npx -y monomind@latest mcp start`.
- **MCP mode gate**: MCP server mode requires piped stdin AND either `mcp`/`mcp start` as argv, or the env var `MONOMIND_MCP_AUTODETECT=1` with zero args. Older versions treated any non-TTY invocation as an MCP server; that was removed as a privilege-escalation fix — plain non-interactive shell usage no longer risks silently starting an MCP server.
- `bin/cli.js` always reads its version from `package.json` at runtime — never hardcoded, so it can't drift from what's installed (confirmed live: `node bin/cli.js --help` reports the installed `v2.9.3`). **Exception:** the separate `monomind-mcp` binary (`bin/mcp-server.js`) hardcodes `const VERSION = '3.0.0'` (`bin/mcp-server.js:13`) and reports it in its MCP `initialize` response (`:124`) regardless of the real installed version — a real version-drift bug specific to that one entry point.

## `doctor --component` categories (28)

`monomind doctor` (flags: `--fix`, `--install`, `--verbose`, `--component`) — `--component` actually accepts one of **28** named values, dispatched via the `componentMap` lookup table (`doctor.ts:97-111`). Verified two ways: reading `componentMap` directly, and running `node bin/cli.js doctor --component bogus`, whose own error path prints the live list.

The flag's `--component` *description string* (`doctor.ts:42`) only names 23 of them — it has drifted out of sync with the dispatch table it's meant to describe, undercounting by 5: `freshness` (alias of `version`), `second-brain`, `kg`, `appledouble`, and `sidecars` (the last two are both aliases of the same check, `checkAppleDoubleSidecars`). Full 28, alphabetical: api, appledouble, claude, config, disk, freshness, gates, git, gitignore, graph-freshness, helpers, kg, mcp, memory, memory-pkg, memory-proficiency, metrics-freshness, monoes, monoes-tools, monograph, node, npm, registry, second-brain, security-audit, sidecars, typescript, version.

`checkSecondBrainModel`, `checkMemoryKnowledgeGraph`, and `checkAppleDoubleSidecars` (`doctor.ts:22-23`) — which a prior version of this note incorrectly called unreachable via `--component` — are in fact reachable, via `second-brain`, `kg`, and `appledouble`/`sidecars` respectively. They just don't appear in the flag's own `--help` description text.

A plain `monomind doctor` (no `--component`) runs a *different* set — its own `alwaysOnChecks`/`codeOnlyChecks` arrays (`doctor.ts:80-91`), not this 28-value list. One concrete divergence: `monoes-tools` is one of the 28 valid `--component` values but is **not** in either default-sweep array — it only runs when explicitly requested (`doctor.ts`'s own example text confirms: "opt-in, not in the default run"). Don't treat the 28-item `--component` list as a total default-sweep check count.

## Crash reporting

`packages/@monomind/cli/src/services/crash-reporter.ts` is shared across the monoes tool family — `monotask` and `mono-clip` shell out to `monomind report-crash`. It's **on by default**; opt out with `monomind crash-reporting disable`. Reports are secret/PII-scrubbed before filing, deduplicated by a sha1 signature of repo+normalized title within a dedup window, and rate-limited per repo (statuses: `created`, `duplicate`, `saved-locally`, `disabled`, `rate-limited`, `error`).

## Input validation

Former `@monomind/security` package is gone — input validation now lives inline at `packages/@monomind/cli/src/utils/input-guards.ts`, with a single typed `validateInput()` entry point covering string/number/path/url/orgName types plus a heuristic prompt-injection detector for untrusted external content.
