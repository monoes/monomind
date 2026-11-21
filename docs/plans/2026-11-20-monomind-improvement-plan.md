# monomind improvement plan (2026-11-20)

This plan comes from a state-of-the-art review of monomind at `origin/main` b2fb3b945 (CLI 2.29.4) on 2026-11-20. Five reviewers covered 15 categories plus the dashboard and the docs. They compared monomind against 2026 practice in other tools, read the code, and ran the CLI against temporary homes. Their detailed findings are kept outside the repo. This document deduplicates them into one ranked, phased plan.

**How to read it**
- Section 1 is the executive summary.
- Section 2 covers each category.
- Section 3 is the roadmap: Phase 0 fixes what is broken or false and removes dead features, Phase 1 makes the core work, Phase 2 is strategy.
- Section 4 is the remove list.
- Section 5 lists the decisions only the maintainer can make.

**Notation**
- Item IDs such as `mcp-1` point to the category tables in section 2.
- Roadmap IDs such as `P0-3` merge duplicates across categories.
- Effort: S under a day, M a few days, L a week or more. Impact: H, M or L.
- ✔ means the plan author re-read the cited lines at b2fb3b945. Every other citation carries the reviewer's evidence.

**Path key**
- `cli/` = `packages/@monomind/cli/`
- `monograph/` = `packages/@monomind/monograph/`
- `memory/` = `packages/@monomind/memory/`
- `hooks/` = `packages/@monomind/hooks/`
- `monobrowse/` = `packages/@monoes/monobrowse/`
- `monodesign/` = `packages/@monoes/monodesign/`
- Other paths are relative to the repo root.

**Security:** two security items are tracked privately and are not described here. Every other hardening item below is written as an ordinary improvement.

---

## 1. Executive summary

### Where monomind leads

- **The Org Runtime has features that are rare or absent in the frameworks surveyed** (CrewAI, LangGraph, Microsoft Agent Framework, the OpenAI Agents SDK, the Claude Agent SDK and agent teams, Google ADK, Devin and Factory):
  - Signed org configs that are verified fail-closed.
  - Budgets that hold across roles and respawned sessions within a run.
  - Schedules that catch up after downtime.
  - Completion evidence pinned to the tree state being closed.
  - 18 runner adapters under one policy layer.

  No surveyed system signs agent configs.
- **The Mesh works on any host:** a per-host Unix-socket hub on SQLite with per-registration keys (`cli/src/mesh/hub.ts:20-25`). Claude Code agent teams are Claude-only and allow one team per session. The Mesh delivers inbox mail to more than 10 hosts through their native hooks.
- **Monograph's task scoping:** `monograph_brief` returns entry points, callers, tests, covering docs and blast radius in one call (`cli/src/mcp-tools/monograph/brief-tool.ts:18`). Host LSPs do not do this.
- **The Org skill library:** a pull search over about 560 skills that the host cannot see. This is the same pattern as Anthropic's tool search with `defer_loading`.
- **Careful details:**
  - A hash-guarded FileGuard that keeps user edits during init.
  - `doctor --json` with fix-safety levels.
  - Honest per-surface retrieval reports in `knowledge_search`.
  - A per-origin knowledge-graph claim ledger with rollback.
  - monodesign's 51 deterministic UI rules, tested on Linux and Windows.

### Where monomind trails, or fails silently

The common thread: **the surface is much larger than the part that works, and much of it fails without saying so.**

| Area | Today | 2026 practice |
|---|---|---|
| MCP protocol | Results from `monograph_*` and `knowledge_*` are double-wrapped and lose `isError`. No tool has annotations or an `outputSchema`. `initialize` answers 2024-11-05. The HTTP transport does not interoperate. | Spec-shaped results. `readOnlyHint` lets Claude Code run tools in parallel. Stateless 2026-07-28 revision. |
| MCP surface | 204 tools, 21 advertised. `monomind_tool_search` returns schemas that hosts cannot call. About 70 tools in dead families. | Hosts defer MCP tools themselves (Claude Code tool search, OpenCode Code Mode). Servers expose small, curated toolsets (GitHub toolsets, Context7's two tools). |
| Memory | On a default install, search is keyword-only: the embedding model is never downloaded. Facts have no temporal validity. | Mem0, Zep/Graphiti and Supermemory use hybrid retrieval and supersede-and-rank. Claude Code auto memory and Codex memories are native. |
| Code graph | About half of Variable nodes in a probe had the wrong line. Freshness is keyed on HEAD, so uncommitted edits are invisible. Every rebuild is a full rebuild. | Host LSP plugins give compiler-grade references. Cursor syncs incrementally with a Merkle tree. Aider's repo map is rebuilt for each request. |
| Routing | A BM25 picker, plus four more agent suggesters. One deprecated router reports 85–89% confidence for "bake a sourdough loaf". The success label is a substring match. | Hosts choose subagents and skills from descriptions, using the main model. |
| Hooks and telemetry | An empty hook registry runs on every event. The statusline invents figures. "Learning" labels sit on code that learns nothing. | Claude Code has 33 hook events with `async` and `if` filters, statusline stdin JSON with cost and context, and OpenTelemetry export. |
| Packaging | npm publishing uses a long-lived token with tag-pinned actions. On npm 12 the native module's install script is blocked, so the code graph silently never builds. Default init writes 1,172 files. | npm trusted publishing (OIDC) with provenance. Prebuilt binaries in optional dependencies. Plugins and marketplaces. |
| Evals | One 9-run toy pilot is the only outcome evidence. The free retrieval eval (n=31) has `monograph_query` answering 0 of 12 callers/tests questions where `rg` answers 12. It does not run in CI. | Terminal-Bench 2, SWE-bench Pro and Inspect, with strict harnesses, pass^k, and at least 5 trials. |
| Browser | `browse click` reports success on off-screen or covered elements. Start/stop verbs only work inside `browse batch`. | Playwright actionability checks. Claude in Chrome and Chrome DevTools MCP are host-native. |

### What hosts now do natively

These are things monomind still does, or tells the agent to do:
- deferring MCP tools and searching for them
- LSP navigation
- per-project memory
- choosing subagents and skills by description
- cost and context in the statusline
- OpenTelemetry export
- browser automation
- task lists and mailboxes (Claude Code agent teams)

The plan responds in three ways:
- It keeps what hosts lack: orgs, the Mesh, brief/impact/tests-to-run, Org skill search and the document Second Brain.
- It defers to the host where the host is better.
- It deletes what only records or describes machinery that does not exist.

### Verified against b2fb3b945 (plan author re-read each line)

| # | Claim | Evidence |
|---|---|---|
| 1 | Both stdio loops wrap every handler result in a new `content[].text` envelope. Handlers that already return `{content,isError}` are double-wrapped; that covers all `monograph_*` and `knowledge_*` results. | ✔ `cli/bin/cli.js:321-326`, `cli/bin/mcp-server.js:190-195`, `cli/src/mcp-tools/monograph/shared.ts:61` |
| 2 | The session-start self-heal spawns `npx -y monomind@latest doctor --fix`. | ✔ `.claude/helpers/handlers/session-restore-handler.cjs:234` |
| 3 | `init upgrade` never rewrites `.mcp.json`. | ✔ `cli/src/init/upgrade.ts` and `upgrade-steps.ts` call no MCP-config writer; from the MCP modules they import only `monomindNpx` and `writeClaudeMd` (`upgrade.ts:7,30`) |
| 4 | The memory embedder loads with `local_files_only: true`, so nothing downloads it implicitly. | ✔ `cli/src/memory/memory-bridge-backend.ts:234-237` |
| 5 | `knowledge_search`'s memory surface reads namespace `patterns`, but `memory store` writes `default`. | ✔ `cli/src/mcp-tools/knowledge-tools.ts:187`, `cli/src/commands/memory-crud.ts:90` |
| 6 | Variable line numbers are counted on text whose newlines inside comments and template literals were blanked. | ✔ `monograph/src/pipeline/phases/variables.ts:19-28,50` |
| 7 | Graph freshness is "commits behind HEAD", so uncommitted edits read as fresh. | ✔ `.claude/helpers/monograph-freshen.cjs:44-46` |
| 8 | Copilot, Pi and Kilo side writers run only when `helpers` is on, and `helpers` is forced off without the `claude` target. | ✔ `cli/src/init/executor.ts:294-301`, `cli/src/init/resolve-options.ts:249-255` |
| 9 | `org replay` re-stamps all events with one `Date.now()` and persists the org as `running`. | ✔ `cli/src/orgrt/checkpoint-ops.ts:84-96` |
| 10 | Task state is checkpointed only at start, respawn, scheduled run, stop and replay, never when a task changes. | ✔ `cli/src/orgrt/org-start.ts:475`, `role-respawn.ts:527`, `scheduler-integration.ts:311`, `org-stop.ts:286`; `task-dag.ts` does no I/O |
| 11 | Org JSON is signed over everything except goal/status and role title/responsibilities/ui. The routines skill edits `schedule` with `jq` and does not re-sign. | ✔ `cli/src/orgrt/org-signature.ts:66-69`, `.claude/skills/mastermind-routines/SKILL.md:86-97` |
| 12 | monobrowse clicks the element box with no scroll-into-view or hit test. | ✔ `monobrowse/src/browser/actions-form.ts:8-37` |
| 13 | When `npm audit` fails (for example with no `package-lock.json`), `security scan` parses `'{}'` and reports nothing. | ✔ `cli/src/commands/security-scan-commands.ts:125-135` |
| 14 | No workflow runs the retrieval or A/B eval runners. CI runs only the retrieval lib test. | ✔ `.github/workflows/tests.yml:123` is the only `tests/eval` reference |
| 15 | The `claims_*` tools are imported only by their own files and the tool loaders. | ✔ `cli/src/mcp-tools/claims-*.ts`, `cli/src/mcp-client-registry.ts`, `cli/src/mcp-tools/index.ts` |
| 16 | `registerHook` has no non-test caller, so `executeHooks` always runs an empty registry. | ✔ `hooks/src/registry/index.ts:248` |
| 17 | The statusline reads no stdin, and its "patterns" figure is `memory.db` size in KB / 2. | ✔ `.claude/helpers/statusline.cjs:338` |
| 18 | Release publishing uses `NPM_TOKEN`, and the actions are pinned by tag. | ✔ `.github/workflows/release.yml:43-52,100-102` |
| 19 | The CLI accepts unknown flags silently. | ✔ `cli/src/parser.ts:396` (`allowUnknownFlags: true`) |
| 20 | The OpenCode plugin uses the v1 hook key `tool.execute.before`. | ✔ `.opencode/plugins/monomind-hooks.ts:103` |
| 21 | The deprecated RouteLayer is still on the `agent spawn --task` path. | ✔ `cli/src/commands/agent-lifecycle-spawn.ts` imports `routing/route-layer-factory` |
| 22 | Init's last screen still says `monomind swarm init` and "Register the MCP server" after writing `.mcp.json`. | ✔ `cli/src/commands/init-action.ts:530,543` |

---

## 2. Categories

Each category has the current state, the 2026 comparison, and the top items. The full tables, with more rows, are in the review findings.

### 2.1 Knowledge graph (Monograph)

**State**
- Broken line numbers on Variable nodes (✔ #6).
- Freshness keyed on HEAD (✔ #7).
- Every rebuild is a full rebuild, 39–53 s on 669 files (`monograph/src/pipeline/orchestrator.ts:366-400`).
- CLI `search --mode semantic` is lexical (`cli/src/commands/monograph-search.ts:95-98`).
- An unregistered `monograph lsp` server.
- `[MONOGRAPH_HINT]` maps any shell word to a symbol (`.claude/helpers/hook-handler.cjs:466-592`).
- Strong: `monograph_brief`; 14 WASM grammars, offline; a PR-gated search eval.

**2026**
- Claude Code LSP plugins give a read-only `LSP` tool plus diagnostics after each edit ([docs](https://code.claude.com/docs/en/plugins/code-intelligence), undated).
- Serena offers symbol-level MCP tools for 40+ languages ([repo](https://github.com/oraios/serena), v2.1.0, 2026-10-19).
- Aider builds a repo map ranked by graph centrality, rebuilt for each request ([docs](https://aider.chat/docs/repomap.html), undated).
- Cursor syncs its index with a Merkle diff: time to first query went from 7.87 s to 525 ms ([blog](https://cursor.com/blog/secure-codebase-indexing), 2026-01-27).

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| kg-1 | Improve | Fix Variable line numbers | S | H | Keep `\n` in `stripNonCodeBraces`; add a test with a multi-line comment and a template literal |
| kg-2 | Improve | Working-tree-aware freshness | M | H | `.claude/helpers/monograph-freshen.cjs` and `monograph/src/staleness/git-staleness.ts` treat `git status --porcelain` changes as stale |
| kg-3 | Add | Hand exact navigation to the host LSP; keep brief/impact/tests | S | H | Reword the graph-first rule in `cli/src/init/claudemd-sections-reference.ts:238-242` (after `P0-13` produces numbers) |
| kg-4 | Remove | The single-word `[MONOGRAPH_HINT]` injection | S | M | Hint only for grep/rg identifiers that have exactly one definition |
| kg-5 | Improve | One search path for CLI and MCP; publish the nightly eval numbers | S | M | `monograph-search.ts` calls `searchGraphFused`; `graph-eval.yml` uploads `eval.json` |
| kg-6 | Remove | The unregistered `monograph lsp` server and the `./lsp` export | S | L | Delete `cli/src/commands/monograph-lsp.ts` and `monograph/src/lsp/` |
| kg-7 | Improve | Real incremental rebuild (after kg-2) | L | M | Re-parse changed files and their importers; defer communities to the idle rebuild |

### 2.2 Memory and the Second Brain

**State**
- Semantic search never runs on a default install (✔ #4).
- `doc search` prints "No results found." with no method or reason.
- The README promises a download on first use that never happens.
- The namespace mismatch (✔ #5).
- The HNSW default is 100,000, not 5,000 (`memory/src/hnsw-index.ts:6`).
- Per-prompt injection without the dashboard searches only CLAUDE.md and todo chunks (`.claude/helpers/handlers/route-handler.cjs:290-342`).
- Knowledge-graph edges have `valid_from` only.
- Dead stores: `.claude/helpers/memory.cjs`, plus `memory init`'s `.swarm/` and `.claude/` databases.
- Strong: honest per-surface reports; a claim ledger with rollback; versioned documents with citations.

**2026**
- Claude Code auto memory: on by default, loads the first 200 lines / 25 KB each session ([docs](https://code.claude.com/docs/en/memory), undated).
- Codex native memories: opt-in, generated when a chat goes idle ([docs](https://learn.chatgpt.com/docs/customization/memories?surface=app), undated).
- Mem0: additive extraction with hybrid semantic + BM25 + entity retrieval ([repo](https://github.com/mem0ai/mem0), algorithm dated Apr 2026).
- Graphiti: bi-temporal facts, where superseded edges are invalidated rather than deleted ([docs](https://help.getzep.com/graphiti/getting-started/overview), undated).
- Supermemory: a Claude Code plugin that injects memories before each prompt and captures after each response (vendor docs, [link](https://supermemory.ai/docs/integrations/claude-code), undated).

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| mem-1 | Improve | Report the search method; fix the namespace; fix the download docs | S | H | `cli/src/commands/doc-search.ts` prints `method`/`fallbackReason`; `knowledge-tools.ts:187` reads `default` + `patterns` |
| mem-2 | Improve | Make semantic search reachable on a normal install | M | H | One-time download on first `doc ingest`/`memory store`, behind `MONOMIND_NO_AUTO_INSTALL` (decision D3) |
| mem-3 | Improve | Per-prompt injection searches the document store and the global brain through FTS5 | M | H | Query the bridge DB in `route-handler.cjs:337-342`; retire `chunks.jsonl` |
| mem-4 | Remove | Dead stores and settings; about 10 thin memory MCP tools | M | M | Delete `.claude/helpers/memory.cjs` and its generator; fold `hierarchical-*`, `session-*` and others into one store/search pair |
| mem-5 | Improve | Position against host memory, not alongside it | S | M | Replace "ALWAYS store patterns in memory" in `claudemd-sections-reference.ts:129-130` |
| mem-6 | Add | Temporal validity and supersede-and-rank in the knowledge graph | M | M | `invalid_at`/`superseded_by` in `cli/src/memory/memory-kg-ingest.ts`; filter in `memory-kg-search.ts` |

### 2.3 Routing and picking

**State**
- One picker serves `pick`, the MCP tool and the `[PICK]` hook (`cli/src/decision/picks.ts:126`). It scores 58/79 top-1 on an eval whose agent descriptions were tuned to that eval.
- The deprecated RouteLayer is uncalibrated, took 54 s on a cold call, and is still live (✔ #21).
- `[INTELLIGENCE]` loads only inside the monomind checkout (`route-handler.cjs:68-87`). `[AGENT_PATTERN]` and `[ROUTING]` add up to 2 s.
- `hooks_explain` returns fixed weights.
- The success label is a substring test (`.claude/helpers/handlers/capture-handler.cjs:51-60`).
- The learned prior can never change a shown pick.

**2026**
- Claude Code delegates by subagent `description` ([docs](https://code.claude.com/docs/en/sub-agents), undated) and picks skills by description under a listing budget ([docs](https://code.claude.com/docs/en/skills), undated).
- Anthropic tool search cut tool tokens from about 77K to 8.7K with higher MCP-eval accuracy ([post](https://www.anthropic.com/engineering/advanced-tool-use), 2025-11-24).
- semantic-router fits a threshold per route and returns no route when nothing matches ([repo](https://github.com/aurelio-labs/semantic-router), undated).
- Gemini CLI routes subagents by description or by `@name` ([post](https://developers.googleblog.com/subagents-have-arrived-in-gemini-cli/), 2026-04-15).

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| rt-1 | Remove | Hook advisories A1–A3, write-only `routing-outcomes.json`, the fixed `hooks_explain` weights | S | M | Drop `route-handler.cjs:68-87,504-589`, `cli/src/mcp-tools/hooks-task.ts:305-333`, `hooks-route.ts:194-247` |
| rt-2 | Remove | RouteLayer from live paths; retire `packages/@monomind/routing` (keep `model-download.ts`) | M | M | Point `agent spawn --task` at `pickAgents`; delete `route semantic` and `hooks_route_semantic` |
| rt-3 | Add | A/B of `[PICK]`-on vs `[PICK]`-off, plus a held-out set from real logs | M | H | Extend `cli/src/decision/pick-real.ts` and `scripts/pick-eval.mjs` |
| rt-4 | Improve | Honest success label (tool-error signal only; "no error" counts as unknown) | S | M | `capture-handler.cjs:51-60`, `.claude/helpers/pick-stats.cjs:351-359` |
| rt-5 | Improve | Demote the agent `[PICK]` to a hint; skills-only by default (after rt-3) | S | H | `claudemd-sections-reference.ts:54-61`, `.claude/helpers/handlers/pick-core.cjs:206-211` |
| rt-6 | Improve | Org-skill search as a pull search through `pick kind:"skills"` | M | H | Expose Org skills through `pick`; list only the top platform skills |

### 2.4 Hooks, workers, statusline and telemetry

**State**
- An empty `executeHooks` registry runs at 5 call sites (✔ #16). In user installs the import fails, so no worker runs from hooks.
- Workers `health`, `progress` and `cache` have no automatic run and no reader.
- The statusline invents its figures (✔ #17).
- SONA/EWC/MoE/LoRA/Flash readouts are placeholders. `hooks intelligence train` ingests 0 records.
- The 3 trajectory MCP tools have no callers.
- `token-tracker.cjs` prices Haiku 5.5 and Fable 5.2 at $0 (`.claude/helpers/token-tracker.cjs:75-88`).
- No hook uses `async`. `init` writes settings keys that nothing reads.
- Strong: PreToolUse safety gates; one handler set re-targeted to Codex, Gemini, Kimi and OpenCode.

**2026**
- Claude Code hooks: 33 events, five handler types, `async`, `if` filters, and hooks in plugins ([docs](https://code.claude.com/docs/en/hooks), undated).
- The Claude Code statusline gets stdin JSON with cost, context and rate limits ([docs](https://code.claude.com/docs/en/statusline), undated).
- Claude Code exports OpenTelemetry metrics and `hook_execution_*` events ([docs](https://code.claude.com/docs/en/monitoring-usage), undated).
- Arize Phoenix ships a Claude Code plugin that emits OpenInference spans ([docs](https://arize.com/docs/phoenix/integrations/coding-agents/claude-code), undated). ccusage reads cost from local transcripts ([npm](https://www.npmjs.com/package/ccusage), undated).

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| hk-1 | Remove | The `executeHooks` bridge calls | S | M | Edit `.claude/helpers/handlers/{task,edit,session,session-restore}-handler.cjs`; keep the worker-factory import |
| hk-2 | Improve | Statusline reads the host's stdin JSON; drop the invented figures | M | H | Rewrite `cli/src/init/statusline-script-*.ts` and `.claude/helpers/statusline.cjs` |
| hk-3 | Remove | Learning labels and stubs, `--train`, the 3 trajectory tools, `train`, `suggestAgentsFromIntelligence` | M | H | Edit `cli/src/mcp-tools/hooks-intelligence-{patterns,trajectory}.ts`; delete `cli/src/commands/neural-core-train.ts` |
| hk-4 | Improve | Prompt and session latency: `async: true` on hooks that only cause side effects | M | H | `cli/src/init/settings-generator.ts`; cache `mesh-inbox`'s `ps` walk |
| hk-5 | Remove | Dead workers, unread settings keys, `metrics-db.mjs`, the never-installed `pre-commit` | S | M | `hooks/src/workers/worker-{health,progress,cache}.ts`, `settings-generator.ts:104-166` |
| hk-6 | Improve | Cost from the host's data; show "unpriced" instead of $0 | S | M | `token-tracker.cjs` priced from a table generated from `cli/src/latest-models.ts` |
| hk-7 | Add | Opt-in OpenTelemetry path, replacing the hand-written latency and tool-call JSON logs | M | M | `monomind init --telemetry` sets `CLAUDE_CODE_ENABLE_TELEMETRY` and an OTLP endpoint |

### 2.5 MCP server and tool surface

**State**
- Double envelope (✔ #1). A missing parameter returns JSON-RPC -32603 instead of `isError`.
- `mcp start` with flags writes 14 non-JSON lines to stdout.
- 204 registered tools, 21 advertised (about 4k tokens). The full set is about 23k tokens.
- `monomind_tool_search` returns schemas that hosts cannot call: `listChanged: true` is declared, but nothing emits it.
- 264 references in 88 `.claude/` files point at about 50 non-advertised tools.
- No `annotations`, `title` or `outputSchema` on any tool (`cli/src/mcp-tools/types.ts:34-47`).
- `serverInfo.version` is hard-coded to 3.0.0. `mcp toggle` does not hide tools over stdio.
- Strong: a small default roster; pinned per-host registration that keeps user values.

**2026**
- MCP 2025-11-25 says input-validation errors are tool errors (`isError`) ([changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog), undated).
- MCP 2026-07-28 is stateless, adds `server/discover`, and moves `listChanged` to `subscriptions/listen` ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), undated).
- Claude Code defers MCP tools by default, runs `readOnlyHint` tools in parallel and retries `idempotentHint` ones ([docs](https://code.claude.com/docs/en/mcp), undated).
- The GitHub MCP server is configured by toolsets plus a read-only mode ([config](https://raw.githubusercontent.com/github/github-mcp-server/main/docs/server-configuration.md), undated).
- Anthropic's tool-design guidance: consolidate tools, give concise responses and actionable errors ([post](https://www.anthropic.com/engineering/writing-tools-for-agents), 2025-09-11).

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| mcp-1 | Improve | One stdio handler with spec-shaped results; stdout carries protocol only | S | H | Route `cli/bin/cli.js` and `cli/bin/mcp-server.js` through `handleMCPMessage`; `mcp-client.ts` returns `isError`; add a stdio contract test |
| mcp-2 | Remove | 70 tools in dead families (browser 28, claims 12, terminal, config, github, performance, guidance, quality, platforms) | M | H | Delete the tool files and their loaders in `cli/src/mcp-client-registry.ts:31-61` |
| mcp-3 | Improve | Rewrite the 264 `.claude/` references to non-advertised tools; add a check | M | H | `P0-19`: point them at CLI or host tools; `sync:claude-trees:check` fails on a non-advertised `mcp__monomind__*` |
| mcp-4 | Remove | Hide-and-search: a tool is advertised and callable, or it is not an MCP tool | M | H | Move the 60 CLI-backend tools to direct imports; delete `monomind_tool_search`; one profile setting |
| mcp-5 | Add | `annotations` and `title`; mark read-only tools; mark `knowledge_remove` destructive | S | H | Extend `MCPTool` in `types.ts:34-47`; pass the fields through `tools/list` |
| mcp-6 | Add | `outputSchema`/`structuredContent`; negotiate `protocolVersion` | M | M | Echo the client's revision; add schemas for `pick`, `monograph_brief`, `knowledge_search` |
| mcp-7 | Remove | The HTTP transport in its current form (or mark it experimental) | S | M | Drop `cli/src/mcp-http-server.ts` from the CLI path and its docs |
| mcp-8 | Improve | Real `serverInfo.version`; `mcp toggle` filtering; `task_summary` routing; no `listChanged` until something emits it | S | M | `cli/bin/mcp-server.js:14`, `cli/src/mcp-client.ts:136-150` |

### 2.6 Org Runtime

**State**
- `org replay` corrupts `runtime.json` (✔ #9).
- Task progress is lost on a hard kill (✔ #10).
- Skills that edit signed fields leave the org unsigned, so serve refuses it (✔ #11).
- The evidence gate trusts the exit codes roles report (`cli/src/orgrt/completion-gate.ts:174-182`).
- No USD cap spans scheduled runs.
- About 16 mastermind skills write side files that nothing reads.
- Strong: see section 1.

**2026**
- LangGraph checkpoints after every super-step, with `interrupt()` and resume ([docs](https://docs.langchain.com/oss/python/langgraph/persistence), undated).
- Microsoft Agent Framework checkpoints hold pending human requests and export OTel GenAI spans ([docs](https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints), 2026-09-16).
- The Claude Agent SDK's `max_budget_usd` counts subagent spend ([docs](https://code.claude.com/docs/en/agent-sdk/cost-tracking), undated).
- Factory Missions validate each feature against the running app ([docs](https://docs.factory.com/missions/overview), undated).

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| org-1 | Improve | `org replay` must not touch `runtime.json`; keep the original `ts` and add `replayedAt` | S | H | `replayFrom` in `cli/src/orgrt/checkpoint-ops.ts` stops calling `persistState`; byte-identical test |
| org-2 | Improve | Durable task state: debounced checkpoint on every TaskDag change | M | H | `onChange` in `cli/src/orgrt/task-dag.ts` wired to `persistState` in `org-start.ts` |
| org-3 | Add | `monomind org set <org> <path> <value>`: validate, show the signed diff, re-sign after confirmation | M | H | New subcommand; the next PR moves the routines, agents, env and import skills onto it |
| org-4 | Remove | Bookkeeping skills with no reader; fix the import, backup and env skills first | S–M | M | Delete the 7 deprecated and 9 no-reader skills; update `cli/src/init/packs.ts:113-181` and the skills tests |
| org-5 | Improve | Opt-in daemon-side re-run of evidence commands | M | H | Re-run path in `completion-gate.ts` |
| org-6 | Add | Budgets over time: `budget_window {usd, per}` checked before each scheduled tick | M | H | Keys in `cli/src/orgrt/types.ts`; precheck in `scheduled-run.ts` |
| org-7 | Add | OpenTelemetry export of bus events (GenAI conventions) | M | M | Exporter subscribed in `cli/src/orgrt/bus.ts` |

### 2.7 Coordination (Mesh, agent exec)

**State**
- The Mesh is real and works on any host.
- Delivery is pull-only, at prompt boundaries. Org roles and `agent exec` runs read mail once, at start (`cli/src/orgrt/role-mesh.ts:52`).
- A `mesh send` to an org role does not reach its mailbox.
- `claims_*`, `agent_pool`, `agent_health`, `swarmRecommendation` and the topology/consensus keys only record or print (✔ #15).
- Four agent definitions describe a swarm that was removed in 2.22.0.
- There is no Gemini CLI runner.

**2026**
- Claude Code agent teams: a shared task list, mailboxes, and idle-teammate hooks ([docs](https://code.claude.com/docs/en/agent-teams), undated).
- ACP: one client protocol for coding agents, whose registry lists six of monomind's runtimes ([post](https://agentclientprotocol.com/announcements/acp-agent-registry-stabilized), 2026-03-09).
- A2A 1.0: stable, but few coding-agent consumers ([spec](https://a2a-protocol.org/latest/specification/), fetched 2026-11-20).
- Conductor: one worktree per agent ([changelog](https://www.conductor.build/changelog), 0.92.0, 2026-10-23).

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| co-1 | Remove | `claims_*`, `agent_pool`, `agent_health`, `swarmRecommendation`, the topology/consensus keys | S | M | Part of `P0-11`; edit `cli/src/mcp-tools/hooks-route.ts`, `cli/src/commands/start.ts:147-166` |
| co-2 | Remove | Topology Optimizer, Load Balancing Coordinator, Resource Allocator, security-manager; rewrite mesh-coordinator | S | M | Delete `.claude/agents/optimization/*` and `.claude/agents/consensus/security-manager.md`; record them in `retired-files-data.ts` |
| co-3 | Add | Mesh wake-on-message (a Stop hook delivers before idle; delivery between turns for roles and exec runs) | M | H | `--on-stop` mode in `.claude/helpers/mesh-inbox.cjs` |
| co-4 | Improve | Bridge the Mesh and org mailboxes | M | H | Hand `org-role` addresses to the owning daemon through `role-mesh.ts` |
| co-5 | Add | A generic ACP runner with a Gemini CLI preset | L | H | A new runner beside `cli/src/orgrt/cline-runner-acp.ts` |
| co-6 | Improve | Document and advertise `mesh_who/send/inbox` when autojoin is on | S | M | New `doc/concepts/mesh.md`; `cli/src/mcp-client-roster.ts` |

### 2.8 Sandbox and security

**State**
- Strong: signed orgs verified fail-closed; full access requires a signed human acknowledgement and refuses root; the SDK sandbox does not allow unsandboxed commands.
- Org roles allow all network egress by default (`cli/src/orgrt/role-sandbox-restrictions.ts:311`).
- Three secret redactors have diverged.
- Release uses a long-lived token (✔ #18).
- `security scan` assumes an npm lockfile (✔ #13).

**2026**
- Claude Code sandbox-runtime: an OS sandbox plus a proxy allowlist that starts empty ([docs](https://code.claude.com/docs/en/sandboxing), undated).
- Vercel Sandbox: deny-all or allowlisted egress with credential brokering ([docs](https://vercel.com/docs/sandbox/concepts/firewall), 2026-09-16).
- npm trusted publishing (OIDC) ([docs](https://docs.npmjs.com/trusted-publishers), edited 2026-10-06).
- Prompt Guard 2 is a small injection classifier ([model card](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M), undated). Classifier-only defences fall to adaptive attacks ([arXiv 2510.09023](https://arxiv.org/abs/2510.09023), 2025).

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| sec-1 | Improve | npm trusted publishing (OIDC), SHA-pinned actions, per-job `permissions` | S | H | `.github/workflows/release.yml`, `tests.yml`, `publish-smoke-test.yml` |
| sec-2 | Improve | Default-deny network egress for org roles (provider, registries, git forge; signed, overridable) | M | H | `org validate` warning first in `role-sandbox-restrictions.ts` and `cli/src/orgrt/cli-sandbox.ts`; flip the default in a later minor |
| sec-3 | Improve | `security scan` supports pnpm lockfiles and fails loudly without a lockfile | S | M | `pnpm audit --json` in `security-scan-commands.ts`; fix the CLAUDE.md and AGENTS.md lines that tell agents to run it |
| sec-4 | Improve | Unify the three secret redactors | S | M | `cli/src/orgrt/policy-secrets.ts` imports the `cli/src/utils/redaction.ts` patterns; add a parity test |
| sec-5 | Improve | Org prompt-injection fence: adopt a real classifier and broaden what it checks, or remove the fence and its claims | M/S | M | `cli/src/orgrt/session-gate.ts` and `cli/src/orgrt/fence.ts` (decision D9) |
| sec-6 | Improve | Content-safety consistency: align detector behaviour with its docs; doctor reports gate availability; wire or remove `enablePIIDetection`; document the destructive-command gate's real pattern list | M | M | Start with a doctor check and doc corrections |
| sec-7 | Improve | Evaluate `@anthropic-ai/sandbox-runtime` as a shared OS sandbox and egress layer for all runtimes | L | H | Spike branch that wraps one runtime |

### 2.9 Evals

**State**
- The only outcome evidence is the #723 pilot: 3 toy tasks × 3 arms × 1 rep, 0.74 USD, every run passed, and the results are not committed.
- The A/B runner passes the real HOME and the network to every arm (`tests/eval/ab/run.mjs:168`).
- The retrieval eval exists but does not run in CI (✔ #14).
- Doctor's "routing accuracy" never compares the pick with the agent actually used (`cli/src/monovector/route-outcomes.ts:244-261`).
- 34.5k lines under `tests/eval/org`, with three runners.
- Strong: pick-eval floors in CI, Wilson and paired-bootstrap statistics, blinded review.

**2026**
- Terminal-Bench 2.0 with the Harbor harness: at least 5 trials per task ([post](https://www.tbench.ai/news/announcement-2-0), 2025-11-07).
- Cursor found agents looking up fixes in `.git` or online; strict harnesses cut scores 14–20 points ([blog](https://cursor.com/blog/reward-hacking-coding-benchmarks), 2026-06-25).
- Inspect: per-sample sandboxes with `network_mode: none` and pass^k ([site](https://inspect.aisi.org.uk/), 0.3.291).
- `claude plugin eval`: compares against a no-plugin baseline and can gate CI ([docs](https://code.claude.com/docs/en/plugin-evals), undated).

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| ev-1 | Add | A retrieval-eval CI job with floors | S | H | `retrieval-eval` job in `tests.yml`; `tests/eval/retrieval/floors.json`; `--check-floors` |
| ev-2 | Improve | Isolate `tests/eval/ab` runs: temp HOME/XDG, auth file only, no network, no reads of hidden checks | S | M | `env` construction in `tests/eval/ab/run.mjs:168,182-186` |
| ev-3 | Improve | Durable results; pass^k and a minimum-detectable-difference line | S | M | Results under `tests/eval/**/results/`; `tests/eval/ab/lib.mjs` |
| ev-4 | Improve | Rename doctor's "routing accuracy", or count only explicit outcomes | S | M | `cli/src/commands/doctor-routing-checks.ts:50`, `route-outcomes.ts` |
| ev-5 | Improve | Run #723 on borrowed tasks (a Terminal-Bench 2 subset or SWE-bench Pro), off / lean / full, under a strict harness | M | H | A Harbor custom agent under `tests/eval/` (decision D1) |
| ev-6 | Remove | Superseded org eval scenarios (parallel-sweep v1); one report CLI | M | M | Delete the parallel-sweep v1 kit and manifest under `tests/eval/org/` |

### 2.10 CLI UX

**State**
- 39 commands, 314 subcommands and 994 options.
- `start` starts nothing.
- Unknown flags are accepted (✔ #19).
- There are five upgrade paths, and only `init --force` re-pins (✔ #3).
- The self-heal overwrites edited helpers and spawns `@latest` (✔ #2).
- The default doctor run missed five deliberate breakages.
- Init's last screen is wrong (✔ #22).
- Strong: `init --dry-run`/`--json`, FileGuard, `doctor --json`.

**2026**
- Claude Code plugins bundle skills, agents, hooks and MCP ([reference](https://code.claude.com/docs/en/plugins-reference)).
- Codex also reads the Claude marketplace file ([docs](https://developers.openai.com/plugins/build/plugins)).
- `vercel doctor` prints the exact next command for each check ([docs](https://vercel.com/docs/cli/doctor)).
- clig.dev: suggest typo fixes but don't run them, and don't ship both `update` and `upgrade` ([guide](https://clig.dev/)).
- All accessed 2026-11-20.

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| cli-1 | Improve | Pin the session-start repair to the installed CLI; one repair decision for self-heal, doctor and upgrade | S | H | `repairDecision()` in `cli/src/init/file-guard.ts`; replace the spawn at `session-restore-handler.cjs:234` |
| cli-2 | Improve | One `monomind upgrade`: re-pin MCP entries, refresh unedited assets, report only changed bytes; doctor checks the MCP pin and core hooks | M | H | `cli/src/init/upgrade.ts` calls `writeMCPConfig`; byte compare at `upgrade-steps.ts:237-238` |
| cli-3 | Improve | Strict flags: warn in release N, error in N+1; edit-distance cap; `REMOVED_COMMANDS` hints | S | H | `cli/src/index.ts` after `validateFlags`; `cli/src/suggest.ts` |
| cli-4 | Remove | `start`; correct init's last screen | S | M | Hide `start` with a notice; `init-action.ts:530,543-544` |
| cli-5 | Remove | Cut the command surface from 39 to about 24 (`route`→`pick`, providers into `config`, events into `ui`) | M | M | Hidden aliases with stderr notices |

### 2.11 Integrations (other hosts)

**State**
- The platform gate bug (✔ #8).
- The OpenCode plugin and config use v1 shapes (✔ #20), and v1 plugins do not run on OpenCode v2.
- Antigravity, Gemini CLI, Cursor, VS Code/Copilot and Kiro get no MCP config where they read it, yet their instructions name `mcp__monomind__*`.
- Skills are copied up to four times.
- No generated config is validated against an upstream schema.
- The `trae`, `hermes` and `zed` selectors write nothing.
- Strong: mesh inbox delivery on more than 10 hosts; managed-block merges that keep user text.

**2026**
- `.agents/skills` is read natively by Codex, Gemini CLI, OpenCode, Cursor, Copilot and Kimi ([docs](https://geminicli.com/docs/cli/skills/)).
- Copilot CLI installs Claude-format plugins ([docs](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)).
- The OpenCode v2 plugin migration ([docs](https://opencode.ai/docs/build/plugins/migrate-v1)).
- rulesync generates rules, MCP, skills and hooks for each tool ([repo](https://github.com/dyoshikawa/rulesync), v43.11.0).
- All accessed 2026-11-20.

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| int-1 | Improve | Fix the helpers gate for the Copilot, Pi and Kilo writers; add an `init --platforms <id>` test for every id | S | H | `cli/src/init/executor.ts:294-301`; `cli/__tests__/init-platform-side-writers.test.ts` |
| int-2 | Improve | Port OpenCode to v2 (keep v1 for Kilo); validate generated config against vendored schemas | M | H | `cli/src/init/opencode-generator.ts`, `opencode-mesh-plugin.ts`, plus a schema test |
| int-3 | Improve | Write MCP config where each host reads it (Antigravity, Cursor, Copilot/VS Code, Kiro, Pi) | M | H | `cli/src/init/write-antigravity.ts`, `cli/src/platform-adapters/renderers/mcp.ts` |
| int-4 | Remove | One skills layout, `.claude/skills` plus `.agents/skills`; retire the other copies | M | H | `cli/src/init/copy-assets.ts:126-140`, `scripts/generate-claude-trees.mjs` |
| int-5 | Remove | The `trae`, `hermes` and `zed` selectors; fold `gemini` into `antigravity` | S | M | `cli/src/platform-adapters/registry.ts:22-39` |

### 2.12 Browser and design (monobrowse, monodesign)

**State**
- Clicks report success even when they miss (✔ #12).
- Start/stop verbs fail as separate commands because their state lives in each process.
- All 45 test files are browser-free.
- About 17k lines in 6 months, close to a clone of agent-browser.
- monodesign is strong (51 rules), but it is an Impeccable fork that has not synced since May.

**2026**
- Playwright actionability checks ([docs](https://playwright.dev/docs/actionability), undated).
- Chrome DevTools MCP ([repo](https://github.com/ChromeDevTools/chrome-devtools-mcp), v1.13.0).
- agent-browser keeps a daemon between calls ([repo](https://github.com/vercel-labs/agent-browser), v0.43.0).
- Claude in Chrome is host-native ([docs](https://code.claude.com/docs/en/chrome.md)).
- Impeccable has 62 deterministic rules ([repo](https://github.com/pbakaus/impeccable), 4.10.0).

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| br-1 | Improve | Actionability in click, fill and hover (scroll into view, hit test, "covered by …") | S | H | `monobrowse/src/browser/actions-form.ts`, `actions-mouse.ts`, `snapshot.ts` |
| br-2 | Add | One real-Chrome end-to-end suite in CI | S–M | H | A file:// fixture test plus one Chrome job in `tests.yml` |
| br-3 | Improve | Start/stop verbs fail fast with "use `browse batch`" | S | H | Messages in `cli/src/commands/browse.ts` |
| br-4 | Remove (scope) | Stop growing monobrowse as a general driver; keep `report`, the login hand-off and what monodesign needs | M | H | A deprecation note for the general automation surface (decision D8) |
| br-5 | Improve | Re-sync monodesign with Impeccable, or depend on it; credit upstream | M | M | Port the 11 missing rules |

### 2.13 Packaging and the public site

**State**
- On npm 12 the native module's install script is blocked, the code graph never builds, and init still exits 0. Doctor's suggested fix builds nothing (`cli/src/commands/doctor-native-checks.ts:17`).
- The landing page tells users to `claude mcp add … @latest`, a step init has already done (`doc/index.html:333-378`).
- The tarball ships 2,174 source maps that cannot resolve (6.6 MB). The AI-SDK providers (about 34 MB) install by default.
- No published version carries provenance.
- Pages serves the docs as raw Markdown, and the CLI reference is hand-written.

**2026**
- npm trusted publishing ([docs](https://docs.npmjs.com/trusted-publishers)).
- Biome and Codex ship per-platform binaries as optional dependencies ([Biome](https://biomejs.dev/guides/manual-installation/)).
- Claude Code docs offer a `.md` per page and `llms-full.txt` ([example](https://code.claude.com/docs/en/install.md)).
- uv generates its CLI reference from code ([repo](https://github.com/astral-sh/uv/blob/main/README.md)).
- All accessed 2026-11-20.

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| pkg-1 | Improve | Install instructions match what init does; doctor's npm-12 fix line works (`npm install-scripts approve better-sqlite3`) | S | H | `doc/index.html`, `doc/getting-started.md`, `doctor-native-checks.ts:17` |
| pkg-2 | Improve | A sql.js fallback for Monograph now; `node:sqlite` behind an adapter later; init reports "graph not built" as a failure | M/L | H | The Monograph DB open path, plus a test with better-sqlite3 unavailable |
| pkg-3 | Remove | Source maps, monobrowse `src/` and tests, `preinstall.cjs`; add a size budget | S | M | Published `tsconfig`, monobrowse `files`, `scripts/check-cli-pack.mjs` |
| pkg-4 | Remove | Default install of the AI-SDK providers (install them on first use instead) | M | M | `cli/package.json`, `cli/src/utils/optional-deps.ts` |
| pkg-5 | Improve | Render the docs site; generate the CLI reference and `llms-full.txt` | M | H | `.github/workflows/pages.yml`; a generator next to `scripts/generate-doc-counts.mjs` |

### 2.14 Dashboard (`monomind ui`)

**State**
- 12 views, 126 route handlers and 28 routes with no UI caller.
- Many controls are broken in place: the org filter, key 4, Mark Complete, Store View, palette tabs, budget alerts, and graph and image previews that failed to load.
- The maintainer has decided to retire `/orgs` and `/mastermind` and port their unique tabs into the Orgs view.
- The dashboard review has fix PRs in progress (script-integrity test, broken features, retiring the org pages, org-route path fixes).

| ID | Kind | Item | E | I | First PR |
|---|---|---|---|---|---|
| ui-1 | Improve | Fix the broken features listed above | M | H | Dashboard PR "fix broken features" |
| ui-2 | Remove | Retire `/orgs` and `/mastermind`; port Roles, Activity and Health into the Orgs view | M | H | Dashboard PR "retire org pages" |
| ui-3 | Improve | Org routes read `.monomind`, label stopped runs correctly, and pass `?dir=` | S–M | H | Dashboard PR 7 |
| ui-4 | Remove | Stale code: the Playbook/Workflow view, the Monograph Query tab, palace leftovers, swarm-era labels, 17 routes with no caller | M | M | Dashboard PR "remove stale" |
| ui-5 | Add | Org lifecycle (start, pause, resume, reload), a doctor panel and a Mesh panel | M | H | Dashboard PR 6, after ui-2 |

### 2.15 Docs

The docs review found about 140 claims that disagreed with the code, plus 48, 46 and 63 drift entries from the three state-of-the-art reviews. Its corrections go in separate PRs, grouped by area. The recurring patterns:
- Overstated capability: "9 background workers" (all of them run on demand), "trains patterns", `agent spawn` described as spawning an agent.
- Wrong defaults: the HNSW threshold, the language count.
- Removed commands still shown.
- Links that 404 on the published site.

This plan does not repeat those fixes. It covers the code changes that make the docs true. A few code bugs the docs review found are folded into the roadmap: the hard-coded MCP version, `memory search -t` being ignored, and the statusline's LIVE dot.

---

## 3. Roadmap

Each roadmap item merges the duplicates listed in its "From" column, and gives effort, impact, dependencies, and the first PR. Every PR ships alone and green (`pnpm run lint`, `node scripts/ci/check-skips.mjs`, `pnpm run test:all:run`, plus `sync:claude-trees:check` when `.claude/` changes).

### Phase 0: fix what is broken or false, and remove what does not earn its keep

The goal: nothing reports success it did not have, and nothing claims a capability that does not exist. Most items are S.

| ID | Item | From | E | I | Depends on | First PR |
|---|---|---|---|---|---|---|
| P0-1 | MCP stdio: one handler, spec-shaped results, `isError` kept, stdout reserved for protocol | mcp-1 | S | H | none (lands before P0-11, P1-5) | `fix(mcp): route both stdio loops through handleMCPMessage`, with a contract test |
| P0-2 | Stop floating `@latest`: the self-heal uses the installed CLI; doctor compares the MCP server version and pin with the CLI; `serverInfo` reports the real version | cli-1, kg (stale server), mcp-8, pkg-1 | S | H | none | `fix(helpers): pin the session-start repair to the installed CLI` |
| P0-3 | Honest first five minutes: install docs match init; correct init's last screen; npm-12 doctor line; "graph not built" is a failure | pkg-1, cli-4, int (post-init text) | S | H | none | `fix(init): per-platform next steps; drop swarm init and the claude mcp add step` |
| P0-4 | Memory honesty: report the search method, the namespace fix, the download docs | mem-1 | S | H | none | `fix(memory): knowledge_search reads the default namespace; doc search reports its method` |
| P0-5 | Monograph Variable line numbers | kg-1 | S | H | none | `fix(monograph): keep newlines when stripping non-code braces` |
| P0-6 | Init platform gate for Copilot, Pi and Kilo | int-1 | S | H | none | `fix(init): write the copilot/pi/kilo side files without the claude target` |
| P0-7 | Browser clicks fail when they miss; start/stop verbs fail fast | br-1, br-3 | S | H | none | `fix(monobrowse): scroll into view and hit-test before clicking` |
| P0-8 | `org replay` leaves `runtime.json` alone | org-1 | S | H | none | `fix(org): replay writes only its own bus` |
| P0-9 | Release supply chain: trusted publishing, SHA-pinned actions, per-job permissions | sec-1, pkg (provenance) | S | H | the maintainer configures the npm-side trust (D10) | `ci(release): publish with OIDC trusted publishing` |
| P0-10 | Security scan supports pnpm and fails loudly without a lockfile | sec-3 | S | M | none | `fix(security): use pnpm audit when pnpm-lock.yaml exists` |
| P0-11 | **Removal series** (one series, so doc counts change once): dead MCP families; `claims_*`/`agent_pool`/`agent_health`; trajectory tools; thin memory tools | mcp-2, co-1, hk-3 (tools), mem-4 (tools) | M | H | P0-1, P0-19 | `remove(mcp): browser/claims/terminal/config/github/performance/guidance/quality/platforms families` |
| P0-12 | **Honesty pass on invented numbers**: statusline figures, learning labels and `--train`, `hooks_explain` weights, hook advisories A1–A3, doctor "routing accuracy" renamed, success label | hk-3, rt-1, rt-4, ev-4, hk-6 | S–M | M | none | `remove(hooks): placeholder SONA/EWC/MoE/LoRA/Flash readouts and --train` |
| P0-13 | Retrieval eval in CI with floors: the evidence for the graph-first decision | ev-1 | S | H | none | `ci(eval): run tests/eval/retrieval with floors` |
| P0-14 | Dead hook plumbing: `executeHooks`, dead workers, unread settings keys, dead helpers and stores | hk-1, hk-5, mem-4 (stores) | S each | M | none | `remove(hooks): executeHooks bridge calls with an empty registry` |
| P0-15 | Strict CLI flags, warning stage | cli-3 | S | H | check that generated hook commands pass only declared flags | `feat(cli): warn on unknown flags with did-you-mean` |
| P0-16 | Remove agent definitions for machinery that does not exist; remove bookkeeping mastermind skills (fix or delete the import, backup and env skills first) | co-2, org-4 | S–M | M | `sync:claude-trees` | `remove(agents): swarm-era optimization agents` |
| P0-17 | Dashboard fixes already in progress | ui-1, ui-3 | M | H | none | dashboard PRs |
| P0-18 | Two security items are tracked privately (not described here) | n/a | n/a | H | n/a | n/a |
| P0-19 | **`.claude/` prompts call only tools hosts can reach.** About 88 skill, command and agent files carry 264 references to about 50 non-advertised `mcp__monomind__*` tools (for example `agent_spawn` in `.claude/agents/github/*`). The docs review keeps the file list with its findings. Point each at an advertised tool, a CLI command or a host tool; add a `sync:claude-trees:check` rule that fails on a non-advertised `mcp__monomind__*` | mcp-3 | M | H | `sync:claude-trees`; lands before P0-11 | `fix(claude): point .claude prompts at reachable tools; check rejects non-advertised mcp refs` |

### Phase 1: make the core correct, reachable and host-aware

| ID | Item | From | E | I | Depends on | First PR |
|---|---|---|---|---|---|---|
| P1-1 | Working-tree-aware graph freshness | kg-2 | M | H | none | `fix(monograph): treat uncommitted source changes as stale` |
| P1-2 | Semantic memory reachable by default | mem-2 | M | H | D3; measure download size and time | `feat(memory): first-use model download behind MONOMIND_NO_AUTO_INSTALL` |
| P1-3 | Per-prompt injection searches the real document store and the global brain | mem-3 | M | H | latency budget (P1-9) | `feat(hooks): FTS5 knowledge injection without the dashboard` |
| P1-4 | Remove hide-and-search: CLI-backend tools move to direct imports; delete `monomind_tool_search`; one profile setting | mcp-4 | M–L | H | P0-11 | `refactor(cli): import agent/task/session/hooks handlers directly` |
| P1-5 | MCP annotations, `title`, `outputSchema`, `protocolVersion` negotiation | mcp-5, mcp-6 | S–M | H | P0-1 | `feat(mcp): tool annotations; read-only tools run in parallel` |
| P1-6 | One `monomind upgrade`; doctor sees what upgrade must fix | cli-2 | M | H | P0-2 | `feat(cli): upgrade re-pins .mcp.json and refreshes unedited assets` |
| P1-7 | One skills tree for non-Claude hosts (`.agents/skills`) | int-4 | M | H | check the Antigravity project skills dir | `remove(init): .gemini/.opencode/.kimi-code skill copies` |
| P1-8 | MCP config where each host reads it; OpenCode v2; schema-validating tests | int-2, int-3 | M | H | D7 (OpenCode v1/v2) | `feat(init): OpenCode v2 plugin and config` |
| P1-9 | Hook latency: `async` side-effect hooks; cache the `mesh-inbox` process walk | hk-4 | M | H | P0-14 | `perf(hooks): mark side-effect-only hooks async` |
| P1-10 | Statusline reads host stdin JSON; cost comes from the host | hk-2, hk-6 | M | M | P0-12 | `feat(statusline): read model, cost, context and rate limits from stdin` |
| P1-11 | Durable org task state | org-2 | M | H | none | `feat(org): checkpoint on every TaskDag change` |
| P1-12 | `org set` with re-signing; move the editing skills onto it | org-3 | M | H | none | `feat(org): org set validates and re-signs` |
| P1-13 | Default-deny egress for org roles, warning stage | sec-2 | M | H | none | `feat(org): org validate warns on open egress` |
| P1-14 | Retire the RouteLayer from live paths | rt-2 | M | M | one deprecation release | `refactor(agent): spawn --task uses pickAgents` |
| P1-15 | The `[PICK]` A/B and a held-out pick set | rt-3, rt-4 | M | H | P0-12 (success label) | `feat(pick-eval): PICK-on vs PICK-off from real logs` |
| P1-16 | Monograph works without the native module (sql.js fallback) | pkg-2 | M | H | performance check on a 112k-node graph | `feat(monograph): sql.js fallback when better-sqlite3 is unavailable` |
| P1-17 | Mesh wake-on-message; Mesh and org mailbox bridge; document the Mesh | co-3, co-4, co-6 | M | H | confirm the Stop-hook schema | `feat(mesh): deliver ask messages before idle` |
| P1-18 | Isolated, durable and powered eval runs (the free part of #723) | ev-2, ev-3 | S–M | M | none | `fix(eval): temp HOME and no network for ab runs` |
| P1-19 | Ship less: source maps, test files, providers on first use, size budget | pkg-3, pkg-4 | S–M | M | none | `build(cli): stop shipping unresolvable source maps` |
| P1-20 | Command surface from 39 to about 24; strict flags, error stage; `start` removed | cli-5, cli-3, cli-4 | M | M | P0-15, D11 | `refactor(cli): fold route into pick behind a hidden alias` |
| P1-21 | Content-safety consistency and redactor unification | sec-4, sec-5, sec-6 | M | M | D9 | `refactor(security): one secret redactor with a parity test` |
| P1-22 | Docs site rendered; CLI reference generated; `llms-full.txt` | pkg-5 | M | H | the docs review's link fixes | `docs(site): render doc/ with a static generator` |
| P1-23 | Dashboard: retire the org pages, remove stale code, add the missing UI | ui-2, ui-4, ui-5 | M | H | P0-17 | dashboard PRs |
| P1-24 | Browser end-to-end CI; monodesign re-synced with upstream | br-2, br-5 | S–M | M | P0-7 | `test(monobrowse): real-Chrome actionability suite` |

### Phase 2: strategy, decided on evidence

| ID | Item | From | E | I | Depends on | First PR |
|---|---|---|---|---|---|---|
| P2-1 | Outcome eval #723 on borrowed tasks under a strict harness | ev-5 | M | H | D1 (spend), P1-18 | A Harbor custom agent for "Claude Code + monomind init" |
| P2-2 | Reposition the generated CLAUDE.md/AGENTS.md: the host LSP handles exact lookups, Monograph handles task and change scope; monomind memory handles cross-runtime and document knowledge; `[PICK]` becomes a hint | kg-3, mem-5, rt-5 | S | H | P0-13 numbers (D2), P1-15 result (D4) | `docs(init): graph-first rule follows the retrieval eval` |
| P2-3 | Org-skill search as a pull search; agent `[PICK]` skills-only by default | rt-6, rt-5 | M | H | P1-15, D4 | `feat(pick): kind skills as the default hook output` |
| P2-4 | Ship monomind as a Claude-format plugin and marketplace, with hooks in the plugin; make `init` thin | cli (plugin), int (plugin), hk (plugin) | L | H | P1-6, P1-7, P1-20, D6 | `feat(init): --as-plugin generates plugin.json and marketplace.json` |
| P2-5 | Knowledge-graph temporal validity, then opt-in consolidation at session end | mem-6 | M–L | M | P1-2 | `feat(memory): invalidate superseded KG edges` |
| P2-6 | Incremental Monograph rebuild; semantic code search must earn its place (AST-chunk embeddings) or be removed | kg-7, kg-5 | L | M | P1-1, published eval numbers | `perf(monograph): re-parse changed files and their importers` |
| P2-7 | Default-deny egress becomes the default | sec-2 | S | H | P1-13 has run for one minor | `feat(org): default egress allowlist` |
| P2-8 | Opt-in OpenTelemetry for hooks and the org bus; retire the hand-written JSON logs | hk-7, org-7 | M | M | D12 | `feat(telemetry): monomind init --telemetry` |
| P2-9 | Org trust and cost: opt-in evidence re-run; budgets over time | org-5, org-6 | M | H | P1-11 | `feat(org): budget_window checked before each scheduled tick` |
| P2-10 | A generic ACP runner with a Gemini CLI preset | co-5 | L | H | choose an ACP library | `feat(orgrt): ACP runner` |
| P2-11 | `node:sqlite` adapter for Monograph and memory | pkg-2 | L | M | P1-16, D13 | `refactor(storage): one SQLite adapter` |
| P2-12 | An HTTP transport rebuilt stateless on the 2026-07-28 revision, or none | mcp-7 | M | L | D5 | n/a until decided |
| P2-13 | Shared OS sandbox and egress layer (sandbox-runtime spike) | sec-7 | L | H | P1-13 | Spike branch |
| P2-14 | Retire the general automation surface of monobrowse | br-4 | M–L | H | D8, P1-24 | Deprecation notice release |

### Sequencing rules

- P0-1 lands before every other MCP change: P0-11, P1-4 and P1-5 touch the same handler.
- P0-19 rewrites the `.claude/` references in its own PR before P0-11 removes any tool. Its `sync:claude-trees:check` rule keeps them from coming back, so each removal in P0-11 fails the check until no prompt names the removed tool.
- P0-13 (the retrieval eval) comes before P2-2 (the graph-first rewrite). P1-15 (the `[PICK]` A/B) comes before demoting `[PICK]` in P2-2 and P2-3.
- P1-6, P1-7 and P1-20 come before plugin packaging (P2-4).
- Egress, P0-15/P1-20 strict flags, and the tool removals each use a warning stage first. Breaking removals ship with a CHANGELOG list and one deprecation release.

---

## 4. Remove list

Each line names what to delete and why. Removals follow the warning or deprecation stage in section 3.

| What | Why | Roadmap |
|---|---|---|
| MCP families browser (28), claims (12), terminal (5), config (6), github (5), performance (6), guidance (5), quality (2), platforms (1) | Not advertised, not callable from hosts, and nothing else uses them. They duplicate host or CLI features. | P0-11 |
| `monomind_tool_search` and the hidden-tool model | Returns schemas that hosts cannot call. Hosts already defer tools natively. | P1-4 |
| `agent_*`, `task_*`, `session_*`, `hooks_*`, `system_*`, `analyze_*` as MCP tools | These are CLI back ends; the commands can import the handlers directly. | P1-4 |
| `MONOMIND_MCP_FULL`, `MONOGRAPH_MCP_ADVANCED` | Fold them into one profile setting. | P1-4 |
| `hooks_intelligence_trajectory-*` (3 tools), `hooks intelligence train`, `--train`, SONA/EWC/MoE/LoRA/Flash readouts | They claim learning that does not happen: zero callers, and zero records ingested. | P0-11, P0-12 |
| About 10 thin memory MCP tools (`hierarchical-*`, `session-*`, `context-synthesize`, `controllers`, `causal-edge`, `memory_route`, `memory_semantic-route`) | Labels or concatenation over one store; routing belongs to `pick`. | P0-11 |
| `executeHooks` bridge calls | They run an empty registry on every task, edit and session event. | P0-14 |
| Workers `health`, `progress`, `cache` (and `reflexion` unless it gets a reader) | No automatic run and no reader. | P0-14 |
| Settings keys `learning.*`, `ddd.*`, `security.*`, `…trainPatterns`; the repo's `monomind.daemon` block | Configuration that suggests behaviour nothing implements. | P0-14 |
| `.claude/helpers/memory.cjs`, `metrics-db.mjs`, the never-installed generated `pre-commit` | Required but unused, or unreferenced. | P0-14 |
| The `.swarm/memory.db` and `.claude/memory.db` that `memory init` creates; the session-start knowledge preload; `memory configure --hnsw-*` flags | They split the store, inject nothing, and write config nothing reads. | P0-14 |
| Hook advisories `[INTELLIGENCE]`, `[AGENT_PATTERN]`, `[ROUTING]`; `routing-outcomes.json`; the fixed `hooks_explain` weights | Dead in user projects or built on a substring label; up to 2 s per prompt. | P0-12 |
| `@monoes/routing` RouteLayer, `route semantic`, `hooks_route_semantic` | Deprecated, uncalibrated (85–89% "confident" on off-domain tasks), and slow. | P1-14 |
| The jq scorer in mastermind-agent-select; one of the two copies of the decision logic | A third keyword ranker, plus duplicated gating logic. | P1-14 |
| The single-word `[MONOGRAPH_HINT]` injection; `monomind monograph lsp` and the `./lsp` export | Noise in context; a custom server that nothing launches, while host LSPs do this better. | P0-12, P1-1 |
| `claims_*`, `agent_pool`, `agent_health`, `swarmRecommendation`, the topology/consensus/`maxAgents` keys, `start`'s Topology box | Records and printouts that change no behaviour. | P0-11 |
| Agents Topology Optimizer, Load Balancing Coordinator, Resource Allocator, security-manager | They describe a swarm that was removed in 2.22.0. | P0-16 |
| 7 "Deprecated: bookkeeping only" mastermind skills plus about 9 more with no reader (routine-detail, plugins, plugin-settings, adapter-manager, bootstrap, profile, workspaces, workspace-detail, instance) | They write side files that nothing reads, and cost context in every session. | P0-16 |
| The `start` command; `update rollback`/`history`; one of `providers`/`config providers` | `start` starts nothing; rolling back is the package manager's job; there are two implementations of one job. | P1-20 |
| `.gemini/skills`, `.opencode/skills` and `.kimi-code/skills` copies; the Aider skills mirror | `.agents/skills` is read natively; Aider reads no skills. | P1-7 |
| The `trae`, `hermes` and `zed` platform selectors; `kimi-generator-statusline.ts` | They write nothing a host reads; the file has no callers. | P1-20 |
| 2,174 source maps (6.6 MB), monobrowse's shipped tests, `cli/bin/preinstall.cjs`, the stale `alpha` dist-tags, `scripts/install.sh` (or fix it) | Unresolvable, unreferenced or broken. | P1-19 |
| The HTTP/WebSocket MCP transport in its current form | Not interoperable with spec clients, and configured for no host. | P2-12 (D5) |
| The dashboard `/orgs` and `/mastermind` pages, the Playbook/Workflow view, the Monograph Query tab, palace code, 17 routes with no caller | Decided (pages) or unreachable. | P1-23 |
| The CLI's copies of the monobrowse adapters and action-builder; the duplicate palette-seed table | Diverged copies. | P1-24 |
| Superseded org eval scenarios (parallel-sweep v1) and two of the three report CLIs | Stopped by the owner, yet still costing CI time. | P1-18 |

---

## 5. Decisions needed from the maintainer

| # | Decision | Options and recommendation |
|---|---|---|
| D1 | **#723 outcome-eval spend.** The pilot extrapolates to about 7–37 USD for a run that can tell the arms apart. | **Recommended:** approve about 37 USD for a Terminal-Bench 2 subset or SWE-bench Pro public, off / lean / full, ≥3 reps, after the free isolation work (P1-18). Freeze new org-eval surface until one baseline exists. |
| D2 | **The CLAUDE.md "ALWAYS monograph_query before grep" rule.** The free eval (n=31) has the graph at MRR 0.58 versus 0.70 for `rg`, and 0/12 on callers/tests, but 1.00 versus 0.52 on plain lookups. | **Recommended:** revisit once the P0-13 CI job publishes numbers. Likely outcome: graph-first for task scoping (`monograph_brief`, impact, tests to run), host LSP or `rg` for exact references and callers. |
| D3 | Turn embeddings on by default (a first-use download of the model and runtime) or keep them opt-in. | **Recommended:** download on first use, behind the existing opt-out. Never block org runs. Measure first. |
| D4 | The `[PICK]` agent half. | **Recommended:** run the A/B (P1-15), then default to skills-only, with agent picks behind a flag. Drop "use it unless clearly wrong" from the generated text. |
| D5 | The HTTP MCP transport. | Retire it, or mark it experimental until a stateless 2026-07-28 rebuild. |
| D6 | Plugin packaging. Plugin skills are always namespaced, so the plugin would be named `mastermind` to keep `/mastermind:*`. Third-party marketplaces do not auto-update by default. Per-project skill edits stop working. | **Recommended:** ship behind a flag after P1-6/P1-7/P1-20. |
| D7 | OpenCode v1 versus v2. | Detect the host version, or ship two emitters. Kilo still documents v1. |
| D8 | Retire monobrowse's general automation surface (users of `monomind browse` need a migration note); session daemon or fail fast. | **Recommended:** fail fast now; deprecate the general surface; keep `report`, the login hand-off and monodesign's needs. |
| D9 | The org prompt-injection fence: invest in a real classifier, or remove the fence and its claims. | Either is defensible. The current partial state is not. |
| D10 | Configure npm trusted publishers and remove the `alpha` dist-tags. These are maintainer actions outside CI. | Required for P0-9. |
| D11 | Local-only usage counters. They are off by default, so the "measure first" stage of surface reduction collects no data. | **Recommended:** prompt once at init. This also informs `task`/`session`/`agent spawn` deprecation. |
| D12 | Opt-in OpenTelemetry as the one telemetry path, replacing the hand-written JSON logs. | **Recommended:** yes, opt-in. |
| D13 | SQLite engine: a sql.js fallback now, and/or `node:sqlite`, which is unflagged but experimental at the Node 22.22 floor. | **Recommended:** sql.js fallback now (P1-16), `node:sqlite` later (P2-11). |
| D14 | Final advertised MCP roster size, and the advertise-or-drop call on the remaining hidden tools. | **Recommended:** about 21–30 tools, under about 25 KB of schemas. |
| D15 | The egress default flip date (orgs that rely on open internet will need an allowlist). | **Recommended:** a warning for one minor, then flip. |
| D16 | Ingest host memory files (Claude Code `MEMORY.md`, Codex memories, `GEMINI.md`) read-only into the Second Brain. | Only as an explicit opt-in, with an updated privacy note. |
| D17 | The repo-root `opencode.json` and `.kimi-code/mcp.json` float `@latest` and carry unread env vars. | **Recommended:** pin the repo configs once their local edits are settled. |
| D18 | Remove the dashboard board skills (issues, tasks, goals and similar) and the dashboard views that read their side files. | A second task system that the runtime never reads. **Recommended:** remove after ui-2. |

### Already decided

- The 264 unreachable `.claude/` tool references are fixed in their own Phase 0 PR (P0-19), not in a docs PR and not inside the removal series.
- `CLAUDE.local.md` stays untouched, including its env block that lists variables no code reads. No plan item edits it.
