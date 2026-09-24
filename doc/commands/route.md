# `monomind route` Command Reference

> **Version 2.9.0**  
> CLI reference for `monomind route` subcommands. Task routing maps developer tasks to registry agents through the central picker (`route task`, the default — the same ranking as `monomind pick` and the `pick` MCP tool), 256-D vector cosine similarity (`RouteLayer`, via `route semantic`), and coverage gap analysis (`route coverage`) — backed by an outcome-tracking ledger (`route stats`/`feedback`) that measures routing accuracy over time. There is no reinforcement learning of any kind: no Q-table, no epsilon exploration, no learned state-action values. `route task`'s router (`createKeywordRouter`, `monovector/index.ts`) delegates to [`routing/agent-pick.ts → pickAgents`](packages/@monomind/cli/src/routing/agent-pick.ts#pickAgents).

---

## Command Overview

```bash
monomind route <task-description> [options]
monomind route <subcommand> [options]
```

### Registered Subcommands (9)

| Subcommand | Alias | Description |
|---|---|---|
| `task` | *(default)* | Route a task to the best registry agent (same ranking as `monomind pick`) |
| `semantic` | `sem` | Route a task through the central picker, falling back to cosine similarity (`RouteLayer`) and Haiku |
| `list-agents` | `agents`, `ls` | List the registry agents `route task` can pick |
| `stats` | — | Show keyword router outcome statistics (accuracy, adherence, trend) |
| `feedback` | — | Record a reward signal (-1.0 to 1.0) for a routing decision, into the outcomes ledger |
| `reset` | — | Clear the route-outcomes history file |
| `export` | — | Export route-outcome history to stdout or a JSON file |
| `import` | — | Import route-outcome history from a JSON file |
| `coverage` | `cov` | Route tasks based on test coverage analysis and gaps (ADR-017) |

---

## Subcommand Details

### 1. `monomind route task` *(default)*
Routes a task description to the best agent in `.monomind/registry.json` through the central picker: the Jev decision model when configured, otherwise keyword overlap with each agent's name and description (`createKeywordRouter` → `pickAgents` → `rankForTask`). The agent it returns is a spawnable name (the Task tool's `subagent_type`); with no registry match it answers `coder`.

```bash
monomind route task "implement authentication system"
monomind route task "write unit tests"
monomind route task "review security" --agent "Security Engineer"
```

- **Flags** (`commands/route.ts` `routeTaskCommand.options`):
  - `-k, --keyword`: Accepted for compatibility; routing always uses the central picker.
  - `-a, --agent <name>`: Force a registry agent by name or slug (bypasses routing); answers with its spawnable name.
  - `-j, --json`: Output decision as JSON.

---

### 2. `monomind route semantic`
Routes a task through the route layer ([Routing § 6](../concepts/routing.md#6-the-route-layer-route-semantic-hooks_route_semantic-agent-spawn---task)): the central picker's decision model (kept only at or above `MONOMIND_JEV_MIN_CONFIDENCE`), the `@monoes/routing` keyword pre-filter, the picker's keyword ranking when its top agent clearly leads (score ≥ 2, 1.5× the runner-up), then real-embedding cosine similarity in an isolated worker, a headless Haiku fallback below the threshold, and the 256-D hash encoder when the worker is unavailable.

```bash
monomind route semantic -t "audit API for SQL injection"
monomind route semantic -t "refactor react components" --debug
```

- **Flags**:
  - `-t, --task <string>`: Task description to route (**required**).
  - `-d, --debug`: Include top-10 route scores (`allScores`) in output.
  - `-j, --json`: Output decision and vector metadata in JSON format.

---

### 3. `monomind route list-agents`
Lists the registry agents (`.monomind/registry.json`) `route task` can pick: spawnable name, category and description.

```bash
monomind route list-agents
monomind route agents --json
```

## CLI Output JSON Schema (`RouteResult`)

When invoking `monomind route task --json` or `monomind route semantic --json`, the command returns a structured `RouteResult` JSON object:

```json
{
  "agentSlug": "coder",
  "confidence": 0.85,
  "method": "semantic",
  "routeName": "feature-coder",
  "allScores": [
    { "routeName": "feature-coder", "agentSlug": "coder", "score": 0.82 },
    { "routeName": "test-runner", "agentSlug": "tester", "score": 0.41 }
  ]
}
```

- `agentSlug`: Spawnable agent name — a bundled agent's frontmatter `name`, such as `coder` or `Security Engineer`. Every `@monoes/routing` route and keyword rule names one (checked by `routing/src/__tests__/agent-slugs.test.ts`); `general-purpose` only when no route could be scored.
- `confidence`: Normalized confidence score in $[0.0, 1.0]$.
- `method`: Routing cascade tier (`jev`, `keyword`, `semantic`, `llm_fallback`, `semantic_degraded`). `route task --json` returns `agentId`/`agentName`, `confidence` and `alternatives` instead.
- `routeName`: Matching rule name or centroid name.

---

### Available Agents

`route task`, `route list-agents` and `route feedback` read the project's agent registry (`.monomind/registry.json`, built from `.claude/agents/**.md`), so the choice is whatever agents the project ships — not a fixed list. `route feedback --agent` accepts a name or slug and records the spawnable name.

---

### 4. `monomind route feedback`
Records a feedback outcome (task, agent used, reward) into the route-outcomes ledger (`route-outcomes.jsonl`) — read back by `route stats` to compute accuracy/adherence/trend. It does not change any ranking directly: the outcome prior that re-ranks near-tied keyword picks is built from the hooks' adherence and subagent-outcome logs (`.monomind/pick-stats.json`, see [Routing § 7](../concepts/routing.md#7-outcome-tracking-and-the-learning-loop)).

```bash
monomind route feedback -t "implement auth" -a coder -r 0.9
monomind route feedback -t "write tests" -a tester -r -0.5
```

- **Flags**:
  - `-t, --task <string>`: Task description context (**required**).
  - `-a, --agent <id>`: Agent ID that executed the task (**required**).
  - `-r, --reward <number>`: Reward value between `-1.0` and `1.0` (default: `0.8`).
  - `-n, --next-task <string>`: Accepted but currently has no effect — threaded through to `KeywordRouter.update()` (`monovector/index.ts:127`), whose implementation takes only `task`/`agentId`/`reward` and never stores or reads `nextTask` in the TS source. Not wired to any multi-step-learning behavior.

---

### 5. `monomind route coverage`
Analyzes test coverage gaps and maps missing test suites to recommended agents.

```bash
monomind route coverage
monomind route coverage --suggest -p src/auth
monomind route coverage --gaps
```

- **Flags**:
  - `-p, --path <string>`: Subdirectory path to analyze for coverage.
  - `-t, --threshold <number>`: Target coverage threshold percentage (default: `80`).
  - `-s, --suggest`: Output actionable suggestions for improving test coverage.
  - `-g, --gaps`: List file coverage gaps grouped by recommended agent.
  - `-j, --json`: Output coverage metrics in JSON format.

---

### 6. `monomind route stats`, `reset`, `export`, `import`

All four operate on the same route-outcomes ledger (`route-outcomes.jsonl`). The pick prior's aggregate, `.monomind/pick-stats.json`, is separate: these commands neither export nor clear it (inspect it with `monomind pick --explain` or `doctor -c pick`).

- `monomind route stats`: Displays outcome count, accuracy, adherence, and trend (recent-half vs. prior-half accuracy), split by native/JS backend (`KeywordRouterStats`, `monovector/index.ts:66-72`).
- `monomind route reset [-f]`: Clears the route-outcomes history file. In an interactive session this requires `--force` to skip a confirmation warning; non-interactive runs (e.g. CI) proceed without it.
- `monomind route export [-f <file.json>]`: Exports route-outcome history as JSON — to stdout, or to a file (path must resolve inside the project directory and end in `.json`).
- `monomind route import -f <file.json>`: Imports route-outcome history from JSON (enforces a 50MB file size limit and the same path containment / `.json`-extension checks as export).
