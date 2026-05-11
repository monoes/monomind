# Changelog

All notable changes to Monomind are documented here.

---

## [1.9.7] — 2026-05-11

### Fixed

- **`initKnowledgeGraph` fd leak**: Parent process held the log file descriptor open after spawning the detached build child. Added `fs.closeSync(logFd)` after `child.unref()` so the parent releases its copy; the child retains its own inherited copy.
- **Redundant dynamic `import('fs')` in `initKnowledgeGraph`**: Function was doing two separate `await import('fs')` calls to destructure individual functions despite a top-level `import * as fs` being available. Unified to use the top-level `fs.*` namespace, consistent with the rest of the file.

---

## [1.9.6] — 2026-05-11

### Fixed

- **`init.ts` misleading comment**: Comment on `monograph watch` spawn claimed "includes initial build on start" — false, `watchAsync` uses `ignoreInitial: true` and never does an initial build. A future dev reading this could have removed `initKnowledgeGraph`'s build logic, recreating the v1.9.4 regression. Comment now correctly documents that the initial build is handled by `initKnowledgeGraph`.
- **Silent build failure in `initKnowledgeGraph`**: Detached spawn used `stdio: 'ignore'`, so any build error was silently lost. Now redirects stdout/stderr to `.monomind/graph/build.log`, consistent with `graphify-freshen.cjs`.

---

## [1.9.5] — 2026-05-10

### Fixed

- **`initKnowledgeGraph` regression**: v1.9.4 removed the initial `buildAsync` call and relied on `monograph watch` for the build, but `watchAsync` uses `ignoreInitial: true` so it never builds on startup — only on file changes. Running `monomind init` in a plain terminal (outside Claude Code) would leave the graph permanently unbuilt. Restored the initial build as a lock-aware detached spawn using `createRequire(import.meta.url)` to resolve `@monoes/monograph` from the CLI's own node_modules (correct for npm/npx installs), falling back to the user project's node_modules.

---

## [1.9.4] — 2026-05-10

### Fixed

- **`monomind init` SQLite BUSY error on knowledge graph build**: Three concurrent writes were racing to the same `monograph.db` — an in-process `buildAsync` call in `initKnowledgeGraph`, a spawned `monograph build --code-only` process, and the session-start hook's `graphify-freshen.cjs` build. Fixed by: (1) removing the in-process `buildAsync` call from `initKnowledgeGraph` — the directory is created, build is delegated to the spawned process; (2) removing the redundant `monograph build --code-only` spawn from `init.ts` — `monograph watch` already does an initial build; (3) adding a `build.lock` file guard to `graphify-freshen.cjs` so it skips if a build started within the last 5 minutes.

---

## [1.9.3] — 2026-05-10

### Fixed

- **`monomind init` knowledge graph hook**: `graphify-freshen.cjs` and `control-start.cjs` were missing from the generated `SessionStart` hooks in `.claude/settings.json`. The knowledge graph was built once during init but never refreshed on subsequent Claude Code sessions. The `settings-generator.ts` now adds both hooks to `SessionStart` — `graphify-freshen.cjs` when `graphify: true` (the default), `control-start.cjs` always.

---

## [1.9.2] — 2026-05-10

### Fixed

#### mastermind:master command — comprehensive hardening (12 fixes across 5 review rounds)

- **Atomic writes**: Step 3 `current.json` initial write and Step 11 session file write now use `tmp+mv` pattern; prevents zero-byte corruption on interrupted writes
- **Bash version guards**: Steps 9 and 11 aligned to `(( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] < 400 ))` arithmetic form; Step 11 guard fixed from weak `[ -z "$BASH_VERSION" ]` check
- **Step 12a context**: bash block now emits `project_name` and full `board_ids` map to stdout; iteration cycles can now look up board UUIDs for any domain
- **Step 12c board constraint**: iteration cycles now only invoke domains already present in `board_ids`; prevents spawning domain managers with no board to write to
- **Session-scoped goals file**: `GOALS_FILE` changed from `domain_goals.json` to `${SESSION_ID}_goals.json` to prevent cross-session collision
- **Goal hydration safety**: `@tsv` deserialization replaced with NUL-delimited pairs (`jq -j` + `read -r -d ''`) to prevent backslash/tab corruption; null goal values default to `""` via `// ""`
- **Zero-domain detection**: Steps 9 and 11 now track `found_domain_files`; reports `status: blocked` instead of false-success when no domain output files exist
- **`monotask space boards add` visibility**: changed from silent `|| true` to emit WARN on failure
- **Phase C substitution guidance**: clarified that `<status>`, `<path1>`, `<action1>` are runtime placeholders filled by spawned agents, not pre-substitution targets
- **Step 12a invisible variables**: replaced bash variable assignment with `jq` stdout emit so LLM sees artifacts/next_actions across tool call boundaries
- **`domain_managers_json` guard**: empty-string guard added before `jq --argjson` to prevent invalid JSON argument
- **`project_name` guard**: abort with error in Step 6 if `project_name` is empty after reload

#### mastermind domain skills — board column lookup

- Added column-ID lookup bash blocks to `build`, `content`, `createorg`, `finance`, `marketing`, `ops`, `release`, `research`, `review`, and `sales` skills

---

## [1.9.1] — 2026-05-10

### Changed
- Version bump to 1.9.1

---

## [1.9.0] — 2026-05-10

### Changed
- Version bump to 1.9.0 across `@monomind/cli`, `monomind`, and root package

---

## [1.8.0] — 2026-05-10

### Major Features

#### Monograph — Knowledge Graph Engine
A complete static-analysis knowledge graph built into the CLI. Monomind now understands your codebase structurally before any agent starts work.

- **Multi-language parsers**: TypeScript/JavaScript, Python, Go, Rust, Java — extracts classes, functions, imports, and exports
- **Pipeline DAG runner** with Kahn topological sort and cycle detection — scan → parse → cross-file resolution → communities → god-nodes → surprises → suggest
- **Graph intelligence**: shortest path, degree analysis, community detection, god-node identification, surprise edge discovery
- **File watcher**: 3-second debounce with macOS polling — graph stays fresh as you code
- **16 MCP tools** (`monograph_suggest`, `monograph_query`, `monograph_impact`, `monograph_context`, `monograph_bridge`, `monograph_rename`, `monograph_cypher`, `monograph_snapshot`, `monograph_diff`, `monograph_neighbors`, `monograph_community`, `monograph_cohesion`, `monograph_surprises`, `monograph_god_nodes`, `monograph_report`, `monograph_export`)
- **7 export formats**: JSON, HTML, Obsidian, Canvas, Cypher, GraphML, SVG
- **Fallow integration** (17 feature rounds): config rules, human reporter, explain catalog, duplicate detection, health report, coverage, regression, programmatic API, LSP actions, feature flags, cloud coverage, issue filters, init detection, distribution thresholds

#### Mastermind — Autonomous Business Brain
A complete business automation orchestrator. Describe a goal; Mastermind routes it across domains, spawns agent swarms, and synthesizes results.

- **Master command** (`/mastermind`) — 11-step orchestration: brain load → intake → decompose → plan → monotask setup → spawn domain managers → synthesize → brain write
- **11 domain skills**: build, marketing, research, review, release, sales, ops, finance, content, architect, idea — each with full agent swarms and board integration
- **Real-time dashboard** event pipeline — every session, domain dispatch, agent spawn, and intercom emitted to live panel via SSE
- **Session traceability** — prompt, domains, status, and all events persisted in `data/sessions/`
- **Cinematic agent animation** — SVG round-table animation on Mastermind panel open
- **Brain load/write** procedures via AgentDB hierarchical recall and context synthesis
- **Autonomous iteration** (`--iterate N`) — N self-directed improvement cycles after initial run
- **monotask CLI integration** — all domain skills now use `monotask card create/move/comment` with proper column-ID lookup; internal task engine removed

#### createorg / runorg — Autonomous Organizations
Define multi-agent organizations as JSON; run them persistently until stopped.

- **`/mastermind:createorg`** — wizard to define roles, communication topology, and checkpoint intervals
- **`/mastermind:runorg`** — spawn boss agent that runs a persistent operating loop, dispatches tasks to team agents via memory namespace, emits org events to dashboard

#### Monodesign — Frontend Design Intelligence
All design capability consolidated into a single expert agent.

- Component specs with interactive states, copy formulas, spacing math
- UX rules, token architecture, and brand workflow
- Design antipattern detection, inclusive representation
- Replaces all previous separate design agents (UI Designer, UX Architect, etc.)

#### /monomind:review — Iterative Multi-Agent Code Review
- Spawns parallel reviewer agents across correctness, security, tests, and patterns
- Iterates up to 5 rounds of review + fix cycles per session
- Persists findings and annotations on monotask cards

#### /monomind:improve — Component Improvement Pipeline
- Deep code-explorer + web-researcher swarm per component
- Product Manager evaluation → Software Architect decomposition
- Full monotask card creation with DOD, testing criteria, and TDD checklists

### Security Hardening (Passes 9–20)

12 consecutive security passes hardening the full CLI surface:

- **Proto-chain pollution guards** — all dynamic property access uses `Object.create(null)` or explicit `hasOwn` checks
- **Path traversal prevention** — `path.resolve` + containment assertions on all file operations
- **CSPRNG IDs** — `crypto.randomBytes` everywhere; no `Math.random()` for security-sensitive values
- **Atomic writes** — temp-file + rename pattern on all state persistence; no partial-write corruption
- **Size gates** — file and payload size caps on all upload/download/store operations
- **Shell injection guards** — all shell exec uses array form or explicit escaping; no template-literal interpolation into shell strings
- **Session ID entropy** — session IDs generated with `crypto.randomBytes(16).toString('hex')`
- **Rate limiting** — per-agent and per-endpoint request caps with backoff
- **Timing attack resistance** — constant-time comparison for HMAC verification
- **Memory unboundedness fixes** — LRU caps on all caches; no unbounded array accumulation
- **ReDoS guards** — regex complexity analysis on all user-supplied patterns
- **Tamper-evidence** — HMAC signatures on persisted session and memory state

### Dashboard Improvements
- **Mastermind full-screen overlay** embedded in the control panel
- **Live domain glow** — domains animate when their swarm agents are active
- **Statusline** shows git author and current working directory
- **Mastermind panel** traces every session with prompt, domains, events, and completion status

### New Skills
- **Monomotion** (`/monomotion`) — motion graphics and animation skill (GSAP, CSS, Three.js)
- **Stop-slop** — writing quality gate integrated into content and marketing domain skills
- **Marketing specialists** — 5 new agents (Xiaohongshu, Douyin, Weibo, Kuaishou, Bilibili)

### Routing
- In-process keyword routing replaces external Anthropic API call — faster, no network dependency, no cost
- Extras registry restructured with correct `{extras:[]}` envelope

### monomind:createtask Improvements
- Professional task cards with Definition of Done, testing criteria, and TDD step checklists
- Checklist item IDs stored in card comments for autonomous completion tracking
- Memory-first board lookup across all monomind commands

### Init
- Expanded skills, commands, and agents maps in generated `CLAUDE.md`
- Coding principles section added to generated project instructions
- Shared instructions generator refactored for monorepo layout

### Changed
- `@monomind/monograph` scope moved to `@monoes/monograph` for npm publishing
- All `graphify_*` tools renamed to `monograph_*` in MCP and Claude commands
- `lora-adapter.ts` and `vector-db.ts` removed from ruvector (replaced by HNSW + SONA)
- `in-memory-repositories.ts` removed from infrastructure layer

### Fixed
- monotask `card tag add` → `card label add` in idea.md and improve.md
- `$COL_TODO_ID` / `$COL_DONE_ID` undefined in 8 of 11 domain skills — column lookup bash blocks added
- Board lookup ordering corrected to memory-first across all monomind commands
- `$PRIORITY` unset before case block in createtask.md
- `<ITEM_ID>` placeholder in do.md replaced with stored-IDs retrieval loop
- `monotask task list/create` (nonexistent subcommand) in runorg.md replaced with memory-based tracking
- Mastermind session prompt showing "(none)" — `prompt` field now populated on `session:start` event
- Mastermind domains showing "(none yet)" — domain array populated before dispatch
- `monograph` path predicates no longer match `remotion.config`

---

## [1.4.0] — 2026-04-14

### Added

#### Memory Palace Integration
- **`memory-palace.cjs`** — new CJS helper implementing a MemPalace-inspired cross-session memory system with zero native dependencies
  - **Wing → Room → Hall** spatial namespace hierarchy
  - **Verbatim storage** — 800-char chunks with 100-char overlap; no summarization, no information loss
  - **Okapi BM25 retrieval** (k₁=1.5, b=0.75) across all stored drawers
  - **Closet-topic boost** — regex-extracted topic terms (headers, action phrases, proper nouns, quoted passages) boost BM25 scores by +0.5 per matching term during search
  - **Score-based L1 promotion** — each retrieval via `search()` or `recall()` increments a drawer's score; top-scored drawers surface at session start
  - **Temporal knowledge graph** — facts stored as `(subject, predicate, object, valid_from, valid_to)` triples in `kg.json`; supports point-in-time and timeline queries
  - **4-layer memory stack**: L0 identity, L1 essential story, L2 on-demand namespace recall, L3 deep BM25 search
- **`identity.md`** seed file at `.monomind/palace/identity.md` — project context injected at every session start as L0 identity
- **`features/mempalace.md`** — full technical reference for the integrated memory palace feature

#### Hook Wiring
- **`session-restore` hook** now calls `palace.wakeUp(CWD)` — injects `[MEMORY_PALACE_L0]` identity and `[MEMORY_PALACE_L1]` essential story into every new session context
- **`post-task` hook** now calls `palace.storeVerbatim()` — files each task prompt as a verbatim drawer under `wing: tasks`, `room: <agentSlug>`
- **`session-end` hook** now calls `palace.storeVerbatim()` (archive marker) and `palace.kgAdd()` (temporal triple: `sessionId → ended_at → timestamp`)

#### Docs & References
- **README.md Acknowledgements** — added MemPalace reference with Wing/Room/Hall architecture, BM25 retrieval, score-based promotion, and temporal KG description

### Changed
- `hook-handler.cjs` — three new try/catch blocks wiring Memory Palace at session-restore, post-task, and session-end; all non-fatal (palace failure never blocks hooks)

---

## [1.3.1] — prior release

- Previous release. See git history for details.
