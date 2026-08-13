# Monomind Statusline Reference

The Monomind statusline is a live dashboard embedded in Claude Code's status bar. It surfaces real-time intelligence about your project — git state, active agent, knowledge base, swarm health, architecture compliance, memory usage, and context budget — without you having to run any commands.

It has two modes you can toggle with `/ts`:

- **Compact** — a single line that fits in Claude Code's status bar
- **Full** — a multi-line dashboard printed above every response

---

## Compact Mode

```
▊ Monomind ○  │  ⎇ main +1 ~9921 ↑5  │  → Level Designer  │  💡 3%  │  📚 190k  │  🎯 3t  │  ⚡ 14h
```

| Element              | Meaning                                                          | Source                                                                        |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `▊ Monomind`        | Brand mark + swarm status dot                                    | Always present                                                                |
| `●` green / `○` grey | Swarm **LIVE** (active within 5 min) or **IDLE**                 | `.monomind/swarm/swarm-state.json` mtime                                     |
| `⎇ main`             | Current git branch                                               | `git branch --show-current`                                                   |
| `+1`                 | Staged files                                                     | `git status --porcelain` index column                                         |
| `~9921`              | Modified but unstaged files                                      | `git status --porcelain` worktree column                                      |
| `↑5`                 | Commits ahead of remote (need push)                              | `git rev-list --left-right --count HEAD...@{upstream}`                        |
| `↓N`                 | Commits behind remote (need pull)                                | Same command, right count                                                     |
| `→ Level Designer`   | Currently routed agent (→ = auto-routed, ● = manually activated) | `.monomind/last-route.json` (written by route hook)                          |
| `💡 3%`              | Intelligence score — pattern cache fill rate                     | `.monomind/metrics/learning.json` → `intelligence.score`                     |
| `📚 190k`            | Knowledge base chunks indexed (Task 28)                          | Line count of `.monomind/knowledge/chunks.jsonl`                             |
| `🎯 3t`              | Active microagent trigger rules (Task 32)                        | Key count in `.monomind/trigger-index.json`                                  |
| `⚡ 14h`             | Hooks active                                                     | Hook entries in `.claude/settings.json`                                       |

Items only appear when they have data — `📚`, `🎯`, `🐝` are hidden when their count is 0.

**Not shown: the Claude model name** (e.g. "Sonnet 4.6"). This line never calls `getModelName()`; see the Full Mode header note below for the full lookup chain and where it's actually exposed.

---

## Full Mode

Toggled with `/ts`. Prints a multi-line dashboard above every response. Three sections always appear — Header, 🤖 AGENT, 🧠 CONTEXT — each separated by a divider line. Two more appear only when there's live state to show them; see [Conditional additions](#conditional-additions) below.

```
▊Monomind v2.8.3  ● LIVE  monoes/monomind  │  ◎monomind  │  ⬡nokhodian  │  ⎇main +1 ~12 ?3 ↑5  ⏱42m
──────────────────────────────────────────────────────
🤖 AGENT  👤 Coder  81%  │  🔄 no active loops
──────────────────────────────────────────────────────
🧠 CONTEXT  🔗12kn 34ke ●fresh  │  📊62%·38%grep 💰$4.12  │  ✨2HIL  │  $3.10·$88.40mo
```

That's what a populated session shows. A fresh one — no git remote, no routed agent yet, no graph/cost data — omits most individual elements too; each is independently conditional (see the tables below).

---

### Header

```
▊Monomind v2.8.3  ● LIVE  monoes/monomind  │  ◎monomind  │  ⬡nokhodian  │  ⎇main +1 ~12 ?3 ↑5  ⏱42m
```

Source: `generateDashboard()`, `.claude/helpers/statusline.cjs:1208-1226`.

| Element              | Meaning                                        | Source                                                                                                                                                                          |
| --------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `▊Monomind v2.8.3`   | Brand mark and package version                 | Nearest `package.json` → `version` (`getVersion()`)                                                                                                                              |
| `● LIVE` / `○ IDLE`  | Whether swarm coordination looks active        | `getSwarmStatus()` — first of 3 tiers that finds live state wins: agent-registration files in `.monomind/agents/registrations/` (<30 min old), else `swarm-state.json` (<5 min old), else `swarm-activity.json` (<5 min old) |
| `monoes/monomind`    | Project identifier                             | `getProjectName()` — `owner/repo` parsed from `git remote get-url origin`; falls back to the working-directory folder name when there's no remote                              |
| `◎monomind`          | Working directory name                         | `path.basename(CWD)`                                                                                                                                                             |
| `⬡nokhodian`         | Your git identity                              | `git config user.name` (`getGitInfo()`)                                                                                                                                          |
| `⎇main`              | Active branch                                  | `git branch --show-current`                                                                                                                                                      |
| `+1` / `~12` / `?3`  | Staged / modified / untracked files            | Parsed from `git status --porcelain`; each segment only appears when its count is > 0                                                                                           |
| `↑5` / `↓N`          | Commits ahead / behind upstream                | `git rev-list --left-right --count HEAD...@{upstream}`; each only appears when > 0                                                                                              |
| `⏱42m`               | Session duration, shown only when available    | `.monomind/session.json` or `.claude/session.json` → `startTime`                                                                                                                |

**Not shown: the Claude model name** (e.g. "Sonnet 4.6"). `getModelName()` (`.claude/helpers/statusline.cjs:243`) implements a real lookup chain — live session JSONL (`~/.claude/projects/<escaped-cwd>/*.jsonl`) → `~/.claude.json` → `settings.json` → env vars (`ANTHROPIC_MODEL`/`CLAUDE_MODEL`) → `"Sonnet 4.6"` default — but its only call site anywhere in the file is `generateJSON()`, the `--json` output mode. Neither this header nor Compact Mode ever calls it, so the model name isn't part of either mode's visible output; read it via `node .claude/helpers/statusline.cjs --json` → `user.modelName`.

---

### 🤖 AGENT

```
🤖 AGENT  👤 Coder  81%  │  🔄 no active loops
```

Source: `.claude/helpers/statusline.cjs:1228-1267`.

| Element                                     | Meaning                                                     | Source                                                                                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `● ACTIVE` (green, shown only when present)  | Marks an agent loaded manually via `/use-agent`/`load-agent`, as opposed to auto-routed | `.monomind/last-route.json` → `activated` (`getActiveAgent()`)                                                                                                                                            |
| `👤 Coder`                                   | Currently selected agent name                                | Same file → `name` (falls back to the slug, Title Cased — see below). Reads `👤 no agent routed` (slate) when the file is missing, has no `agent` field, or its `updatedAt` is older than 30 minutes    |
| `81%` (only for auto-routed agents)          | Routing confidence score                                     | Same file → `confidence` — omitted when `activated` is true                                                                                                                                              |
| `🔄 no active loops` / `🔄 ⟳ cmd 2/5`        | Active `/loop` runs                                           | `.monomind/loops/*.json` (`getLoopStatus()`), skipping files with no activity in the last 6 hours. Up to 2 shown, `+N more` beyond that. `⏳ HIL` in place of `⟳` marks a loop waiting on a human answer; a `tillend`-type loop shows `run N` instead of `N/max` |
| `⚡123ms` (only when present)                 | Per-prompt hook latency                                       | `.monomind/metrics/hook-latency.json` (`getHookLatency()`); only shown when > 0ms, coral when > 500ms                                                                                                    |

**Agent display logic:** the agent name is formatted from the slug (`level-designer` → `Level Designer`). If a display name is set in the agent's markdown file, that takes priority. For predefined slash commands (`/ts`, `/commit`, etc.) the command name itself is shown instead of a routing result.

---

### 🧠 CONTEXT

```
🧠 CONTEXT  🔗12kn 34ke ●fresh  │  📊62%·38%grep 💰$4.12  │  ✨2HIL  │  $3.10·$88.40mo
```

Source: `.claude/helpers/statusline.cjs:1269-1306`. Everything past the `🔗` graph indicator is independently conditional — each `│`-separated segment only appears when its underlying data exists.

| Element                           | Meaning                                                                | Source                                                                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `🔗12kn 34ke` / `🔗no graph`       | Monograph knowledge-graph node/edge count                                  | `getGraphifyStats()` — tries `.monomind/graph/stats.json`, then a live `sqlite3` query against `.monomind/monograph.db`, then the legacy `.monomind/graph/graph.json` dump, in that order |
| `●fresh` / `●Nstale` / `●Nbehind`  | Graph freshness vs. commits made since the last build                      | `getGraphFreshness()` — compares the graph's build time to `git rev-list --count --since=<build time> HEAD`; fresh = 0 commits behind, stale = more than 5                                |
| `📊62%·38%grep`                   | Share of code lookups Monograph answered vs. grep/glob/bash fallback       | `.monomind/metrics/graph-usage.json` (`getGraphUsage()`)                                                                                                                                   |
| `💰$4.12`                         | Estimated dollars saved by graph-assisted lookups over grep                | Same file → `dollars_saved`                                                                                                                                                                |
| `✨2HIL`                           | Pending human-in-the-loop questions from `/loop` runs, shown only when > 0 | `.monomind/loops/*-hil.md` files with no reply line yet (`getHILPending()`)                                                                                                                |
| `$3.10·$88.40mo`                  | Today's / this month's token spend                                         | `.monomind/metrics/token-summary.json` (`getTokenCostSummary()`) — **aggregated across all Claude Code projects on this machine, not just this repo.** Today's figure only shows when the cached data is from today (UTC); the month figure has no such gate |

---

### Conditional additions

Two more pieces of output appear only when there's live state to show — and they attach to the dashboard differently from each other:

**📄 docs — an indented continuation of CONTEXT, not its own row.** Appears directly under the CONTEXT line with no divider before or after it, only when `docStats.exists && parts.length` is true (`getDocStats()`, `.claude/helpers/statusline.cjs:1308-1329`):

```
🧠 CONTEXT  🔗12kn 34ke ●fresh
   📄 42docs 190chunks 12mem 3okf
```

Counts, each only included when > 0: indexed-doc lines in `.monomind/knowledge/doc-metadata.jsonl`, chunk lines in `.monomind/knowledge/chunks.jsonl`, `memory_entries` rows in `.monomind/memory/memory.db`, and exported files in `.monomind/exports/`.

**🏛 ORGS — a real peer row, with its own divider.** Appears only when `orgStatus.count > 0` (`getActiveOrgs()`, `.claude/helpers/statusline.cjs:1331-1343`):

```
──────────────────────────────────────────────────────
🏛 ORGS  ●docs-team now  │  ◌release-team 4m
```

Scans `.monomind/orgs/<name>/runs/*.jsonl` — or the equivalent path under the git common directory, for orgs run outside the current worktree — for run files updated in the last 10 minutes. `●` (green) = still running, last event isn't `run:complete`/`org:complete`; `◌` (slate) = finished but recent. Up to 5 orgs shown, each with time since its last event.

---

*Unverified aside: the 12 locals `generateDashboard()` computes but never reads (`.claude/helpers/statusline.cjs:1190-1205` — includes ADR, security, DDD-progress, test-count, and knowledge-base data) line up closely with content this section used to document as five additional rows (INTEL/SWARM/ARCH/MEMORY, plus a differently-shaped CONTEXT). That's consistent with a render-side refactor that trimmed the output but left the data-gathering calls in place — not confirmed against git history, and not something this doc can fix; tracked separately for the code owners.*

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

| File                                     | Written by                                 | Read by rows        |
| ---------------------------------------- | ------------------------------------------ | ------------------- |
| `.monomind/last-route.json`             | `route` hook (hook-handler.cjs)            | Header, SWARM       |
| `.monomind/knowledge/chunks.jsonl`      | `session-restore` hook — Task 28           | INTEL               |
| `.monomind/skills.jsonl`                | Task 45 (SkillRegistry)                    | INTEL               |
| `.monomind/trigger-index.json`          | Task 32 (MicroagentTriggers, 1h TTL)       | SWARM               |
| `.monomind/metrics/learning.json`       | Intelligence consolidation at session-end  | INTEL               |
| `.monomind/metrics/ddd-progress.json`   | `ddd` worker (@monoes/hooks)             | INTEL, CONTEXT      |
| `.monomind/data/auto-memory-store.json` | `auto-memory-hook.mjs` (session-start import / Stop sync) + intelligence consolidation | MEMORY              |
| `.monomind/data/ranked-context.json`    | PageRank consolidation at session-end      | MEMORY              |
| `.monomind/security/audit-status.json`  | `monomind security scan`                  | ARCH                |
| `.monomind/swarm/swarm-state.json`      | Swarm init / coordinator                   | Header, SWARM       |
| `.agents/shared_instructions.md`         | Hand-edited — size checked at session start | CONTEXT             |
| `~/.claude/projects/…/*.jsonl`           | Claude Code session writer                 | `--json` output only (not Full/Compact Mode text) |
| `.claude/settings.json`                  | Project configuration                      | SWARM (hooks, MCP)  |

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

There is no separate background daemon. The statusline reads `.monomind/metrics/*.json` files written by the <!-- doc-count:workers -->0<!-- /doc-count:workers --> background workers in `@monoes/hooks` (`ddd`, `map`, `audit`, `consolidate`, and others). Workers are initialized at session start; the metrics-producing ones refresh automatically when their output file is missing or older than 6 hours. `monomind doctor` reports worker-metrics freshness, and you can refresh any metric on demand:

```bash
monomind hooks worker list        # list workers and their status
monomind hooks worker run ddd     # refresh .monomind/metrics/ddd-progress.json now
```
