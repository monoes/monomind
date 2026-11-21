# Monomind Statusline Reference

The Monomind statusline is a live dashboard embedded in Claude Code's status bar. It surfaces live state about your project — git state, active agent, knowledge base, org runs, code-graph freshness and token spend — without you having to run any commands.

This page describes the bundled `.claude/helpers/statusline.cjs`. `monomind init` writes a different, generated `statusline.cjs` (it shows the model name, always shows `💡` and has a WORKERS row), but the SessionStart helper self-heal replaces it with the bundled copy whenever the two differ, so after the first session the bundled one is what runs.

It has two modes you can toggle with `/ts`:

- **Compact** — a single line that fits in Claude Code's status bar
- **Full** — a multi-line status area (the default when `.monomind/statusline-mode.txt` is missing)

---

## Compact Mode

```
▊ Monomind ○  │  ⎇ main +1 ~9921 ↑5  │  → Level Designer  │  💡 45%  │  📚 190k  │  🎯 3t  │  ⚡ 14h
```

| Element              | Meaning                                                          | Source                                                                        |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `▊ Monomind`        | Brand mark + agent-activity status dot                               | Always present                                                                |
| `●` green / `○` grey | Agent activity **LIVE** or **IDLE**                                  | Registration files in `.monomind/agents/registrations/` younger than 30 min, else `.monomind/metrics/monoswarm-activity.json` younger than 5 min. `init` does not wire the `agent-start` hook that writes registrations, and `post-task` writes the activity file only when that directory exists, so in an init'd project this stays `○` |
| `⎇ main`             | Current git branch                                               | `git branch --show-current`                                                   |
| `+1`                 | Staged files                                                     | `git status --porcelain` index column                                         |
| `~9921`              | Modified but unstaged files                                      | `git status --porcelain` worktree column                                      |
| `↑5`                 | Commits ahead of remote (need push)                              | `git rev-list --left-right --count HEAD...@{upstream}`                        |
| `↓N`                 | Commits behind remote (need pull)                                | Same command, right count                                                     |
| `→ Level Designer`   | Currently routed agent (`→`; the `●` branch for a manually activated agent is unused, since nothing writes `activated`) | `.monomind/last-route.json` (written by the route hook)                          |
| `💡 45%`             | Heuristic "intelligence" score, shown only above 15%             | `.monomind/metrics/learning.json` → `intelligence.score` when set (the file `init` writes has none); else memory-database size (KB ÷ 2 ÷ 20) or the entry count of the legacy `auto-memory-store.json`/`ranked-context.json`; else a project-maturity score (points when `.claude/`, a source dir, a test dir and a `package.json`-style file exist) |
| `📚 190k`            | Lines in the keyword knowledge index; the `k` is a literal suffix, so `190k` means 190 lines | Line count of `.monomind/knowledge/chunks.jsonl`                             |
| `🎯 3t`              | Active microagent trigger rules (Task 32)                        | Key count in `.monomind/trigger-index.json`                                  |
| `⚡ 14h`             | Hooks active                                                     | Hook entries in `.claude/settings.json`                                       |

Items only appear when they have data — `📚`, `🎯`, `⚡` and `🐝` (active subagents, `🐝 active/max`) are hidden when their count is 0, and `💡` at 15% or less. Compact mode also shows `🏛 <org>` for running org runs (or `🏛 <org> done`) and the token spend (`$N today`, else `$N mo`) when there is data.

**Not shown: the Claude model name** (e.g. "Sonnet 5") in the bundled script. This line never calls `getModelName()`; see the Full Mode header note below for the full lookup chain and where it's actually exposed.

---

## Full Mode

Toggled with `/ts`; the default mode. Prints a multi-line status area. Three sections always appear — Header, 🤖 AGENT, 🧠 CONTEXT — each separated by a divider line. Three more appear only when there's state to show them; see [Conditional additions](#conditional-additions) below.

```
▊Monomind v2.24.5  ● LIVE  monoes/monomind  │  ◎monomind  │  ⬡nokhodian  │  ⎇main +1 ~12 ?3 ↑5  ⏱42m
──────────────────────────────────────────────────────
🤖 AGENT  👤 Coder  81%  │  🔄 no active loops
──────────────────────────────────────────────────────
🧠 CONTEXT  🔗12kn 34ke ●fresh  │  📊62%·38%grep 💡5 hints  │  ✨2HIL  │  $3.10·$88.40mo
```

That's what a populated session shows. A fresh one — no git remote, no routed agent yet, no graph/cost data — omits most individual elements too; each is independently conditional (see the tables below).

---

### Header

```
▊Monomind v2.24.5  ● LIVE  monoes/monomind  │  ◎monomind  │  ⬡nokhodian  │  ⎇main +1 ~12 ?3 ↑5  ⏱42m
```

Source: the header block of `generateDashboard()` in `.claude/helpers/statusline.cjs`.

| Element              | Meaning                                        | Source                                                                                                                                                                          |
| --------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `▊Monomind v2.24.5`   | Brand mark and package version                 | `getVersion()`: walk up from the script for a `monomind`/`@monomind/cli`/`@monoes/monomindcli` `package.json`; else the npm global prefix's `node_modules` (and, on macOS/Linux, `lib/node_modules`), checking `monomind`, `@monoes/monomindcli` and `monomind/node_modules/@monoes/monomindcli`; else `monomind --version` on PATH. Shows no version (bare `▊Monomind`) instead of a guessed one when none resolve (#368) |
| `● LIVE` / `○ IDLE`  | Whether subagents look active                  | `getMonoswarmStatus()` — first of 2 tiers that finds live state wins: agent-registration files in `.monomind/agents/registrations/` (<30 min old), else `monoswarm-activity.json` (<5 min old) |
| `monoes/monomind`    | Project identifier                             | `getProjectName()` — `owner/repo` parsed from `git remote get-url origin`; falls back to the working-directory folder name when there's no remote                              |
| `◎monomind`          | Working directory name                         | `path.basename(CWD)`                                                                                                                                                             |
| `⬡nokhodian`         | Your git identity                              | `git config user.name` (`getGitInfo()`)                                                                                                                                          |
| `⎇main`              | Active branch                                  | `git branch --show-current`                                                                                                                                                      |
| `+1` / `~12` / `?3`  | Staged / modified / untracked files            | Parsed from `git status --porcelain`; each segment only appears when its count is > 0                                                                                           |
| `↑5` / `↓N`          | Commits ahead / behind upstream                | `git rev-list --left-right --count HEAD...@{upstream}`; each only appears when > 0                                                                                              |
| `⏱42m`               | Session duration, shown only when available    | `.monomind/session.json` or `.claude/session.json` → `startTime`. Nothing in monomind writes either file, so this never renders                                                 |

**Not shown: the Claude model name** (e.g. "Sonnet 5"). `getModelName()` in `.claude/helpers/statusline.cjs` implements a real lookup chain — live session JSONL (`~/.claude/projects/<escaped-cwd>/*.jsonl`) → `~/.claude.json` → `settings.json` → env vars (`ANTHROPIC_MODEL`/`CLAUDE_MODEL`) → `"Sonnet 5"` default — but its only call site anywhere in the file is `generateJSON()`, the `--json` output mode. Neither this header nor Compact Mode ever calls it, so the model name isn't part of either mode's visible output; read it via `node .claude/helpers/statusline.cjs --json` → `user.modelName`.

---

### 🤖 AGENT

```
🤖 AGENT  👤 Coder  81%  │  🔄 no active loops
```

Source: the `🤖 AGENT` row of `generateDashboard()` in `.claude/helpers/statusline.cjs`.

| Element                                     | Meaning                                                     | Source                                                                                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `● ACTIVE` (green, shown only when present)  | Would mark a manually loaded agent; no command or hook writes `activated`, so it never shows | `.monomind/last-route.json` → `activated` (`getActiveAgent()`)                                                                                                                                            |
| `👤 Coder`                                   | Currently selected agent name                                | Same file → `name` (falls back to the slug, Title Cased — see below). Reads `👤 no agent routed` (slate) when the file is missing, has no `agent` field, or its `updatedAt` is older than 30 minutes    |
| `81%`                                        | Routing confidence score                                     | Same file → `confidence`                                                                                                                                                                                 |
| `🔄 no active loops` / `🔄 ⟳ cmd 2/5`        | Active `/loop` runs                                           | `.monomind/loops/*.json` (`getLoopStatus()`), skipping files with no activity in the last 6 hours. Up to 2 shown, `+N more` beyond that. `⏳ HIL` in place of `⟳` marks a loop waiting on a human answer; a `tillend`-type loop shows `run N` instead of `N/max` |
| `⚡123ms` (only when present)                 | Per-prompt hook latency                                       | `.monomind/metrics/hook-latency.json` (`getHookLatency()`); only shown when > 0ms, coral when > 500ms                                                                                                    |

**Agent display logic:** the name comes from the `name` field the route hook writes to `last-route.json` (the agent's registry name); without one the slug is Title Cased (`goal-planner` → `Goal Planner`). A slash-command prompt records `agent: null`, so the row reads `👤 no agent routed`.

---

### 🧠 CONTEXT

```
🧠 CONTEXT  🔗12kn 34ke ●fresh  │  📊62%·38%grep 💡5 hints  │  ✨2HIL  │  $3.10·$88.40mo
```

Source: the `🧠 CONTEXT` row of `generateDashboard()` in `.claude/helpers/statusline.cjs`. Everything past the `🔗` graph indicator is independently conditional — each `│`-separated segment only appears when its underlying data exists.

| Element                           | Meaning                                                                | Source                                                                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `🔗12kn 34ke` / `🔗no graph`       | Monograph knowledge-graph node/edge count                                  | `getMonographStats()` — tries `.monomind/graph/stats.json`, then a live `sqlite3` query against `.monomind/monograph.db`, then the legacy `.monomind/graph/graph.json` dump, in that order |
| `●fresh` / `●Nstale` / `●Nbehind`  | Graph freshness vs. commits made since the last build                      | `getGraphFreshness()` — compares the graph's build time to `git rev-list --count --since=<build time> HEAD`; fresh = 0 commits behind, stale = more than 5                                |
| `📊62%·38%grep`                   | Share of code lookups Monograph answered vs. grep/glob/bash fallback       | `.monomind/metrics/graph-usage.json` (`getGraphUsage()`)                                                                                                                                   |
| `💡5 hints`                       | Grep/Glob searches the graph gate assisted                                 | Same file → `graph_assist_search`. The file's `dollars_saved` is written but not shown                                                                                                     |
| `✨2HIL`                           | Pending human-in-the-loop questions from `/loop` runs, shown only when > 0 | `.monomind/loops/*-hil.md` files with no reply line yet (`getHILPending()`)                                                                                                                |
| `$3.10·$88.40mo`                  | Today's / this month's token spend                                         | `.monomind/metrics/token-summary.json` (`getTokenCostSummary()`) — **aggregated across all Claude Code projects on this machine, not just this repo.** Today's figure only shows when the cached data is from today (UTC); the month figure has no such gate |

---

### Conditional additions

Three more pieces of output appear only when there's state to show — and they attach to the dashboard differently from each other:

**📄 docs — an indented continuation of CONTEXT, not its own row.** Appears directly under the CONTEXT line with no divider before or after it, only when `docStats.exists && parts.length` is true (`getDocStats()`):

```
🧠 CONTEXT  🔗12kn 34ke ●fresh
   📄 42docs 190chunks 12mem 3okf
```

Counts, each only included when > 0: indexed-doc lines in `.monomind/knowledge/doc-metadata.jsonl`, chunk lines in `.monomind/knowledge/chunks.jsonl`, `memory_entries` rows in `.monomind/memory/memory.db`, and exported files in `.monomind/exports/`.

**🏛 ORGS — a real peer row, with its own divider.** Appears only when `orgStatus.count > 0` (`getActiveOrgs()`):

```
──────────────────────────────────────────────────────
🏛 ORGS  ●docs-team now  │  ◌release-team 4m
```

Looks in `<git common dir>/monomind/orgs` when that exists, else `.monomind/orgs`. For each org, `runtime.json` is authoritative: `●` (green) while its status is `running` and its recorded PID is alive. Without it, the newest `runs/*.jsonl` (or `bus.jsonl`) updated in the last 10 minutes counts, and is running unless its last event is `run:complete`/`org:complete`. `◌` (slate) = finished but recent. Up to 5 orgs shown, each with time since its last event.

**🖥 DASH — a peer row, with its own divider.** Appears only when `.monomind/control.json` names a port (`getDashboardHealth()`, written by `control-start.cjs` when it starts the local dashboard); shows whether the UI and API answer on that port.

---

*Unverified aside: the 12 locals `generateDashboard()` computes but never reads (at the top of the function — includes ADR, security, DDD-progress, test-count, and knowledge-base data) line up closely with content this section used to document as five additional rows (INTEL/SWARM/ARCH/MEMORY, plus a differently-shaped CONTEXT). That's consistent with a render-side refactor that trimmed the output but left the data-gathering calls in place — not confirmed against git history, and not something this doc can fix; tracked separately for the code owners.*

---

## Color Reference

| Color          | ANSI       | Meaning                                 |
| -------------- | ---------- | --------------------------------------- |
| 🟢 Vivid green | `38;5;82`  | Healthy / complete / active / at target |
| 🟡 Gold        | `38;5;220` | Good progress, not complete             |
| 🟠 Orange      | `38;5;208` | Low — attention recommended             |
| 🔵 Sky blue    | `38;5;117` | Informational / auto-routed agent       |
| 🟣 Violet      | `38;5;99`  | Git identity (⬡ symbol, Full Mode header) |
| 🟦 Teal        | `38;5;51`  | Knowledge / chunk data                  |
| 🌿 Mint        | `38;5;120` | Hooks / triggers                        |
| ⚫ Slate       | `38;5;245` | Idle / no data / neutral                |
| 🔴 Coral       | `38;5;203` | Error / over limit / CVE found          |

---

## Data Sources at a Glance

| File | Written by | Read by |
| ---- | ---------- | ------- |
| `.monomind/last-route.json` | `route` hook (`pick-core.cjs`) | AGENT row, compact agent segment |
| `.monomind/knowledge/chunks.jsonl` | `session-restore` hook | compact `📚`, `📄` docs row |
| `.monomind/knowledge/doc-metadata.jsonl` | `doc ingest` | `📄` docs row |
| `.monomind/trigger-index.json` | MicroAgent trigger scan (`utils/micro-agents.cjs`) | compact `🎯` |
| `.claude/settings.json` | Project configuration | compact `⚡` |
| `.monomind/metrics/learning.json` | `monomind init` / `init upgrade` | `💡` (only `intelligence.score`, which `init` does not write) |
| `.monomind/data/auto-memory-store.json`, `.monomind/data/ranked-context.json` | Nothing current (legacy files) | `💡` fallback |
| `.monomind/metrics/graph-usage.json` | Monograph gate (`utils/monograph.cjs`) | CONTEXT `📊` and `💡 hints` |
| `.monomind/metrics/token-summary.json` | `token-tracker.cjs` | CONTEXT and compact token spend |
| `.monomind/control.json` | `control-start.cjs` | `🖥 DASH` row |
| `.monomind/skills.jsonl`, `.monomind/metrics/ddd-progress.json`, `.monomind/security/audit-status.json`, `.agents/shared_instructions.md` | Various | Read, but not shown in either text mode (`ddd-progress` only in `--json`) |
| `~/.claude/projects/…/*.jsonl` | Claude Code session writer | `--json` output only (not Full/Compact Mode text) |

---

## Toggling Modes

```bash
# Via slash command (instant, no routing overhead)
/ts

# Via CLI
node .claude/helpers/toggle-statusline.cjs

# Directly
node .claude/helpers/statusline.cjs          # Respects current mode
node .claude/helpers/statusline.cjs --json   # Machine-readable JSON dump
```

Current mode is persisted in `.monomind/statusline-mode.txt`.

---

## Background Workers

There is no separate background daemon. Neither text mode renders the output of the <!-- doc-count:workers -->9<!-- /doc-count:workers --> background workers in `@monoes/hooks` (`ddd`, `map`, `audit`, `consolidate`, and others); `ddd-progress.json` reaches only the `--json` output. Workers run on demand (see [Hooks](./hooks.md#background-workers-9)). `monomind doctor` reports worker-metrics freshness, and you can refresh any metric on demand:

```bash
monomind hooks worker list        # list workers and their status
monomind hooks worker run ddd     # refresh .monomind/metrics/ddd-progress.json now
```
