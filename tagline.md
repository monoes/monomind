# Monobrain Statusline Reference

The Monobrain statusline is a live dashboard embedded in Claude Code's status bar. It surfaces real-time intelligence about your project — git state, active agent, knowledge base, swarm health, architecture compliance, memory usage, and context budget — without you having to run any commands.

It has two modes you can toggle with `/ts`:

- **Compact** — a single line that fits in Claude Code's status bar
- **Full** — a six-row dashboard printed above every response

---

## Compact Mode

```
▊ Monobrain ○  │  ⎇ main +1 ~9921 ↑5  │  Sonnet 4.6  │  → Level Designer  │  💡 3%  │  📚 190k  │  🎯 3t  │  ⚡ 14h
```

| Element              | Meaning                                                          | Source                                                                        |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `▊ Monobrain`        | Brand mark + swarm status dot                                    | Always present                                                                |
| `●` green / `○` grey | Swarm **LIVE** (active within 5 min) or **IDLE**                 | `.monobrain/swarm/swarm-state.json` mtime                                     |
| `⎇ main`             | Current git branch                                               | `git branch --show-current`                                                   |
| `+1`                 | Staged files                                                     | `git status --porcelain` index column                                         |
| `~9921`              | Modified but unstaged files                                      | `git status --porcelain` worktree column                                      |
| `↑5`                 | Commits ahead of remote (need push)                              | `git rev-list --left-right --count HEAD...@{upstream}`                        |
| `↓N`                 | Commits behind remote (need pull)                                | Same command, right count                                                     |
| `Sonnet 4.6`         | Active Claude model                                              | Session JSONL → `.claude.json` → `settings.json` → env → `Sonnet 4.6` default |
| `→ Level Designer`   | Currently routed agent (→ = auto-routed, ● = manually activated) | `.monobrain/last-route.json` (written by route hook)                          |
| `💡 3%`              | Neural intelligence score — pattern cache fill rate              | `.monobrain/metrics/learning.json` → `intelligence.score`                     |
| `📚 190k`            | Knowledge base chunks indexed (Task 28)                          | Line count of `.monobrain/knowledge/chunks.jsonl`                             |
| `🎯 3t`              | Active microagent trigger rules (Task 32)                        | Key count in `.monobrain/trigger-index.json`                                  |
| `⚡ 14h`             | Hooks active                                                     | Hook entries in `.claude/settings.json`                                       |

Items only appear when they have data — `📚`, `🎯`, `🐝` are hidden when their count is 0.

---

## Full Mode

Toggled with `/ts`. Six rows separated by dividers.

```
▊ Monobrain v1.0.0  ○ IDLE  nokhodian  │  ⎇ main  +1  ~9921 mod  ?38  ↑5  │  🤖 Sonnet 4.6
──────────────────────────────────────────────────────
💡  INTEL    ▱▱▱▱▱▱ 3%   │   📚 190 chunks   │   76 patterns
──────────────────────────────────────────────────────
🐝  SWARM    0/15 agents   ⚡ 14/14 hooks   │   🎯 3 triggers · 24 agents   │   → ROUTED  👤 Coder  81%
──────────────────────────────────────────────────────
🧩  ARCH     82/82 ADRs   │   DDD ▰▰▱▱▱ 40%   │   🛡️ ✖ NONE   │   CVE not scanned
──────────────────────────────────────────────────────
🗄️  MEMORY   0 vectors   │   2.0 MB   │   🧪 66 test files   │   MCP 1/1  DB ✔
──────────────────────────────────────────────────────
📋  CONTEXT  📄 SI 80% budget (1201/1500 chars)   │   🏗 ▰▰▱▱▱ 2/5 domains   │   💾 47 MB RAM
```

---

### Header Row

```
▊ Monobrain v1.0.0  ○ IDLE  nokhodian  │  ⎇ main  +1  ~9921 mod  ?38  ↑5  │  🤖 Sonnet 4.6
```

| Element              | Meaning                                        | Source                                                                                                                                               |
| -------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `▊ Monobrain v1.0.0` | Brand mark and package version                 | Reads nearest `package.json` → `version` field                                                                                                       |
| `● LIVE` / `○ IDLE`  | Whether a swarm coordination session is active | `.monobrain/swarm/swarm-state.json` — **LIVE** if file is < 5 min old                                                                                |
| `nokhodian`          | Your git identity                              | `git config user.name`                                                                                                                               |
| `⎇ main`             | Active branch                                  | `git branch --show-current`                                                                                                                          |
| `+1`                 | Files staged (index ready to commit)           | `git status --porcelain` — index column not space/`?`                                                                                                |
| `~9921 mod`          | Files modified but not staged                  | Same output, worktree column                                                                                                                         |
| `?38`                | Untracked files                                | Lines starting `??` in porcelain output                                                                                                              |
| `↑5`                 | Commits ahead of upstream                      | `git rev-list --left-right --count HEAD...@{upstream}` left count                                                                                    |
| `↓N`                 | Commits behind upstream (need pull)            | Same, right count                                                                                                                                    |
| `🤖 Sonnet 4.6`      | Active Claude model                            | Lookup chain: live session JSONL → `~/.claude.json` `lastModelUsage` → `settings.json` → env vars (`ANTHROPIC_MODEL`, `CLAUDE_MODEL`) → `Sonnet 4.6` |

---

### Row 1 — 💡 INTEL

```
💡  INTEL    ▱▱▱▱▱▱ 3%   │   📚 190 chunks   │   76 patterns
```

Intelligence and learning subsystem status.

| Element         | Meaning                                                        | Source                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `▱▱▱▱▱▱ 3%`     | Neural intelligence fill — how saturated the pattern cache is  | `.monobrain/metrics/learning.json` → `intelligence.score`. Falls back to vector count heuristic: 2,000 vectors = 100%. Color: slate (0%) → orange (1–39%) → gold (40–74%) → green (75%+) |
| `📚 190 chunks` | Knowledge base entries indexed by Task 28 (AgentKnowledgeBase) | Line count of `.monobrain/knowledge/chunks.jsonl`. Chunks are created by splitting CLAUDE.md, todo.md, and last-route.json at session-restore. Grows as sessions accumulate              |
| `✦ N skills`    | Learned procedural skills (Task 45 — ProceduralMemory)         | Line count of `.monobrain/skills.jsonl`. Only shown when > 0                                                                                                                             |
| `76 patterns`   | Neural patterns learned across sessions                        | `.monobrain/metrics/ddd-progress.json` → `patternsLearned`. Populated by intelligence consolidation at session-end                                                                       |

**How chunks grow:** Each `session-restore` hook call runs `_autoIndexKnowledge()` which reads project files, splits them into ~200-token chunks, hashes each chunk, and appends new ones to `chunks.jsonl`. Already-indexed chunks are skipped. The 190 shown here represent accumulated knowledge from all sessions so far.

---

### Row 2 — 🐝 SWARM

```
🐝  SWARM    0/15 agents   ⚡ 14/14 hooks   │   🎯 3 triggers · 24 agents   │   → ROUTED  👤 Coder  81%
```

Active agent coordination and routing state.

| Element                     | Meaning                                                        | Source                                                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0/15 agents`               | Active agents / configured maximum                             | `.monobrain/swarm/swarm-state.json` → `agents.length`. Falls back to `.monobrain/metrics/swarm-activity.json`. Green when > 0                                                                                     |
| `⚡ 14/14 hooks`            | Hooks wired / total available                                  | Counts all hook entries in `.claude/settings.json` + `.js`/`.sh` files in `.claude/hooks/`. Mint green = at least one hook active                                                                                 |
| `🎯 3 triggers · 24 agents` | MicroAgent trigger rules active (Task 32 — MicroagentTriggers) | Reads `.monobrain/trigger-index.json`. 3 trigger keywords across 24 specialist agents are indexed and scanned on every route call. Agents with `triggers:` frontmatter in their `.md` definition get auto-matched |
| `→ ROUTED` / `● ACTIVE`     | How the current agent was selected                             | `→ ROUTED` = selected automatically by the RouteLayer; `● ACTIVE` = manually loaded via `/use-agent` or `load-agent` command                                                                                      |
| `👤 Coder`                  | Currently selected agent name                                  | `.monobrain/last-route.json` → `agent` field. Updated on every route call. Stale after 30 minutes                                                                                                                 |
| `81%`                       | Routing confidence score                                       | Same file → `confidence` field. Shown only for auto-routed agents                                                                                                                                                 |

**Agent display logic:** The agent name is formatted from the slug (`level-designer` → `Level Designer`). If a display name is set in the agent's markdown file, that takes priority. For predefined slash commands (`/ts`, `/commit`, etc.) the command name itself is shown instead of a routing result.

---

### Row 3 — 🧩 ARCH

```
🧩  ARCH     82/82 ADRs   │   DDD ▰▰▱▱▱ 40%   │   🛡️ ✖ NONE   │   CVE not scanned
```

Architectural compliance and security posture.

| Element                             | Meaning                                            | Source                                                                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `82/82 ADRs`                        | Architecture Decision Records: implemented / total | Scans `packages/implementation/adrs/`, `docs/adrs/`, `.monobrain/adrs/` for `.md` files starting with `ADR-`. Green = all implemented; gold = some pending                                |
| `DDD ▰▰▱▱▱ 40%`                     | Domain-Driven Design alignment percentage          | `.monobrain/metrics/ddd-progress.json` → `progress` (0–100). Represents how much of the domain model is implemented across the five DDD layers                                            |
| `🛡️ ✔ CLEAN` / `✖ NONE`             | Security scan status badge                         | `.monobrain/security/audit-status.json` → `status`. Values: `✔ CLEAN` (scanned, no issues), `✔ SCANNED` (completed), `⟳ STALE` (> 7 days old), `⏸ PENDING` (queued), `✖ NONE` (never run) |
| `CVE not scanned` / `CVE N/M fixed` | Vulnerability count and fix progress               | Same file → `totalCves`, `cvesFixed`. Green = zero CVEs; coral = unfixed CVEs remain                                                                                                      |

**DDD color scale:** orange (< 40%) → gold (40–74%) → green (≥ 75%).

---

### Row 4 — 🗄️ MEMORY

```
🗄️  MEMORY   0 vectors   │   2.0 MB   │   🧪 66 test files   │   MCP 1/1  DB ✔
```

Vector memory state and integrations.

| Element            | Meaning                                 | Source                                                                                                                                                                                                       |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0 vectors`        | Embeddings stored in AgentDB            | Counts entries in `.monobrain/data/auto-memory-store.json`. Also checks `ranked-context.json → entries.length`. Green when > 0. `⚡ HNSW` tag appears only when both `hnsw.index` exists **and** vectors > 0 |
| `2.0 MB`           | Total on-disk size of all memory stores | Sums sizes of `auto-memory-store.json`, `ranked-context.json`, `memory.db`, `memory.graph`                                                                                                                   |
| `🧪 66 test files` | Number of test files across the project | Counts files matching `*.test.*` / `*.spec.*` in `tests/`, `src/`, `v1/` — no file reads, stat only                                                                                                          |
| `MCP 1/1`          | MCP servers: enabled / configured       | `.claude/settings.json` → `mcpServers`. Green = all enabled; gold = partial; coral = none enabled                                                                                                            |
| `DB ✔`             | SQLite vector database present          | Presence of `memory.db` in any of: `.swarm/`, `.monobrain/`, `data/`                                                                                                                                         |
| `API ✔`            | AI API key configured                   | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set in environment                                                                                                                                                   |

**When do vectors populate?** The `auto-memory-store.json` is written by the `AutoMemoryBridge` from `@monobrain/memory`. It imports entries from `MEMORY.md` at session-start and syncs back at session-end. Vectors also accumulate via `npx monobrain@latest memory store` or through intelligence graph consolidation when the 💡 score rises above ~20%.

---

### Row 5 — 📋 CONTEXT

```
📋  CONTEXT  📄 SI 80% budget (1201/1500 chars)   │   🏗 ▰▰▱▱▱ 2/5 domains   │   💾 47 MB RAM
```

Token budget health and session resource usage.

| Element                | Meaning                                                  | Source                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `📄 SI 80% budget`     | Shared Instructions token budget usage (Task 23 monitor) | Reads `.agents/shared_instructions.md` and computes `length / 1500`. Hard limit of 1500 chars is enforced at session-restore — content beyond that is truncated with a warning |
| `(1201/1500 chars)`    | Exact character count / limit                            | Same file                                                                                                                                                                      |
| `🏗 ▰▰▱▱▱ 2/5 domains` | DDD domain completion bar                                | `.monobrain/metrics/ddd-progress.json` → `domainsCompleted` / `totalDomains`. Block bar (▰ = complete, ▱ = pending)                                                            |
| `💾 47 MB RAM`         | Process heap usage                                       | `process.memoryUsage().heapUsed` — no shell call. Orange when > 200 MB                                                                                                         |

**SI budget color scale:** green (≤ 80%) → gold (81–100%) → coral (> 100%, file is over limit and being truncated).

---

## Color Reference

| Color          | ANSI       | Meaning                                 |
| -------------- | ---------- | --------------------------------------- |
| 🟢 Vivid green | `38;5;82`  | Healthy / complete / active / at target |
| 🟡 Gold        | `38;5;220` | Good progress, not complete             |
| 🟠 Orange      | `38;5;208` | Low — attention recommended             |
| 🔵 Sky blue    | `38;5;117` | Informational / auto-routed agent       |
| 🟣 Violet      | `38;5;99`  | Model name                              |
| 🟦 Teal        | `38;5;51`  | Knowledge / chunk data                  |
| 🌿 Mint        | `38;5;120` | Hooks / triggers                        |
| ⚫ Slate       | `38;5;245` | Idle / no data / neutral                |
| 🔴 Coral       | `38;5;203` | Error / over limit / CVE found          |

---

## Data Sources at a Glance

| File                                     | Written by                                 | Read by rows        |
| ---------------------------------------- | ------------------------------------------ | ------------------- |
| `.monobrain/last-route.json`             | `route` hook (hook-handler.cjs)            | Header, SWARM       |
| `.monobrain/knowledge/chunks.jsonl`      | `session-restore` hook — Task 28           | INTEL               |
| `.monobrain/skills.jsonl`                | Task 45 (SkillRegistry)                    | INTEL               |
| `.monobrain/trigger-index.json`          | Task 32 (MicroagentTriggers, 1h TTL)       | SWARM               |
| `.monobrain/metrics/learning.json`       | Intelligence consolidation at session-end  | INTEL               |
| `.monobrain/metrics/ddd-progress.json`   | DDD tracker / domain scans                 | INTEL, CONTEXT      |
| `.monobrain/data/auto-memory-store.json` | AutoMemoryBridge on session-end            | MEMORY              |
| `.monobrain/data/ranked-context.json`    | PageRank consolidation at session-end      | MEMORY              |
| `.monobrain/security/audit-status.json`  | `monobrain security scan`                  | ARCH                |
| `.monobrain/swarm/swarm-state.json`      | Swarm init / coordinator                   | Header, SWARM       |
| `.agents/shared_instructions.md`         | Hand-edited — monitored daily by SI daemon | CONTEXT             |
| `~/.claude/projects/…/*.jsonl`           | Claude Code session writer                 | Header (model name) |
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

Current mode is persisted in `.monobrain/statusline-mode.txt`.

---

## Background Monitors

The statusline is backed by several background daemons that keep its data fresh:

| Daemon                        | Interval | What it does                                                                                           |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `shared-instructions-monitor` | 24 h     | Checks `.agents/shared_instructions.md` size; warns at 80% of the 1500-char limit; logs `[SI_MONITOR]` |
| `regression-benchmarks`       | 7 days   | Runs benchmark definitions from `.monobrain/benchmarks/*.json`; logs `[BENCHMARK_RUNNER]`              |
| `prompt-optimization`         | 7 days   | Runs BootstrapFewShot optimization on core agent prompts; logs improvements                            |

Daemons start automatically when `initDefaultWorkers()` is called (hooks package startup).
