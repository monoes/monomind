# `monomind route` Command Reference

> **Version 2.8.3**  
> CLI reference for `monomind route` subcommands. Task routing maps developer tasks to specialized agent types using deterministic keyword pre-filters, 256-D vector cosine similarity (`RouteLayer`), Q-learning reinforcement state tables, and coverage gap analysis.

---

## Command Overview

```bash
monomind route <task-description> [options]
monomind route <subcommand> [options]
```

### Registered Subcommands (9)

| Subcommand | Alias | Description |
|---|---|---|
| `task` | *(default)* | Route a task to optimal agent using keyword / Q-learning matching |
| `semantic` | `sem` | Route a task via vector cosine similarity (`RouteLayer`) |
| `list-agents` | `agents`, `ls` | List all available agent types ordered by priority |
| `stats` | — | Show keyword router statistics and Q-table metrics |
| `feedback` | — | Record feedback / reward signal (-1.0 to 1.0) for routing decisions |
| `reset` | — | Reset router Q-table state and learned statistics |
| `export` | — | Export router Q-table state to stdout or a JSON file |
| `import` | — | Import router Q-table state from a JSON file |
| `coverage` | `cov` | Route tasks based on test coverage analysis and gaps (ADR-017) |

---

## Subcommand Details

### 1. `monomind route task` *(default)*
Routes a task description to an agent type using keyword matching and Q-learning state tables.

```bash
monomind route task "implement authentication system"
monomind route task "write unit tests" --q-learning
monomind route task "review security" --agent reviewer
```

- **Flags**:
  - `-q, --q-learning`: Use keyword routing for agent selection (default: `true`).
  - `-a, --agent <id>`: Force specific agent ID (bypasses automatic routing).
  - `-e, --explore`: Enable epsilon exploration chance (default: `true`).
  - `-j, --json`: Output decision as JSON.

---

### 2. `monomind route semantic`
Routes a task description using 256-D embedding vector cosine similarity (`RouteLayer`).

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
Lists all supported target agent types, their descriptions, capabilities, and priorities.

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

- `agentSlug`: Target agent role (`coder`, `tester`, `reviewer`, `architect`, `researcher`, `optimizer`, `debugger`, `documenter`).
- `confidence`: Normalized confidence score in $[0.0, 1.0]$.
- `method`: Routing cascade tier (`keyword`, `semantic`, `llm_fallback`, `semantic_degraded`).
- `routeName`: Matching rule name or centroid name.

---

### Available Agent Types (8)

- `coder`: Implements features and writes code (Priority 1)
- `tester`: Creates tests and validates functionality (Priority 2)
- `reviewer`: Reviews code quality and security (Priority 3)
- `architect`: Designs system architecture (Priority 4)
- `researcher`: Researches requirements and patterns (Priority 5)
- `optimizer`: Optimizes performance and efficiency (Priority 6)
- `debugger`: Debugs issues and fixes bugs (Priority 7)
- `documenter`: Creates and updates documentation (Priority 8)

---

### 4. `monomind route feedback`
Records feedback rewards to tune Q-learning state-action tables.

```bash
monomind route feedback -t "implement auth" -a coder -r 0.9
monomind route feedback -t "write tests" -a tester -r -0.5
```

- **Flags**:
  - `-t, --task <string>`: Task description context (**required**).
  - `-a, --agent <id>`: Agent ID that executed the task (**required**).
  - `-r, --reward <number>`: Reward value between `-1.0` and `1.0` (default: `0.8`).
  - `-n, --next-task <string>`: Next task description for multi-step trajectory learning.

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

- `monomind route stats`: Displays Q-table size, update count, and step count.
- `monomind route reset [-f]`: Resets learned Q-values (requires `--force` in non-interactive sessions).
- `monomind route export [-f <file.json>]`: Exports Q-table JSON within project directory.
- `monomind route import -f <file.json>`: Imports Q-table JSON (enforces 50MB file size limit and path containment).
