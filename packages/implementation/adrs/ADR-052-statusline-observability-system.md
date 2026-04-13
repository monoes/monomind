# ADR-052: Statusline Observability System

**Status:** Implemented
**Date:** 2026-02-10
**Authors:** Monobrain Team
**Version:** 1.0.0
**Related:** ADR-051 (Infinite Context), ADR-048 (Auto Memory Integration), ADR-006 (Unified Memory), ADR-026 (3-Tier Model Routing)

## Context

### The Problem: Invisible System State

Claude Code operates with multiple concurrent subsystems — swarm agents, memory
backends, neural learning, security scanning, context management — but provides no
unified visibility into their state. Developers working in long sessions need to know:

- How much context window remains before compaction triggers
- Whether the swarm has active agents or is idle
- If the intelligence system is learning from patterns
- What security posture the project maintains
- Whether archived memory is being utilized

Without real-time feedback, developers make blind decisions about when to start new
sessions, whether agents are drifting, and if the system is operating optimally.

### What Claude Code Provides

Claude Code supports a `statusLine` configuration in `.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "<shell command>",
    "refreshMs": 5000,
    "enabled": true
  }
}
```

The command receives JSON on stdin with workspace metadata, model info, and optional
context window data. Its stdout is displayed as a persistent status bar in the Claude
Code terminal UI.

### What We Built

A multi-tier statusline system with 4 implementations, a TypeScript generator for
`npx monobrain init`, and real-time data feeds from 8+ subsystems.

## Decision

Implement a layered statusline architecture:

1. **Active statusline** (`.claude/statusline.sh`) — Bash script for the current
   project, read from `settings.json` `statusLine.command`
2. **Generated statusline** (`.claude/helpers/statusline.cjs`) — CommonJS script
   created by `npx monobrain init`, comprehensive with 12+ metric panels
3. **Lightweight statusline** (`.claude/statusline.mjs`) — ES module for agentic-flow
   integration, compact pipe-separated format
4. **Command statusline** (`.claude/statusline-command.sh`) — JSON-input focused,
   shows swarm topology and task metrics
5. **Generator** (`packages/@monobrain/cli/src/init/statusline-generator.ts`) — TypeScript
   that produces the `.cjs` script during project initialization

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Claude Code Terminal                          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ statusLine.command executes every refreshMs (5000ms)         │   │
│  │                                                              │   │
│  │  stdin: { workspace, model, context_window }                │   │
│  │  stdout: ANSI-colored multi-line status display             │   │
│  └──────────────────────┬──────────────────────────────────────┘   │
│                          │                                          │
│                          ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              .claude/statusline.sh (active)                   │  │
│  │                                                               │  │
│  │  Reads 8 data sources:                                       │  │
│  │                                                               │  │
│  │  ┌─────────────────┐  ┌──────────────────────┐              │  │
│  │  │ autopilot-state  │  │ v1-progress.json     │              │  │
│  │  │ .json            │  │ (DDD domains)        │              │  │
│  │  │ Context: 27%     │  │ Domains: 5/5         │              │  │
│  │  └─────────────────┘  └──────────────────────┘              │  │
│  │                                                               │  │
│  │  ┌─────────────────┐  ┌──────────────────────┐              │  │
│  │  │ learning.json    │  │ audit-status.json    │              │  │
│  │  │ Intel: 86%       │  │ CVE: 3/3 CLEAN      │              │  │
│  │  └─────────────────┘  └──────────────────────┘              │  │
│  │                                                               │  │
│  │  ┌─────────────────┐  ┌──────────────────────┐              │  │
│  │  │ patterns.db      │  │ transcript-archive   │              │  │
│  │  │ (SQLite)         │  │ .db (SQLite)         │              │  │
│  │  │ Quality: 0.999   │  │ Entries: 35          │              │  │
│  │  └─────────────────┘  └──────────────────────┘              │  │
│  │                                                               │  │
│  │  ┌─────────────────┐  ┌──────────────────────┐              │  │
│  │  │ swarm-activity   │  │ ps aux (process)     │              │  │
│  │  │ .json            │  │ Node/MCP detection   │              │  │
│  │  │ Agents: 3/15     │  │ Memory: 2782MB       │              │  │
│  │  └─────────────────┘  └──────────────────────┘              │  │
│  │                                                               │  │
│  │  Output (4 lines + separators):                              │  │
│  │  ▊ Monobrain V1  ● user  │  ⎇ branch  │  Model            │  │
│  │  ─────────────────────────────────────────                   │  │
│  │  🏗️  DDD Domains  [●●●●●]  5/5    ⚡ 1.0x → 2.49x-7.47x   │  │
│  │  🤖 Swarm ◉ [3/15] 👥 0   🟢 CVE 3/3  💾 2782MB            │  │
│  │       🛡️  27% 54.7K ⊘    🧠  86%                           │  │
│  │  🔧 Architecture  DDD ●79%  │  Security ●CLEAN              │  │
│  │       Memory ●AgentDB  │  Integration ●                     │  │
│  │  ─────────────────────────────────────────                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Sources

| Source File                              | Subsystem                   | Metrics                                          | Updated By                                                 |
| ---------------------------------------- | --------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `.monobrain/data/autopilot-state.json`   | Context Autopilot (ADR-051) | Token %, token count, prune cycles, growth trend | `context-persistence-hook.mjs` on every `UserPromptSubmit` |
| `.monobrain/metrics/v1-progress.json`    | DDD Architecture            | Domain count, DDD progress %, active agents      | `init` command, manual updates                             |
| `.monobrain/security/audit-status.json`  | Security                    | CVE count, audit status (CLEAN/PENDING)          | `security scan` command                                    |
| `.monobrain/metrics/performance.json`    | Performance                 | Flash Attention speedup                          | `performance benchmark` command                            |
| `.monobrain/metrics/learning.json`       | Intelligence                | Score (0-100), routing accuracy, SONA status     | `hooks post-task`, neural training                         |
| `.monobrain/learning/patterns.db`        | Pattern DB (SQLite)         | Short/long-term pattern counts, avg quality      | `hooks intelligence`, neural training                      |
| `.monobrain/data/transcript-archive.db`  | Context Archive (SQLite)    | Entry count, session count                       | `context-persistence-hook.mjs`                             |
| `.monobrain/metrics/swarm-activity.json` | Swarm Monitor               | Active agent count, swarm state                  | Swarm monitor daemon                                       |
| `ps aux` (process table)                 | System                      | Node/MCP memory, active processes                | Real-time OS query                                         |
| `git` (VCS)                              | Repository                  | Branch name, status                              | Real-time git query                                        |
| `gh api` (GitHub)                        | GitHub                      | Username                                         | Cached API call                                            |

### Statusline Implementations

#### 1. Active Statusline — `.claude/statusline.sh` (432 lines)

The currently wired script in `settings.json`. Bash-based for maximum compatibility.

**Display Layout:**

```
Line 0: ▊ Monobrain V1 ● user  │  ⎇ branch  │  Model
Line -: ─────────────────────────────────────────
Line 1: 🏗️  DDD Domains  [●●●●●]  5/5    ⚡ speedup → target
Line 2: 🤖 Swarm ◉ [N/15] 👥 sub  🟢 CVE X/3  💾 MEM  🛡️ CTX%  🧠 INT%
Line 3: 🔧 Architecture  DDD ●N%  │  Security ●STATUS  │  Memory ●AgentDB  │  Integration ●
Line -: ─────────────────────────────────────────
```

**Metric Icons:**

| Icon       | Metric                            | Source                      |
| ---------- | --------------------------------- | --------------------------- |
| `🏗️`       | DDD domain progress               | v1-progress.json            |
| `⚡`       | Flash Attention speedup           | performance.json            |
| `🤖`       | Swarm agent count                 | swarm-activity.json + ps    |
| `◉/○`      | Active/inactive processes         | ps aux                      |
| `👥`       | Sub-agent count                   | ps aux (Task tool agents)   |
| `📨`       | Message queue depth               | swarm-comms.sh              |
| `🟢/🟡/🔴` | Security CVE status               | audit-status.json           |
| `💾`       | Node process memory               | ps aux RSS                  |
| `🛡️/📂`    | Context % (autopilot/legacy)      | autopilot-state.json        |
| `⊘/⟳N`     | Compaction blocked / prune cycles | autopilot-state.json        |
| `🧠`       | Intelligence score                | learning.json + patterns.db |
| `🔧`       | Architecture status               | v1-progress.json            |

**Color Thresholds:**

| Metric         | Green | Cyan  | Yellow | Red  |
| -------------- | ----- | ----- | ------ | ---- |
| Context %      | 0-49  | 50-69 | 70-84  | 85+  |
| Intelligence % | 75+   | 50-74 | 25-49  | 0-24 |
| Agents         | 8+    | —     | 1-7    | 0    |
| Domains        | 5     | —     | 1-4    | 0    |

**Context Autopilot Integration (ADR-051):**

The statusline reads from `autopilot-state.json` which is written by the
`context-persistence-hook.mjs` on every `UserPromptSubmit` hook:

```json
{
  "sessionId": "f1bd5b59-...",
  "lastTokenEstimate": 54700,
  "lastPercentage": 0.274,
  "pruneCount": 0,
  "warningIssued": false,
  "history": [{ "ts": ..., "tokens": ..., "pct": ..., "turns": ... }]
}
```

When autopilot is active:

- Icon changes from `📂` (folder) to `🛡️` (shield)
- Token count shown (e.g., `54.7K`)
- Prune indicator: `⊘` (no prunes needed) or `⟳N` (N prune cycles)

**Intelligence Score Computation:**

```
Base:     learning.json → intelligence.score (0-100)
+ Boost:  patterns.db → AVG(quality) × 20 (up to +20)
+ Boost:  transcript-archive.db → COUNT(*) / 10 (up to +10)
= Final:  capped at 100
```

#### 2. Generated Statusline — `.claude/helpers/statusline.cjs` (1,193 lines)

Created by `npx monobrain init`. CommonJS for ES module project compatibility.

**12 Metric Panels:**

| Panel          | Function                 | Lines                            |
| -------------- | ------------------------ | -------------------------------- |
| User Info      | `getUserInfo()`          | Git user, branch, model          |
| Learning Stats | `getLearningStats()`     | Intelligence loop data           |
| V1 Progress    | `getV1Progress()`        | DDD from real metrics            |
| Security       | `getSecurityStatus()`    | CVE tracking                     |
| Swarm          | `getSwarmStatus()`       | Cross-platform agent detection   |
| System Metrics | `getSystemMetrics()`     | Memory, intelligence, context    |
| ADR Status     | `getADRStatus()`         | Architecture decision compliance |
| Hooks          | `getHooksStatus()`       | Hook enablement tracking         |
| AgentDB        | `getAgentDBStats()`      | Vector count, HNSW index         |
| Tests          | `getTestStats()`         | Test file/case counting          |
| Integration    | `getIntegrationStatus()` | MCP, database, API               |
| Git            | `getGitStatus()`         | Modified, staged, untracked      |

**Output Modes:**

- Default: Full ANSI-colored 4-line display
- `--json`: Pretty-printed JSON of all metrics
- `--compact`: Minified JSON

#### 3. Lightweight Statusline — `.claude/statusline.mjs` (110 lines)

ES module for agentic-flow integration. Compact pipe-separated format with 5-second
cache TTL for swarm status.

#### 4. Command Statusline — `.claude/statusline-command.sh` (177 lines)

JSON-input focused. Shows swarm topology configuration, CPU/memory (with color-coded
thresholds), session duration, task success rate with streak tracking, and hooks
activity status.

### Init System Integration

#### Generator — `packages/@monobrain/cli/src/init/statusline-generator.ts` (1,317 lines)

Produces the `.cjs` script during `npx monobrain init`:

```typescript
function generateStatuslineScript(options: InitOptions): string {
  // Generates 1,193-line CommonJS script with all metric panels
  // Configurable via StatuslineConfig interface
}

function generateStatuslineHook(options: InitOptions): string {
  // Generates shell integration hook for bash/zsh/starship
}
```

#### Settings Generator — `packages/@monobrain/cli/src/init/settings-generator.ts`

Wires the statusline into `.claude/settings.json`:

```typescript
function generateStatusLineConfig(options: InitOptions): object {
  return {
    type: "command",
    command: "node .claude/helpers/statusline.cjs",
    refreshMs: config.refreshInterval, // Default: 5000
    enabled: config.enabled,
  };
}
```

#### Executor — `packages/@monobrain/cli/src/init/executor.ts`

During init:

1. Copies advanced statusline files (`.sh`, `.mjs`) from package source if available
2. Falls back to generating `.cjs` + hook via `statusline-generator.ts`
3. On upgrade: force-updates statusline while preserving metrics

#### Types — `packages/@monobrain/cli/src/init/types.ts`

```typescript
interface StatuslineConfig {
  enabled: boolean; // Enable statusline
  showProgress: boolean; // V1 DDD progress
  showSecurity: boolean; // CVE status
  showSwarm: boolean; // Swarm agent count
  showHooks: boolean; // Hooks metrics
  showPerformance: boolean; // Performance targets
  refreshInterval: number; // Refresh ms (default: 5000)
}
```

### Init Presets

| Preset        | Statusline                         |
| ------------- | ---------------------------------- |
| `full`        | All panels enabled, 5s refresh     |
| `minimal`     | Disabled (only core functionality) |
| `security`    | Security + swarm panels            |
| `development` | All panels enabled                 |

## File Inventory

| File                                                       | Lines | Language   | Role                                |
| ---------------------------------------------------------- | ----- | ---------- | ----------------------------------- |
| `.claude/statusline.sh`                                    | 432   | Bash       | Active statusline (settings.json)   |
| `.claude/helpers/statusline.cjs`                           | 1,193 | CommonJS   | Generated comprehensive statusline  |
| `.claude/statusline.mjs`                                   | 110   | ES Module  | Lightweight agentic-flow statusline |
| `.claude/statusline-command.sh`                            | 177   | Bash       | JSON-input command statusline       |
| `packages/@monobrain/cli/src/init/statusline-generator.ts` | 1,317 | TypeScript | Generator for `.cjs` during init    |
| `packages/@monobrain/cli/src/init/settings-generator.ts`   | ~20   | TypeScript | Wires statusLine into settings.json |
| `packages/@monobrain/cli/src/init/executor.ts`             | ~60   | TypeScript | Copy/generate during init           |
| `packages/@monobrain/cli/src/init/types.ts`                | ~20   | TypeScript | `StatuslineConfig` interface        |

## Performance

| Operation                    | Budget     | Actual                        |
| ---------------------------- | ---------- | ----------------------------- |
| statusline.sh full execution | 1000ms     | ~200ms                        |
| JSON file reads (jq)         | 50ms each  | ~10ms each                    |
| SQLite queries (sqlite3)     | 100ms each | ~5ms each                     |
| Process detection (ps aux)   | 200ms      | ~50ms                         |
| Git operations               | 100ms      | ~20ms                         |
| GitHub API (gh, cached)      | 500ms      | ~100ms (first), ~0ms (cached) |
| **Total refresh**            | **5000ms** | **~400ms**                    |

## Security Considerations

1. **No secrets exposed**: Statusline only reads metric files, never credentials
2. **Read-only**: All data sources are read-only file access or process inspection
3. **No network**: statusline.sh makes no network calls (gh API is cached from init)
4. **Graceful failure**: Every metric read is wrapped in error suppression (`2>/dev/null`)
5. **No code execution**: Statusline never evaluates dynamic code from data files

## Consequences

### Positive

1. **Real-time visibility**: Developers see context %, intelligence, swarm, and security
   at a glance without switching windows or running commands
2. **Context Autopilot feedback**: The `🛡️ 27% 54.7K ⊘` display confirms compaction
   is blocked and shows exact token usage — no surprises
3. **Intelligence tracking**: The `🧠 86%` score motivates pattern storage and shows
   the system is learning from session interactions
4. **Multi-implementation flexibility**: Bash for current use, CJS for init portability,
   MJS for agentic-flow, each optimized for its context
5. **Zero-dependency active script**: statusline.sh uses only bash builtins, jq, and
   sqlite3 — no npm install required

### Negative

1. **4 implementations**: Maintenance burden of 4 separate statusline files. Mitigation:
   the generator produces the CJS version programmatically; the bash scripts are stable
2. **Process detection heuristics**: `ps aux | grep` is fragile for counting agents.
   Mitigation: swarm-activity.json from the monitor daemon is preferred when available
3. **SQLite dependency**: Intelligence score reads from `patterns.db` and
   `transcript-archive.db` via `sqlite3` CLI. Mitigation: falls back to `learning.json`
   if sqlite3 is not installed

### Neutral

1. **5-second refresh**: Default `refreshMs: 5000` balances freshness with CPU cost
2. **ANSI colors**: Terminal-dependent rendering. Claude Code's terminal handles ANSI
   well; raw SSH sessions may vary
3. **JSON data coupling**: Statusline depends on specific JSON key paths in metric
   files. Changes to metric formats require statusline updates

## Future Enhancements

1. **Unified statusline**: Consolidate 4 implementations into a single TypeScript
   module that compiles to CJS, with bash as a thin wrapper
2. **WebSocket feed**: Replace file polling with event-driven updates from the MCP
   server for sub-second refresh
3. **Customizable layout**: Allow users to configure which panels appear and in what
   order via `StatuslineConfig`
4. **Sparkline graphs**: Show context growth trend as a sparkline character sequence
   (e.g., `▁▂▃▅▇` for rising usage)
5. **Team statusline**: When Agent Teams are active, show teammate status inline

## References

- Claude Code `statusLine` config: `@anthropic-ai/claude-agent-sdk` settings schema
- ADR-051: Infinite Context via Compaction-to-Memory Bridge (autopilot-state.json)
- ADR-048: Auto Memory Integration (learning patterns)
- ADR-006: Unified Memory Service (AgentDB)
- ADR-026: 3-Tier Model Routing (intelligence scoring)
