---
name: hooks-automation
description: Automated coordination and learning from Claude Code operations using the monomind hooks system. Covers pre/post edit, command and task hooks, session persistence, routing, pattern logging, background workers, Claude Code settings.json wiring, and Git hook integration.
---

# Hooks Automation

Coordinate, validate, and learn from Claude Code operations through the `monomind hooks` command group and the hook handlers that `monomind init` installs into `.claude/settings.json`.

## What This Skill Does

The hooks system records what happens during a session (edits, commands, tasks) and uses that history to suggest agents, assess command risk, and persist session state. It enables:

- **Pre-operation hooks**: context and agent suggestions before an edit, risk assessment before a command, agent suggestions before a task
- **Post-operation hooks**: record edit, command, and task outcomes so routing can learn from them
- **Session management**: persist state at session end and restore it later
- **Routing**: route a task to the best agent (or model) and explain the decision
- **Pattern store**: log trajectories and search stored patterns (`hooks intelligence`); `hooks pretrain` consolidates hook activity into JSON state — no model is trained
- **Background workers**: run `@monoes/hooks` workers in-process

## Prerequisites

**Required:**
- Monomind CLI (`npm install -g monomind@latest`, or use `npx monomind`)
- Claude Code with hooks enabled in `.claude/settings.json`

**Optional:**
- Git repository (for the Git hook examples)
- A test framework (for quality gates)

## Quick Start

### Initialize Hooks

```bash
# Write the hooks configuration into .claude/settings.json
npx monomind init hooks

# Only the essential hooks
npx monomind init hooks --minimal
```

This wires Claude Code's `PreToolUse`, `PostToolUse`, and session events to the helper `.claude/helpers/hook-handler.cjs` (installed by `monomind init`), which handles pre-bash, pre-search (Grep/Glob), pre-agent, post-edit, session-restore, session-end, and related events.

### Basic Hook Usage

```bash
# Record task start and get agent suggestions
npx monomind hooks pre-task --description "Implement authentication"

# Record an edit outcome
npx monomind hooks post-edit --file "src/auth.js" --success true

# End the session and persist state
npx monomind hooks session-end
```

---

## Complete Guide

### Available Hooks

Run `npx monomind hooks --help` for the full list and `npx monomind hooks <sub> --help` for each subcommand's flags.

#### Pre-Operation Hooks

**pre-edit** - Get context and agent suggestions before editing a file
```bash
npx monomind hooks pre-edit [options]

Options:
  -f, --file <path>         File path to edit
  -o, --operation <type>    create | update | delete | refactor (default: update)
  -c, --context <text>      Additional context about the edit

Examples:
  npx monomind hooks pre-edit --file "src/auth/login.js"
  npx monomind hooks pre-edit -f "src/db.ts" -o refactor -c "split connection pool"
```

**pre-command** (alias: `pre-bash`) - Assess risk before executing a command
```bash
npx monomind hooks pre-command --command <cmd>

Options:
  -c, --command <cmd>       Command to execute (required)
  -d, --dry-run             Only analyze, do not execute (default: true)

Examples:
  npx monomind hooks pre-command -c "rm -rf ./build"
  npx monomind hooks pre-bash --command "docker build ."
```

**pre-task** - Record task start and get agent suggestions
```bash
npx monomind hooks pre-task [options]

Options:
  -d, --description <text>  Task description (required)
  -i, --task-id <id>        Task identifier (auto-generated if omitted)
  -a, --auto-spawn          Auto-spawn suggested agents (default: false)

Examples:
  npx monomind hooks pre-task --description "Implement user authentication"
  npx monomind hooks pre-task -d "Refactor codebase" -i refactor-1
```

There is no `pre-search` CLI subcommand. Search-time context (for Grep/Glob) is handled by the installed helper (`hook-handler.cjs pre-search`) that `monomind init hooks` wires up.

#### Post-Operation Hooks

**post-edit** - Record editing outcome for learning
```bash
npx monomind hooks post-edit [options]

Options:
  -f, --file <path>         File path that was edited
  -s, --success             Whether the edit was successful
  -o, --outcome <text>      Outcome description
  -m, --metrics <list>      Performance metrics (e.g. "time:500ms,quality:0.95")

Examples:
  npx monomind hooks post-edit --file "src/components/Button.jsx" --success true
  npx monomind hooks post-edit -f "api/auth.js" -s true -o "added token refresh"
```

The hook records the outcome; it does not format code. Run your formatter (Prettier, Black, gofmt) as its own hook command if you want auto-formatting.

**post-command** (alias: `post-bash`) - Record command execution outcome
```bash
npx monomind hooks post-command --command <cmd>

Options:
  -c, --command <cmd>       Command that was executed (required)
  -s, --success             Whether the command succeeded
  -e, --exit-code <n>       Command exit code (default: 0)
  -d, --duration <ms>       Execution duration in milliseconds

Examples:
  npx monomind hooks post-command -c "npm test" --success true --duration 4200
```

**post-task** - Record task completion for learning
```bash
npx monomind hooks post-task [options]

Options:
  -i, --task-id <id>        Task identifier (required)
  -s, --success             Whether the task succeeded
  -d, --duration <ms>       Task duration in milliseconds
  -o, --outcome <text>      Outcome description
  -r, --route-id <id>       Route ID from a prior `hooks route` call (joins recommendation to outcome)

Examples:
  npx monomind hooks post-task --task-id "auth-implementation" --success true
  npx monomind hooks post-task -i "bug-fix-123" -s false -o "flaky test, needs follow-up"
```

#### Session Hooks

**session-restore** - Restore a previous session
```bash
npx monomind hooks session-restore [options]

Options:
  -i, --session-id <id>     Session to restore ("latest" for most recent; default: latest)
  -a, --restore-agents      Restore spawned agents (default: true)
  -t, --restore-tasks       Restore active tasks (default: true)

Examples:
  npx monomind hooks session-restore
  npx monomind hooks session-restore --session-id "feature-auth"
```

`session-start` still exists but is deprecated in favor of `session-restore`.

**session-end** - End current session and persist state
```bash
npx monomind hooks session-end [options]

Options:
  -s, --save-state          Save session state for later restoration (default: true)
```

For named checkpoints, use the `session` command group: `npx monomind session save --name "feature-auth"`, `npx monomind session list`, `npx monomind session restore <id>`.

**notify** - Send a notification message (logged to the session)
```bash
npx monomind hooks notify --message <msg>

Options:
  -m, --message <text>      Notification message (required)
  -l, --level <level>       info | warn | error (default: info)
  -c, --channel <name>      Only "console" is implemented (default: console)

Examples:
  npx monomind hooks notify -m "Task completed" --level info
```

#### Routing and Learning

```bash
# Route a task to the best agent (top 3 suggestions by default)
npx monomind hooks route --task "Fix authentication bug" --top-k 3

# Explain a routing decision
npx monomind hooks explain --task "Fix authentication bug" --verbose

# Route to a Claude model (haiku/sonnet/opus) by complexity
npx monomind hooks model-route --task "Rename a variable" --prefer-cost
npx monomind hooks model-stats

# Route based on test coverage gaps
npx monomind hooks coverage-gaps --critical-only

# Consolidate hook activity into JSON state (no model is trained)
npx monomind hooks pretrain --depth shallow

# Pattern store: ingest history, list/search patterns
npx monomind hooks intelligence train
npx monomind hooks intelligence patterns --query "auth" --limit 5
npx monomind hooks intelligence status

# Copy learned patterns from another local project
npx monomind hooks transfer from-project --source ../other-project

# Metrics dashboard
npx monomind hooks metrics --period 7d
npx monomind hooks metrics --v1-dashboard
```

#### Background Workers and Utilities

```bash
npx monomind hooks list                 # registered hooks
npx monomind hooks worker list          # available background workers
npx monomind hooks worker run --name <worker>
npx monomind hooks statusline --compact
```

### Configuration

#### Generated Configuration

`npx monomind init hooks` writes the recommended configuration. Each entry runs the installed helper, which reads Claude Code's hook input JSON from stdin:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "node \"$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs\" pre-bash",
          "timeout": 5
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{
          "type": "command",
          "command": "node \"$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs\" post-edit",
          "timeout": 10
        }]
      }
    ]
  }
}
```

(The generated commands also walk up the directory tree to find `.claude/helpers`; the version above is simplified.)

#### Calling the CLI Directly

Claude Code passes hook input as JSON on stdin (for example `tool_input.file_path`, `tool_input.command`). To call `monomind hooks` subcommands directly, extract the fields with `jq`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{
          "type": "command",
          "command": "sh -c 'f=$(jq -r .tool_input.file_path); npx monomind hooks pre-edit --file \"$f\"'",
          "timeout": 10
        }]
      },
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "sh -c 'c=$(jq -r .tool_input.command); npx monomind hooks pre-command --command \"$c\"'",
          "timeout": 10
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{
          "type": "command",
          "command": "sh -c 'f=$(jq -r .tool_input.file_path); npx monomind hooks post-edit --file \"$f\" --success true'",
          "timeout": 10
        }]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [{
          "type": "command",
          "command": "npx monomind hooks session-end"
        }]
      }
    ]
  }
}
```

`npx` startup adds latency to every tool call; the helper-based configuration is faster.

#### Enforcement Gates

To block destructive commands and secret leaks, wire the guidance gates into the same hooks:

```bash
npx monomind guidance setup
```

#### Automatic Testing

Run tests after file modifications (plain shell, no monomind command needed):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [{
          "type": "command",
          "command": "sh -c 'f=$(jq -r .tool_input.file_path); t=\"${f%.js}.test.js\"; [ -f \"$t\" ] && npm test -- \"$t\" || true'"
        }]
      }
    ]
  }
}
```

### MCP Tool Equivalents

The core hooks are also exposed as MCP tools, so agents can call them without a shell: `mcp__monomind__hooks_pre-task`, `mcp__monomind__hooks_post-task`, `mcp__monomind__hooks_pre-edit`, `mcp__monomind__hooks_post-edit`, `mcp__monomind__hooks_pre-command`, `mcp__monomind__hooks_post-command`, `mcp__monomind__hooks_route`, `mcp__monomind__hooks_explain`.

To share context between agents, store it explicitly in memory:

```bash
npx monomind memory store --key "swarm/backend/auth-api" --value "JWT, refresh via /auth/refresh" --namespace coordination
npx monomind memory search --query "auth api" --namespace coordination
```

### Git Integration

#### Pre-Commit Hook
```bash
#!/bin/bash
# .git/hooks/pre-commit (or via husky)

# Risk assessment of the working-tree change against HEAD (informational)
npx monomind analyze diff --risk --classify

# Run tests
npm test || exit 1
```

#### Post-Commit Hook
```bash
#!/bin/bash
# .git/hooks/post-commit
COMMIT_MSG=$(git log -1 --pretty=%s)
npx monomind hooks notify --message "Commit completed: $COMMIT_MSG" --level info
```

#### Pre-Push Hook
```bash
#!/bin/bash
# .git/hooks/pre-push
npm test || exit 1
npx monomind hooks session-end
```

### Agent Coordination Workflow

```bash
# Agent 1: Backend Developer
npx monomind hooks pre-task --description "Implement user authentication API" --task-id auth-api
npx monomind hooks pre-edit --file "api/auth.js"
# ... edit via Claude Code Edit tool ...
npx monomind hooks post-edit --file "api/auth.js" --success true
npx monomind memory store --key "swarm/backend/auth-api" --value "endpoints: /login, /refresh" --namespace coordination
npx monomind hooks post-task --task-id auth-api --success true

# Agent 2: Test Engineer
npx monomind memory retrieve --key "swarm/backend/auth-api" --namespace coordination
npx monomind hooks pre-task --description "Write tests for auth API" --task-id auth-tests
npx monomind hooks post-edit --file "api/auth.test.js" --success true
npx monomind hooks post-task --task-id auth-tests --success true
```

### Real-World Examples

#### Example 1: Full-Stack Feature

```bash
npx monomind hooks session-restore
npx monomind hooks route --task "Build user profile feature - frontend + backend + tests"
npx monomind hooks pre-task --description "Build user profile feature" --task-id profile

npx monomind hooks pre-edit --file "api/profile.js"
# ... implement backend ...
npx monomind hooks post-edit --file "api/profile.js" --success true

npx monomind hooks pre-edit --file "components/Profile.jsx"
# ... implement frontend ...
npx monomind hooks post-edit --file "components/Profile.jsx" --success true

npx monomind hooks post-task --task-id profile --success true
npx monomind hooks session-end
```

#### Example 2: Debugging

```bash
npx monomind hooks pre-task --description "Debug memory leak in event handlers" --task-id leak
npx monomind hooks pre-edit --file "services/events.js" --operation update -c "remove listener leak"
# ... fix code ...
npx monomind hooks post-edit --file "services/events.js" --success true -o "listeners removed on dispose"
npx monomind hooks post-command --command "npm test" --success true
npx monomind hooks post-task --task-id leak --success true
```

### Debugging Hooks

```bash
# Verbose output
npx monomind hooks pre-edit --file "test.js" --verbose

# Registered hooks and learning state
npx monomind hooks list
npx monomind hooks metrics

# Overall health, including hook configuration
npx monomind doctor
```

`MONOMIND_HOOK_QUIET=1` (set in `.claude/settings.json` `env`) silences hook output in Claude Code.

### Best Practices

1. **Initialize early** - run `monomind init hooks` when setting up a project
2. **Keep hooks lightweight** - prefer the helper over `npx` in hot paths; set `timeout`
3. **Record outcomes** - `post-edit`, `post-command`, and `post-task` feed routing
4. **Join routes to outcomes** - pass `--route-id` from `hooks route` to `hooks post-task`
5. **Use clear memory namespaces** - e.g. `coordination`, `swarm/<role>/<topic>`
6. **Review metrics** - `hooks metrics` and `hooks model-stats`

### Troubleshooting

#### Hooks Not Executing
- Verify `.claude/settings.json` syntax and matcher patterns
- Check that `.claude/helpers/hook-handler.cjs` exists (`monomind init hooks` / `monomind init upgrade`)
- Ensure `monomind` is resolvable via `npx`
- Run `npx monomind doctor`

#### Hook Timeouts
- Increase `timeout` for the hook entry
- Use the helper instead of `npx` for frequent events

### Related Commands

- `npx monomind init hooks` - Initialize hooks configuration
- `npx monomind hooks list` - List registered hooks
- `npx monomind hooks <sub> --help` - Flags for a specific hook
- `npx monomind memory store|search|retrieve` - Shared memory
- `npx monomind session save|list|restore` - Session checkpoints
- `npx monomind agent spawn -t <type>` - Spawn agents
- `npx monomind monoswarm init` - Initialize a monoswarm

### Integration with Other Skills

- **Pair Programming** - record outcomes during pairing sessions
- **Verification Quality** - quality gates alongside hooks
- **GitHub Toolkit** - Git and PR workflows
- **Performance Analysis** - metrics collection
