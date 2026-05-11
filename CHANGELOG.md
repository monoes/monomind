# Changelog

All notable changes to Monomind are documented here.

---

## [1.9.17] — 2026-05-11

### Fixed

- **mastermind — idea board created with wrong columns**: Step 6 used generic `Todo/Doing/Done` for every domain, so `factory-idea` was created with the wrong schema. The idea board now gets `New → Evaluated → Elaborated → Tasked → Iced → Rejected` and all other domains get `Todo → In Progress → Human in Loop → Review → Done → Cancelled`. Column schemas are documented in `_protocol.md`.
- **mastermind — ideation pipeline bypassed**: When `mastermind:idea` was invoked from master, the full 6-step pipeline (Idea Manager → PM evaluation → elaboration → task decomposition) was being skipped in favour of manual card creation. Added an explicit IDEA PIPELINE REQUIREMENT block in master.md Step 7 forbidding shortcuts and listing each required pipeline step.
- **mastermind:idea — non-canonical board name broke find-or-create**: `idea.md` Step 3 used `"Ideas & Innovation"` + a memory-store key as the lookup mechanism, which diverged from master's canonical naming. Replaced with `${project_name}-idea` using the same `monotask board list` awk find-or-create pattern as master Step 6.
- **mastermind:idea — task boards missing Cancelled column and non-canonical names**: `Implementation Tasks` and `Operations Tasks` boards had no `Cancelled` column. Renamed to canonical `${project_name}-tasks-dev` and `${project_name}-tasks-ops`. Both now have: `Backlog → Todo → In Progress → Human in Loop → Review → Done → Cancelled`.
- **mastermind:idea — tasks not linked as subtasks**: Task decomposition in Step 6c uses `monotask card subtask add` to link each generated task card to its parent idea card as a proper subtask (cross-board link), not a standalone card.

---

## [1.9.16] — 2026-05-11

### Fixed

- **mastermind — boards multiplied on every run**: Step 6 created a new board on every mastermind run using a generic domain name (e.g. `idea`, `build`). Now boards are named `<project_name>-<domain>` (e.g. `factory-idea`, `factory-build`) and are found-or-created: if a board with that canonical name already exists, it is reused and its column IDs are fetched from the existing board. Boards no longer accumulate across runs.
- **mastermind — Step 6 required bash 4.3+ (unavailable on macOS)**: The bash block used `declare -A` associative arrays, which require bash 4.3+. macOS ships bash 3.2, causing Step 6 to abort immediately. Replaced all associative arrays with jq accumulation via a `state_patch` JSON variable, fully compatible with bash 3.2.
- **mastermind — `monotask board create` missing `--space` flag**: Board creation did not pass `--space <space_id>`, which is required by the monotask CLI. Boards are now created with `monotask board create --space "$space_id" "$canonical" --json`.
- **mastermind `_protocol.md` Monotask Space+Board Setup Procedure**: Updated canonical bash blocks in `_protocol.md` to match the new find-or-create, canonical naming, and bash 3.2 compatible patterns.

---

## [1.9.15] — 2026-05-11

### Fixed

- **mastermind:master — `idea` domain degraded silently when delegated to Task agent**: Spawned Task agents do not have Skill tool access, so `Skill("mastermind:idea")` invocations inside domain manager agents silently fell back to raw PM analysis with no pipeline execution. Fixed by adding a hard rule in `master.md` Step 4/7: the `idea` domain must always be invoked directly by the master (which has Skill tool) — never delegated to a Task agent.
- **mastermind:master — domain managers without Bash produced degraded output**: Agent types like `Product Manager` and `Backend Architect` do not include Bash in their tool set. Without Bash, domain managers cannot run `monotask` CLI commands, emit `curl` dashboard events, or write session files. Added explicit guidance in `master.md` Step 7: only use subagent_types with Bash; override to `general-purpose` (all tools) if the registry match lacks Bash.
- **mastermind _protocol.md — Brain Load/Write silently skipped when AgentDB bridge offline**: `agentdb_hierarchical-recall` and `agentdb_hierarchical-store` return "AgentDB bridge not available" in environments where the bridge isn't running. Both procedures now fall back to `memory_search` (brain load) and `memory_store` (brain write) when AgentDB is unavailable, ensuring run context is always loaded and decisions are always persisted.
- **mastermind _protocol.md — dashboard events used WebFetch which is blocked for localhost**: WebFetch is restricted for `localhost` URLs in Claude Code agent runtimes, causing ECONNREFUSED on all dashboard event emissions. Replaced the `WebFetch` emit pattern with `curl` in `_protocol.md`. Added explicit note that agents without Bash should skip dashboard events (they are observability-only; the master emits the critical session-level events).

---

## [1.9.14] — 2026-05-11

### Fixed

- **Knowledge graph auto-installs `@monoes/monograph` if missing**: `initKnowledgeGraph` now attempts `npm install @monoes/monograph` in the target directory when the package cannot be resolved via the normal lookup, then retries resolution. The graph will build even in environments where the package was not installed. Only if auto-install also fails does init fall back to `result.skipped`.
- **`/monomind:understand` suggestion now prominent**: The post-init output box for running `/monomind:understand` is now rendered as a bold bordered callout instead of dim text, making it impossible to miss after `monomind init`.

---

## [1.9.13] — 2026-05-11

### Fixed

- **Knowledge graph never built after `monomind init`**: The published `@monoes/monomindcli` package had `"@monoes/monograph": "workspace:*"` and `"@monomind/routing": "workspace:*"` in dependencies. `workspace:*` is a pnpm monorepo protocol that npm does not resolve — npm installed neither package, so `cliRequire.resolve('@monoes/monograph/…')` always threw, `initKnowledgeGraph` always hit the `result.skipped` branch, and the knowledge graph was never built. `monomind:understand` and any other skill relying on `monograph.db` then failed with "monograph.db not found".
  - `@monoes/monograph` is now declared as `"^1.1.0"` (the published version), so npm installs it as a real dependency.
  - `@monomind/routing` is removed from dependencies entirely — every usage in the CLI is inside a `try/catch` with an explicit "optional — may not be installed" comment, so removing it is safe.

---

## [1.9.12] — 2026-05-11

### Fixed

- **mastermind:idea — variable substitution not protected in Steps 5 and 6c**: Added CRITICAL warnings and SAFETY CHECK instructions before the PM agent (Step 5) and decomposition agents (Step 6c) Task calls, matching the protection added to the Idea Manager (Step 4) in v1.9.11. PM agent and decomposition agents now verify BOARD_ID UUID format and refuse to call `board create`.
- **mastermind:idea — `skipElaboration: true` ideas got no context**: Added a rationale comment written to the card when elaboration is skipped, pulled from the PM's value statement (now included as `rationale` field in `VERDICTS_OUTPUT`).
- **mastermind:idea — `mode: auto` still showed confirmation gate**: Step 6b now explicitly checks `mode` — if `auto`, it bypasses the review table entirely and proceeds directly to Step 6c.
- **mastermind:idea — VERDICTS_OUTPUT schema extended**: Added `rationale` field (value statement / blocking question / rejection reason) so the outer skill can propagate PM reasoning to card comments without re-parsing prose.

---

## [1.9.11] — 2026-05-11

### Fixed

- **Mastermind idea: sync root .claude source-of-truth** — v1.9.10 published the idea.md fixes from the package-level copy but the root `.claude/skills/mastermind/idea.md` (source of truth synced at session start) had not been updated. This patch applies all the same fixes to the root file and syncs them into the package before publishing.

---

## [1.9.10] — 2026-05-11

### Fixed

- **Mastermind idea: Idea Manager board name corruption**: When `mastermind:idea` spawned the Idea Manager Task agent, shell variables (`${BOARD_ID}`, `${COL_NEW}`, etc.) were passed as literal template strings rather than substituted values. The agent's `monotask card create "${BOARD_ID}"` calls failed, causing it to improvise with `monotask board create "<idea title>"` — creating boards named after idea titles (e.g. `[#6 · P0 · S] Live ROI Calculator in Blueprint…`).
  - Added UUID format validation guard after Step 3 board setup: aborts with a clear error if `$BOARD_ID` is not a valid UUID before the Task call is constructed.
  - Added mandatory `=== IDEA BOARD LITERAL VALUES ===` echo block so all variable values are visible for copy-paste into the Task prompt.
  - Added explicit **CRITICAL** warning before Step 4 Task call explaining that shell variables do not survive into Task agent context and must be embedded as literal strings.
  - Added safety check at the top of the Idea Manager Task prompt: agent must verify BOARD_ID is a valid UUID and stop — not create boards or spaces — if it is not.
  - Corrected remaining board name references: `"ideation"` → `"Ideas & Innovation"`, `"monomind-task"` → `"Implementation Tasks"`, `"monomind-ops-task"` → `"Operations Tasks"`. Memory keys updated to match: `"implementation-tasks board_id"` and `"operations-tasks board_id"`.

---

## [1.9.9] — 2026-05-11

### Fixed

- **Mastermind: boards named with bare identifiers**: Boards created by `/mastermind`, all 11 domain skills (`build`, `marketing`, `sales`, `research`, `content`, `ops`, `release`, `review`, `finance`, `architect`, `idea`), and `/monomind:createtask` were named with terse lowercase slugs (`build`, `marketing`, `ops`, etc.) or internal IDs. All board create calls now use human-readable titles:
  - `build` → `Development Tasks`
  - `marketing` → `Marketing Campaigns`
  - `sales` → `Sales Pipeline`
  - `research` → `Research & Insights`
  - `content` → `Content Production`
  - `ops` → `Operations`
  - `release` → `Release Management`
  - `review` → `Code Review`
  - `finance` → `Finance & Budget`
  - `architect` → `System Architecture`
  - `idea` → `Ideas & Innovation`
  - `ideation` (idea skill secondary) → `Ideas & Innovation`
  - `monomind-task` (idea + createtask) → `Implementation Tasks`
  - `monomind-ops-task` (idea) → `Operations Tasks`
- **`master.md` domain label lookup table**: Step 6 now declares a `domain_labels` associative array mapping every domain identifier to its human-readable board title; boards are created with `${domain_labels[$domain]:-"$domain"}` so any unknown future domain still gets a reasonable name.
- **`_protocol.md` canonical template**: Updated to use `<board_title>` placeholder and added the full domain→title reference table so all skill authors use consistent names.

---

## [1.9.8] — 2026-05-11

### Fixed

- **Windows `file://` URL construction in inline ESM scripts**: Both `initKnowledgeGraph` (executor.ts) and `graphify-freshen.cjs` built the dynamic `import()` specifier via string concatenation (`'file://' + entryPoint`), which produces an invalid URL on Windows (`file://C:\path\to\index.js` instead of `file:///C:/path/to/index.js`). Fixed by using `pathToFileURL(entryPoint).href` from Node.js's built-in `url` module, which correctly constructs the URL on all platforms.

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
