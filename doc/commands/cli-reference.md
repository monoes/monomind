# CLI Command Reference

> All 32 top-level `monomind` commands, verified against `packages/@monomind/cli/src/commands/index.ts` and `node bin/cli.js <cmd> --help` on the built dist (v2.5.4). Both internal command registries (`loadedCommands` and `commands`) contain the identical 32-entry set — no drift between them as of this sweep.

**⚠️ Known issue:** `monomind --help` only lists commands that appear in the `commandsByCategory` category map (`index.ts:149–184`), which currently has **28** entries — it omits `org`, `design`, `report-crash`, and `crash-reporting` even though all four are fully registered and functional. This is a category-map bug, not a sign the commands are unsupported or hidden intentionally — `org` in particular is a headline feature that `--help` currently fails to surface. Worth a GitHub issue on `monoes/monomind` if you hit it. This doc lists all 32 regardless of what `--help` shows.

## Full command list (32)

| Command | Purpose | Subcommands |
|---|---|---|
| `init` | Initialize MonoMind in current directory | 5 — wizard, check, skills, hooks, upgrade |
| `start` | Start the MonoMind orchestration system | – |
| `status` | Show system status (watch mode supported) | 3 — agents, tasks, memory |
| `agent` | Agent lifecycle (in-process, no separate MCP server needed) | 7 — spawn, list, status, stop, metrics, pool, health |
| `swarm` | Multi-agent swarm coordination (in-process) | 6 — init, start, status, stop, scale, coordinate |
| `memory` | Memory management — local SQLite + local embeddings | 12 — init, store, edit, retrieve, search, list, delete, templates, stats, configure, export, import |
| `doc` | Second Brain — document ingestion & retrieval | 4 — ingest, search, list, export |
| `task` | Task creation and lifecycle | 5 — create, list, status, cancel, assign |
| `session` | Session state management | 6 — list, save, restore, delete, current, replay |
| `mcp` | MCP server management | 9 — start, stop, status, health, restart, tools, toggle, exec, logs |
| `hooks` | Self-learning hooks + 15 background workers | 29 — pre/post-edit, pre/post-command, pre/post-task, session-end, session-restore, route, explain, pretrain, build-agents, metrics, transfer, list, intelligence, notify, worker, statusline, coverage-route, coverage-suggest, coverage-gaps, model-route, model-outcome, model-stats, plus deprecated `route-task` & `session-start`, plus aliases `pre-bash`/`post-bash` |
| `security` | Security scanning, CVE, threat modeling, AI defense | 6 — scan, cve, audit, secrets, defend, redteam. **Two are partial stubs**: `audit` doesn't read a real audit log — it infers synthetic events from `.swarm/*.json` filenames and appends one row; its declared `--action log/export/clear` flags are not implemented (only list/default behavior works). `redteam` has a real 20-prompt/4-category attack library and a working `--dry-run`, but live `--target` execution is not implemented — it always prints "requires a running agent target" and returns failure, with no actual HTTP/agent invocation. |
| `performance` | Profiling, benchmarking, real metrics | 4 — benchmark, profile, metrics, bottleneck |
| `guidance` | Wire enforcement gates into Claude Code hooks | 1 — setup |
| `autopilot` | Autonomous task execution — persistent swarm run to completion | – |
| `config` | Configuration management | 7 — init, get, set, providers, reset, export, import |
| `doctor` | System diagnostics (23 named checks — see below) | flags only: `--fix`, `--install`, `--verbose`, `--component` |
| `completions` | Shell completion scripts | 4 — bash, zsh, fish, powershell |
| `analyze` | Codebase analysis — diff classification, change risk | ast, diff, imports, complexity |
| `route` | Task-to-agent routing (keyword + embedding cascade) | 9 — task (default), semantic, list-agents, stats, feedback, reset, export, import, coverage (alias: cov) |
| `monograph` | Knowledge graph CLI (delegates to `@monoes/monograph`) | – |
| `tokens` | Token usage tracking + cost dashboard | dashboard |
| `search` | Universal search (`search scan` refreshes fingerprint) | 1 — scan |
| `providers` | AI provider management | 4 — list, configure, remove, test |
| `update` | Self-update check for `@monomind` packages | check |
| `cleanup` | Remove monomind project artifacts | – |
| `platforms` | Install/uninstall Monograph context for AI platforms | – |
| `browse` | Browser automation via CDP (`@monoes/monobrowse`) | action/platform/workflow builders |
| `design` | Design anti-pattern detection (monodesign engine) | detect, palette |
| `org` | SDK org runtime v2 — daemon-controlled agent orgs | 16 — run, stop, status, serve, test-loop, logs, report, **memory** (stats\|search\|rules\|rollback), questions, answer, create, validate, migrate, list, delete, mark-complete |
| `report-crash` | File a GitHub issue for a crash (internal; used by panic handlers) | – |
| `crash-reporting` | Configure crash reporting | 3 — enable, disable, status |

`org memory` is the newest addition to the `org` subcommand set — it inspects cross-run memory/knowledge-graph state (`stats`, `search`, `rules`, `rollback`) and brings `org` to 16 subcommands total. For the full architecture (SDK-session-per-role model, human-in-the-loop flow, config schema), see [Org Runtime v2](../concepts/org-runtime.md).

## Entry points

- Umbrella bin: `monomind` → `./bin/cli.js` (root `package.json` "bin"). CLI package bins: `cli`, `monomind` → `./bin/cli.js`, plus `monomind-mcp` → `./bin/mcp-server.js`.
- Run via `npx monomind@latest <cmd>`. Register as an MCP server with `claude mcp add monomind -- npx -y monomind@latest mcp start`.
- **MCP mode gate**: MCP server mode requires piped stdin AND either `mcp`/`mcp start` as argv, or the env var `MONOMIND_MCP_AUTODETECT=1` with zero args. Older versions treated any non-TTY invocation as an MCP server; that was removed as a privilege-escalation fix — plain non-interactive shell usage no longer risks silently starting an MCP server.
- Version is always read from `package.json` at runtime (never hardcoded), so the CLI's reported version can't drift from what's installed.

## Doctor checks (23)

`monomind doctor` (flags: `--fix`, `--install`, `--verbose`, `--component`) runs these named checks: Version Freshness, Node.js Version, npm Version, Claude Code CLI, Git, Git Repository, Config File, Memory Database, Vector Memory, API Keys, MCP Servers, Disk Space, TypeScript, Monograph, Graph Freshness, Helper Files, monoes Tools (skipped off-macOS), Guidance Gates, Gitignore Coverage, Agent Registry, Memory Proficiency, Routing Learning, Worker Metrics, Security Audit.

## Crash reporting

`packages/@monomind/cli/src/services/crash-reporter.ts` is shared across the monoes tool family — `monotask` and `mono-clip` shell out to `monomind report-crash`. It's **on by default**; opt out with `monomind crash-reporting disable`. Reports are secret/PII-scrubbed before filing, deduplicated by a sha1 signature of repo+normalized title within a dedup window, and rate-limited per repo (statuses: `created`, `duplicate`, `saved-locally`, `disabled`, `rate-limited`, `error`).

## Input validation

Former `@monomind/security` package is gone — input validation now lives inline at `packages/@monomind/cli/src/utils/input-guards.ts`, with a single typed `validateInput()` entry point covering string/number/path/url/orgName types plus a heuristic prompt-injection detector for untrusted external content.
