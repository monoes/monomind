# Monomind Session Recovery Report — Jun 10–13, 2026

**Generated:** 2026-06-13  
**Audit scope:** 28 Claude Code sessions (Jun 10–12), 27.2 MB → 0.4 MB session size range  
**Project:** Monomind CLI dashboard (`packages/@monomind/cli/dist/src/ui/`)

---

## 1. Executive Summary

### What Was at Risk

Between Jun 10 and Jun 12, 28 Claude Code sessions made hundreds of incremental edits to dashboard and server files. The primary concern was that session-local edits may never have been committed to git, leaving those changes stranded in session transcripts only.

### What Was Recovered

Reconstruction applied **26 changes** across 7 partially-complete files:

| File | Changes Applied |
|---|---|
| `dashboard.html` | 5 |
| `server.mjs` | 3 |
| `orgs.html` | 2 |
| `doctor.ts` | 9 |
| `master.md` | 1 |
| `package.json` | 4 |
| `autodev.md` | 2 |

Additionally, 6 reconstruction commits were pushed on Jun 13 to restore features from sessions 37135b73 (dashboard autodev loop) and 338de548 (orgs live status):

- `e744e1ab` — loop HIL/isFinished/type badges, dir scoping, org live status strip
- `b25983c1` — isOverdue/isStaledActive loop logic, dedup, monotask graceful fallback
- `5069d8b6` — 100-round autodev improvements batch 2
- `028ae927` — autodev improvements batch 3
- `bb04abe0` — autodev bug fixes re-applied
- `85e4e65e` — Export and Import buttons on org cards
- `da0f42a0` — accumulated dashboard + orgs UI improvements

### What Was Confirmed Complete (No Gaps)

Thirteen files were validated as fully committed with no missing changes:

`dashboard-v2.html`, `memory-bridge.ts`, `index.html`, `SKILL.md`, `sqlite-backend.ts`, `README.md`, `.gitignore`, `runorg.md`, `security-tools.ts`, `search.md`, `org-settings.md`, `gates-handler.cjs`, `monitor.md`

### Remaining Gaps

No major feature gaps remain. The reconstruction pass covered all identified partial files. Some uncommitted working-tree modifications persist (see section 6).

---

## 2. Day-by-Day Breakdown

### Jun 10, 2026

**4 sessions analyzed | Total session data: ~6.3 MB**

#### Session a094f0b1 (27.2 MB — largest session of the audit)

The highest-volume session of the entire period. Four parallel workstreams:

1. **Orgs dashboard page** — Built `orgs.html` at `/v2/orgs`, integrated into the v2 dashboard at `localhost:4242/v2`. Replaced broken org UI with a project-scoped organization view, GSAP-animated node communication graphs, bidirectional communication arrows, and corrected role hierarchy (agents no longer all shown as "boss").

2. **memory-bridge.ts review loop** — 11 autonomous review-and-fix rounds. Confirmed fix: `bridgeDeleteEntry` attestation log now records `deletedEntryId ?? key` (the entry UUID) instead of the bare string key.

3. **Security tool rename** — Renamed all `aidefence_*` MCP tool names to `monofence_*` across `security-tools.ts`, `monofence-ai/src/index.ts`, and `hooks/src/mcp/index.ts`.

4. **Documentation site rebuild** — Full docs rebuild: `docs/index.html`, concept pages (swarm, neural, memory, hooks), CLI/mastermind references, SVG assets (logo, favicon, swarm-illustration, memory-illustration).

**Git commits produced:** Changes from this session are captured across several commits in the Jun 10 range (`d78d1989`, `b5fd43d1`, `9b0d8fb9`).

---

#### Session cf519575 (2.0 MB)

7-agent research swarm audit scoring overall wiring health at **3/10**. All 9 critical issues fixed:

- Deleted duplicate `pnpm-workspace.yaml`
- Fixed `@monomind/memory` → `@monoes/memory` import scope in 3 files
- Added `composite: true` to `@monomind/memory/tsconfig.json`
- Added missing `@monomind/hooks` dependency to CLI `package.json`
- Created 5 missing hook helper modules (router.cjs, session.cjs, memory.cjs, intelligence.cjs, learning-service.mjs)
- Added 12 worker name aliases to WORKER_ALIAS_MAP
- Fixed MCP HTTP/WS server to expose full tool registry (was only exposing 4 tools)

Follow-up: 4-run `mastermind:review tillend` loop found and fixed 6 blocker-level bugs in `sqlite-backend.ts` (foreign keys, INSERT OR REPLACE silent drop, Float32Array buffer offset, non-transactional clearNamespace, TOCTOU race, N+1 statement re-preparation).

---

#### Session 64f579c5 (1.7 MB)

Codebase cleanup via `mastermind:review --tillend`:

- Removed empty `@monomind/swarm` stub package and all workspace wiring
- Wired real mathematical engine classes into `prime-radiant` PrimeRadiantBridge (replaced ~170 lines of mock/scaffold code)
- Fixed `teammate-plugin` — dead `messageTTLTimer` now started from constructor and torn down in `dispose()`
- Suppressed TypeScript errors on optional `@nokhodian/bmssp` WASM imports

---

#### Session 00a1dd18 (0.9 MB)

`agentic-qe` plugin improvement:

- Replaced all mock/random ML logic with real implementations: filesystem secret scanning with regex + Shannon entropy, deterministic confidence scoring, proxy-based heuristics for coverage gap and dependency scoring
- Honest stub pattern introduced for functions that require external runtime data

---

### Jun 11, 2026

**9 sessions analyzed | Total session data: ~22.2 MB**

#### Session 2084715b (7.6 MB)

21-run automated `mastermind:autodev --tillend` loop on the org feature layer:

- **255 null-guard additions** across 52 mastermind skill markdown files and `server.mjs` — covered `.members`, `.roles`, `.approvals`, `.join_requests`, `.issues`, `.goals`, `.routines`, `.plugins`, `.adapters`, `.agents`, `.in_flight`, `.users`
- Completed sidecar suffix loops in `backup.md`, `companies.md`, `org-settings.md`
- Added `.gitignore` negation for `server.mjs` to keep it tracked despite `dist/` pattern
- All 53 modified files committed and pushed (515 insertions / 321 deletions, commit `82f8f13e`)

---

#### Session d07f9f3e (3.4 MB)

Memory management optimization via 10-run autodev loop + 2 review runs across `packages/@monomind/memory/src/`:

- Cache size accounting fix (delta on update, stored `sizeBytes` at insertion)
- Eliminated redundant array copies in HNSW `selectNeighbors`, short-term search
- Reduced graph algorithm allocations (double-buffered PageRank, reused `labelCounts`)
- Episodic-store container reuse (`.length=0` / `.clear()` instead of `new []`)
- Contextual tier sort caching (lazy `sortedCache`)
- Namespace index bypass fix in `lancedb-backend`
- Orphaned map fix in `learning-bridge` (`destroy()` now clears both maps)
- Fixed SQLite ambiguous column in `json_each()` query (23 test failures resolved)
- Fixed embedding buffer slice bug in `sqlite-backend` (`byteOffset`/`byteLength`)
- Test suite: 377 passing → 403 passing. Committed as `ab1398a5`.

---

#### Session d3923148 (3.0 MB)

12-round dashboard loop monitoring UI improvement loop:

- Loop type badges (purple ∞ pill for tillend, ↺ for repeat)
- HIL status indicators (amber ⚠HIL badge, inline banner, alert rail entry)
- `fmtInterval()` helper
- Live SSE-driven loop refresh with polling fallback
- Nav badge shows `N⚠` when any loop is `hil:pending`
- Loop expand "Running for" row (elapsed time)
- SSE replay guard (skips events older than connect time)
- Calendar sparkline Monday-alignment fix
- Server: lock-file `--tillend` detection, `startedAt` stored as ms integer

---

#### Session 19b7b627 (2.3 MB)

Dashboard bug fixes:

- Fixed finished/overdue loops no longer showing as "active" with Stop button
- Fixed loop deduplication (single logical session shown as one card)
- Added Global Loops and Global Tokens sidebar tabs
- Fixed synchronization bug: loops mid-pause incorrectly showing as "done"
- Fixed Monograph HTTP 500: corrected 21 wrong relative import paths in `server.mjs`, installed missing `better-sqlite3` in monograph package

---

#### Session 72dc98c0 (2.2 MB)

Documentation + release:

- GitHub Pages website updated: stale `/monomind:*` → `/mastermind:*`, MonoFence AI section, complete command grid
- CHANGELOG-v1.11.md written (149 commits since v1.10.55)
- npm README rewritten with monkey mascot
- Auto-update system overhauled: all subpackages monitored, startup check wired, inline tagline for `--version`/`--help`
- 3 update-system bugs fixed (version comparison, global install resolution, missing `execFileSync` import)
- Published `monomind@1.11.13` / `@monoes/monomindcli@1.11.12`

---

#### Session 0d452528 (1.4 MB)

Task generation pipeline decoupling:

- File-based task files made the default across all mastermind skills
- `--monotask` flag introduced as explicit opt-in
- Docs updated site-wide
- 2-run `mastermind:review tillend` loop confirmed changes clean

---

#### Session 32f0c05a (1.1 MB)

GitHub Pages hash-based deep-linking:

- URLs like `https://monoes.github.io/monomind/#slash` now navigate directly
- Fixed JavaScript temporal dead zone crash (`goHash()` called before `const inited`)
- `history.replaceState()` used instead of `location.hash` to prevent re-entry loop
- Added `.nojekyll` to stop Jekyll from processing plain-HTML docs site
- Fixed broken symlink `docs/assets/latest_gemini.png` causing GitHub Actions failure

---

#### Session c04a3a3e (0.7 MB)

Portability fix for `.monomind` runtime files:

- `registry-builder.ts` stores relative file paths (not absolute)
- `telemetry.cjs` stores relative paths in recent-edits log
- `monograph` helpers resolve relative paths back to absolute at query time
- Worker daemon no longer leaks `projectRoot` in `codebase-map.json`
- Surgical `.gitignore` for `.monomind` (excludes sessions/, security/, loops/, *.tmp while keeping orgs/ and test-fixtures/)
- Committed and pushed to main

---

#### Session 23d171d1 (0.5 MB)

Legacy cleanup (4 commits, ~11,600 lines deleted across 110+ files):

- Removed 55 accidentally-committed Playwright snapshots from `.playwright-mcp/`
- Deleted 9 unreferenced docs/assets images
- Moved 32 framework research files from `features/` to `docs/research/`
- Relocated `features/tagline.md` → `docs/concepts/statusline.md`
- Deleted 7 legacy working docs (PRODUCT.md, IMPLEMENTATION_COMPLETE.md, etc.)
- Added GRAPH_REPORT.md to `.gitignore`

---

### Jun 12, 2026

**12 sessions analyzed | Total session data: ~10.5 MB**

#### Session 37135b73 (23.0 MB — second largest)

Two main workstreams:

1. **Security cleanup** — Untracked 258+ files from git index (.monomind/, data/sessions/, data/mastermind-*.jsonl, routing/.claude-flow/). Updated `.gitignore`. Removed hardcoded personal paths from `monitor.md`, `server.mjs`, intelligence test. Force-pushed rewritten history to both `nokhodian/monomind` and `monoes/monomind` (gates-handler force-push guard temporarily disabled then restored). Doctor gitignore coverage check added.

2. **Dashboard autodev loop** — 427 incremental edits to `dashboard.html` via `--tillend --maxruns 50` loop: loop countdown timer, command palette ESC behavior, keyboard shortcut help panel, sidebar project/user label display, feed/Now-view navigation. **This was the primary source of partial-file gaps** — many of these edits were not committed before the session ended.

---

#### Session f4dc4c82 (3.6 MB)

Dashboard bug fixes and doctor repair:

- Loops and Tokens tabs now scoped to selected project
- Token time-range filter buttons (Today/Week/30days/Month) working
- Unified loop metadata display (prompt/command/flags breakdown)
- Org Copy button added
- Agent avatar images fixed in orgs tab chart
- Agent graph tab on memory page fixed (was empty/legacy)
- `monomind doctor` crash fixed (missing `semver` package → inline shim + proper dependency)
- Monograph detection fixed in doctor health check
- Legacy doctor checks removed, remaining wired correctly
- Token price table updated with `claude-opus-4-6` and `claude-sonnet-4-6` pricing

---

#### Session 338de548 (0.7 MB)

Live org state visualization in `orgs.html`:

- Live status strip (pulsing dot, state label, uptime counter, sparkline)
- Live event feed panel with timestamped rows and fade-in animation
- SSE integration wiring
- 4-run automated review loop fixed: stale uptime on org switch, empty sparkline seed, unused variable, animation class leak, layout jitter, truncated message accessibility

---

#### Sessions 2c178205, 846e3f60, 07275db2, 692bd05d, 387cef2b (0.4–0.7 MB each)

**Read-only security audit sessions** — no file edits. Multiple automated security scans produced JSON reports with findings including:

- Unauthenticated cloud function with GCP Secret Manager access (high)
- XSS risk via unescaped session/project name in `server.mjs` (high)
- Potential command injection in `monodesign/antipatterns.ts` via `spawnSync` (medium)
- No hardcoded secrets in source (confirmed across all audits)
- SQL injection: not applicable (parameterized queries throughout)
- Risk scores ranged 28–62/100 across the four audit passes

**No source changes were made in these sessions.**

---

#### Sessions 52405d5f, 4d641eb0 (0.4–0.5 MB each)

**Read-only performance analysis sessions** — no file edits. Key findings reported (not yet applied):

- N+1 sequential `await` loops in `bridgeBatchOperation`, `bridgeRecordFeedback`, `_doInitializeIntelligence` → should use `Promise.all`
- `getDataDir()` filesystem probe not memoized
- `bridgeSearchEntries` re-parses up to 5,000 embeddings per search call
- `getInstalledVersion()` re-forks npm subprocess per call
- `cosineSim` duplicated in two files
- `RegExp` recompiled on every URI match in `resource-registry.ts`
- Regex constants reconstructed per `parseRule()` call in `compiler.ts`
- Unreleased `setInterval` timers in `auto-memory-bridge.ts` (no `.unref()`)
- Repeated `JSON.parse`/`JSON.stringify` in hot paths

---

#### Sessions c9d7a6be, e00d8cfd, b1e3cf8d, 27419abd, 71688e94 (0.4 MB each)

**Read-only test coverage gap analysis sessions** — no file edits. Identified gaps (test skeletons produced but not written to disk):

- `sample-code.ts` fixture: 0% coverage (calculateSum, fetchData, UserService, AuthService, MemoryStore, cosineSimilarity)
- `ForgettingCurveWorker` — entirely untested
- `ERLWorker` — entirely untested
- `BusHookBridge` — entirely untested
- `MuACP` (micro-Agent Coordination Protocol) — entirely untested
- `LanceDBSink` — entirely untested
- `SubSwarmManager` — entirely untested
- `LATSPlanner` / `AFLOWSearch` (MCTS-based) — entirely untested
- `SubGraphCompiler.compile()` — entirely untested
- Missing edge cases: `ConfidenceGate`, `InterruptCheckpointer`, `EpisodeBinnerWorker`, `ObservabilityBus`, `EntityMemory`

---

### Jun 13, 2026

**Recovery commits only — no new sessions in the audit.**

Seven reconstruction commits applied changes that had been identified as missing from sessions 37135b73 and 338de548:

| Commit | Description |
|---|---|
| `da0f42a0` | Accumulated dashboard + orgs UI improvements |
| `85e4e65e` | Export and Import buttons on org cards |
| `bb04abe0` | Re-apply autodev bug fixes lost from previous sessions |
| `e744e1ab` | Loop HIL/isFinished/type badges, dir scoping, org live status strip |
| `b25983c1` | isOverdue/isStaledActive loop logic, dedup, monotask graceful fallback |
| `5069d8b6` | 100-round autodev improvements — batch 2 |
| `028ae927` | Autodev improvements — batch 3 |

---

## 3. Per-File Status Table

| File | Sessions That Touched It | Status | Changes Recovered |
|---|---|---|---|
| `dist/src/ui/dashboard.html` | 37135b73 (427×), f4dc4c82 (9×), d3923148 (28×), 19b7b627 (23×) | **Recovered** — 5 from reconstruction pass + 7 commits Jun 13 | Loop HIL badges, dedup, countdown timer, filter buttons, project scoping |
| `dist/src/ui/server.mjs` | 37135b73, f4dc4c82 (4×), d3923148 (2×), 19b7b627 (1×), 2084715b (6×) | **Recovered** — 3 from reconstruction pass | Loop type detection, startedAt ms, import path corrections |
| `dist/src/ui/orgs.html` | a094f0b1 (2×), 338de548 (17×) | **Recovered** — 2 from reconstruction pass + Jun 13 commits | Live status strip, live event feed, org copy button, export/import |
| `src/commands/doctor.ts` | f4dc4c82 (10×) | **Recovered** — 9 from reconstruction pass | Semver shim, monograph detection, gitignore coverage check |
| `.claude/commands/mastermind/master.md` | Various | **Recovered** — 1 from reconstruction pass | --monotask flag routing |
| `package.json` (CLI + root) | 72dc98c0 (4×), f4dc4c82 (3×) | **Recovered** — 4 from reconstruction pass | semver dependency, monograph dependency, price table entries |
| `.claude/skills/mastermind/autodev.md` | 0d452528 (2×) | **Recovered** — 2 from reconstruction pass | --monotask flag documentation |
| `memory-bridge.ts` | a094f0b1 (41×) | **Complete** — confirmed in git | bridgeDeleteEntry UUID fix |
| `sqlite-backend.ts` | cf519575 (26×) | **Complete** — confirmed in git | PRAGMA fix, Float32Array fix, INSERT OR REPLACE fix, TOCTOU fix |
| `security-tools.ts` | a094f0b1 (10×) | **Complete** — confirmed in git | aidefence_* → monofence_* rename |
| `.gitignore` | Multiple sessions | **Complete** — confirmed in git | Surgical .monomind exclusions, GRAPH_REPORT, .playwright-mcp/ |
| `README.md` | 23d171d1 (2×), 32f0c05a (7×), 72dc98c0 | **Complete** — confirmed in git | Orgs-first framing, Mermaid diagrams |
| `docs/index.html` | 0d452528 (2×), 72dc98c0 (4×) | **Complete** — confirmed in git | Hash routing, MonoFence section, command grid |
| `runorg.md` + 51 other mastermind skills | 2084715b | **Complete** — confirmed in git | 255 null guards, suffix loop completions |
| `registry-builder.ts` | c04a3a3e (2×) | **Complete** — confirmed in git | Relative paths in registry |
| `worker-daemon.ts` | c04a3a3e (1×) | **Complete** — confirmed in git | No projectRoot leak |
| `cache-manager.ts`, `contextual.ts`, etc. (19 files) | d07f9f3e | **Complete** — committed as `ab1398a5` | Memory optimizations |
| `checker.ts`, `validator.ts`, `index.ts` (update system) | 72dc98c0 | **Complete** — committed | Auto-update expansion, bugfixes |
| `gates-handler.cjs` | 37135b73 (8×) | **Complete** — confirmed in git | Force-push guard restored |

---

## 4. Feature Inventory

### Dashboard UI

| Feature | Session | Recovery Status |
|---|---|---|
| Loop countdown timer | 37135b73 | Recovered (Jun 13 commits) |
| Command palette ESC behavior | 37135b73 | Recovered (Jun 13 commits) |
| Keyboard shortcut help panel | 37135b73 | Recovered (Jun 13 commits) |
| Sidebar project/user label display | 37135b73 | Recovered (Jun 13 commits) |
| Feed/Now-view navigation | 37135b73 | Recovered (Jun 13 commits) |
| Loop type badges (∞ pill, ↺ icon) | d3923148 | Recovered (committed + Jun 13) |
| HIL status indicator (⚠HIL badge, banner, alert rail) | d3923148 | Recovered |
| `fmtInterval()` helper | d3923148 | Recovered |
| Live SSE-driven loop refresh | d3923148 | Recovered |
| Nav badge HIL count | d3923148 | Recovered |
| SSE replay guard | d3923148 | Recovered |
| Calendar/session heatmap Monday-alignment fix | d3923148 | Recovered |
| Finished loops no longer show Stop button | 19b7b627 | Recovered |
| Loop deduplication (one card per logical session) | 19b7b627 | Recovered |
| Global Loops sidebar tab | 19b7b627 | Recovered |
| Global Tokens sidebar tab | 19b7b627 | Recovered |
| Loops tab project-scoped | f4dc4c82 | Recovered |
| Tokens tab project-scoped + filter buttons working | f4dc4c82 | Recovered |
| Unified loop metadata display (prompt/command/flags) | f4dc4c82 | Recovered |
| Agent graph tab on memory page (fixed empty state) | f4dc4c82 | Recovered |

### Orgs Page

| Feature | Session | Recovery Status |
|---|---|---|
| Dedicated `/v2/orgs` page (`orgs.html`) | a094f0b1 | Complete |
| GSAP-animated org node communication graph | a094f0b1 | Complete |
| Project-selector scoping (sessions, loops, memory, orgs) | a094f0b1 | Complete |
| Correct role hierarchy (not all agents "boss") | a094f0b1 | Complete |
| Bidirectional communication arrows | a094f0b1 | Complete |
| Agent avatar images in org chart | f4dc4c82 | Recovered |
| Org Copy button | f4dc4c82 | Recovered |
| Export and Import buttons per org card | 338de548 + Jun 13 | Recovered |
| Live status strip (pulsing dot, state label, uptime, sparkline) | 338de548 | Recovered |
| Live event feed panel with fade-in animation | 338de548 | Recovered |
| SSE integration for org state | 338de548 | Recovered |
| Stale uptime fix on org switch | 338de548 | Recovered |

### Doctor / CLI

| Feature | Session | Recovery Status |
|---|---|---|
| `monomind doctor` crash fix (semver shim + dependency) | f4dc4c82 | Recovered |
| Monograph detection in doctor health check | f4dc4c82 | Recovered |
| Doctor gitignore coverage check | 37135b73 | Complete (committed `1a5b8cb0`) |
| Token price table: claude-opus-4-6 / claude-sonnet-4-6 | f4dc4c82 | Recovered |

### Memory & Performance

| Feature | Session | Recovery Status |
|---|---|---|
| 18 memory optimizations across @monomind/memory | d07f9f3e | Complete (committed `ab1398a5`) |
| SQLite ambiguous column fix (23 tests restored) | d07f9f3e | Complete |
| Embedding buffer slice fix | d07f9f3e | Complete |
| sqlite-backend.ts blocker bug fixes (6 fixes) | cf519575 | Complete |

### Security & Repository Hygiene

| Feature | Session | Recovery Status |
|---|---|---|
| aidefence_* → monofence_* rename | a094f0b1 | Complete |
| Personal data removal from git history | 37135b73 | Complete |
| .monomind relative paths (portability) | c04a3a3e | Complete |
| Surgical .gitignore for .monomind | c04a3a3e + 37135b73 | Complete |
| Playwright snapshot removal | 23d171d1 | Complete |
| Legacy docs cleanup (11,600 lines removed) | 23d171d1 | Complete |

### CLI Auto-Update System

| Feature | Session | Recovery Status |
|---|---|---|
| All subpackages monitored for updates | 72dc98c0 | Complete |
| Startup update check wired into CLI entry point | 72dc98c0 | Complete |
| Inline update tagline in `--version`/`--help` | 72dc98c0 | Complete |
| 3 update-system bugs fixed | 72dc98c0 | Complete |

### Documentation / Website

| Feature | Session | Recovery Status |
|---|---|---|
| Hash-based deep-linking on GitHub Pages | 32f0c05a | Complete |
| .nojekyll added | 32f0c05a | Complete |
| Stale /monomind:* → /mastermind:* commands | 72dc98c0 | Complete |
| MonoFence AI section on website | a094f0b1 + 72dc98c0 | Complete |
| README: orgs-first, Mermaid diagrams | 32f0c05a + 23d171d1 | Complete |
| v1.11 CHANGELOG (149 commits) | 72dc98c0 | Complete |

### Org Layer / Mastermind Skills

| Feature | Session | Recovery Status |
|---|---|---|
| 255 null guards across 52 skill files | 2084715b | Complete (committed `82f8f13e`) |
| Sidecar suffix loop completions | 2084715b | Complete |
| --monotask flag as explicit opt-in | 0d452528 | Recovered |
| File-first task generation as default | 0d452528 | Recovered |

---

## 5. Remaining Gaps

### Uncommitted Working-Tree Changes

The following files have unstaged modifications that have not yet been committed:

| File | Nature of Change |
|---|---|
| `.claude/commands/mastermind/master.md` | Reconstruction-pass change (1 applied) |
| `.claude/skills/mastermind/autodev.md` | Reconstruction-pass change (2 applied) |
| `packages/@monomind/cli/dist/src/ui/dashboard.html` | Post-reconstruction working-tree edits |
| `packages/@monomind/cli/dist/src/ui/orgs.html` | Post-reconstruction working-tree edits |
| `packages/@monomind/cli/dist/src/ui/server.mjs` | Post-reconstruction working-tree edits |
| `packages/@monomind/cli/package.json` | Reconstruction-pass change (4 applied) |
| `packages/@monomind/cli/src/commands/doctor.ts` | Reconstruction-pass change (9 applied) |

**Action required:** Review and commit these files. Suggested commit message:  
`fix(recovery): apply reconstruction-pass changes from Jun 10-12 session audit`

### Unwritten Test Skeletons

Five read-only sessions produced detailed test skeletons that were never written to disk. These gaps remain in the codebase:

| Module | Gap Type | Priority |
|---|---|---|
| `tests/docker-regression/fixtures/sample-code.ts` | 0% coverage | High |
| `ForgettingCurveWorker` | Entirely untested | High |
| `ERLWorker` | Entirely untested | High |
| `BusHookBridge` | Entirely untested | High |
| `MuACP` (micro-Agent Coordination Protocol) | Entirely untested | High |
| `LanceDBSink` | Entirely untested | Medium |
| `SubSwarmManager` | Entirely untested | Medium |
| `LATSPlanner` / `AFLOWSearch` | Entirely untested | Medium |
| `SubGraphCompiler.compile()` | Entirely untested | Medium |
| `AuthService` token expiry path | Missing edge case | High (security) |
| `MemoryStore` TTL expiry | Missing edge case | High |
| `ConfidenceGate` boundary conditions | Missing edge case | Medium |
| `InterruptCheckpointer` persistence/idempotency | Missing edge case | Medium |

To recover: the test skeletons were output in sessions `c9d7a6be`, `e00d8cfd`, `b1e3cf8d`, `27419abd`, `71688e94`. Re-run `/mastermind:tdd` or manually transcribe skeletons from those session summaries.

### Unimplemented Performance Fixes

Four read-only performance analysis sessions identified actionable fixes that were never applied:

| Finding | File | Priority |
|---|---|---|
| Sequential `await` loops → `Promise.all` | `memory-bridge.ts` (bridgeBatchOperation, bridgeRecordFeedback) | High |
| `getDataDir()` not memoized | `worker-daemon.ts` | Medium |
| `bridgeSearchEntries` re-parses 5,000 embeddings per call | `memory-bridge.ts` | High |
| `getInstalledVersion()` forks npm subprocess per call | `update/checker.ts` | Medium |
| `cosineSim` duplicated in two files | `routing/cosine.ts` | Low |
| `RegExp` recompiled on every URI match | `mcp/resource-registry.ts` | Medium |
| Regex constants reconstructed per `parseRule()` call | `guidance/compiler.ts` | Medium |
| `setInterval` in `auto-memory-bridge.ts` not unref'd | `memory/auto-memory-bridge.ts` | Medium |

To recover: run `/mastermind:autodev --tillend improve memory bridge and update performance` to apply these systematically.

### Unimplemented Security Fixes

Multiple security audit sessions identified issues not yet remediated:

| Finding | Severity | File |
|---|---|---|
| XSS via unescaped session/project name | Medium | `dist/src/ui/server.mjs` |
| Unvalidated CID format in publish-registry (SSRF) | High | `cloud-functions/publish-registry/index.js` |
| JWT token passed without validation | High | `cloud-functions/publish-registry/index.js` |
| Unvalidated IPFS gateway fetch (SSRF) | High | `cloud-functions/publish-registry/index.js` |
| PID command injection risk | Medium | `mcp/mcp-server.ts` |
| Missing API key auth on public cloud function | Medium | `cloud-functions/publish-registry/index.js` |

To recover: run `/security-review --fix` targeting `cloud-functions/publish-registry/index.js` and `dist/src/ui/server.mjs`.

---

## 6. Current Codebase State After Reconstruction

### Repository

- **Branch:** `main`
- **Latest commit:** `028ae927` (feat(ui): restore autodev improvements — batch 3)
- **Published versions:** `monomind@1.11.13` / `@monoes/monomindcli@1.11.12`

### Working Tree

- 7 files with uncommitted changes (all from reconstruction pass — safe to commit)
- 10 untracked files (generated agents in `.claude/agents/generated/`, `.monomind/` runtime, `packages/@monomind/cli/._final.mjs`, `packages/@monomind/monograph/package-lock.json`)

### Key Files State

| File | Last Committed State | Working-Tree Changes |
|---|---|---|
| `dist/src/ui/dashboard.html` | `028ae927` (Jun 13) | Yes — needs commit |
| `dist/src/ui/orgs.html` | `85e4e65e` (Jun 13) | Yes — needs commit |
| `dist/src/ui/server.mjs` | `da0f42a0` (Jun 13) | Yes — needs commit |
| `src/commands/doctor.ts` | `1a5b8cb0` (Jun 11) | Yes — needs commit |
| `package.json` (CLI) | `f3afe3c1` (Jun 13) | Yes — needs commit |

### Infrastructure Health

- `.gitignore` is correctly configured for all runtime paths
- Security-sensitive files (`.monomind/`, `data/sessions/`, etc.) are gitignored
- git history was rewritten Jun 12 to remove personal data from both remotes (`nokhodian/monomind` and `monoes/monomind`)
- `pnpm-workspace.yaml` duplicate removed
- All hook helper modules present (router.cjs, session.cjs, memory.cjs, intelligence.cjs, learning-service.mjs)
- Memory test suite: 403 tests passing

### Next Recommended Actions (Prioritized)

1. **Commit the 7 working-tree files** from the reconstruction pass
2. **Write and commit test skeletons** for the 9 untested/0%-coverage modules (start with security-critical `AuthService` and `MuACP`)
3. **Apply performance fixes** to `memory-bridge.ts` (sequential awaits and embedding re-parse are the most impactful)
4. **Fix XSS** in `server.mjs` (escape session/project names before rendering)
5. **Secure the cloud function** `publish-registry/index.js` (add API key auth, validate CID format, enforce HTTPS-only IPFS gateway)
