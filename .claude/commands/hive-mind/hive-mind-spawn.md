---
name: hive-mind:hive-mind-spawn
---

# hive-mind spawn

Spawn worker agents into the hive, or launch Claude Code as the Queen coordinator.

## Usage
```bash
npx monomind hive-mind spawn [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--count` | `-n` | number | `1` | Number of workers to spawn |
| `--role` | `-r` | string | `worker` | Worker role: `worker`, `specialist`, `scout` |
| `--type` | `-t` | string | `worker` | Agent type (matches agent registry types) |
| `--prefix` | `-p` | string | `hive-worker` | Prefix for generated worker IDs |
| `--claude` | — | boolean | `false` | Launch Claude Code as the Queen coordinator |
| `--objective` | `-o` | string | — | Objective for the hive (required with `--claude`) |
| `--dry-run` | — | boolean | `false` | Preview what would happen without launching |
| `--non-interactive` | — | boolean | `false` | Run Claude Code in non-interactive (pipe) mode |
| `--dangerously-skip-permissions` | — | boolean | `true` | Skip Claude Code permission prompts |
| `--no-auto-permissions` | — | boolean | `false` | Disable automatic permission skipping |

## Examples

```bash
# Spawn 5 default workers
npx monomind hive-mind spawn -n 5

# Spawn 3 specialists
npx monomind hive-mind spawn -n 3 -r specialist

# Spawn a coder agent with custom ID prefix
npx monomind hive-mind spawn -t coder -p my-coder

# Launch Claude Code as Queen with a specific objective
npx monomind hive-mind spawn --claude -o "Build a REST API with authentication"

# Spawn 5 workers AND launch Claude Code as Queen
npx monomind hive-mind spawn -n 5 --claude -o "Research AI coordination patterns"

# Preview what would happen without launching
npx monomind hive-mind spawn -n 3 --claude -o "Test objective" --dry-run

# Non-interactive mode (for CI/scripts)
npx monomind hive-mind spawn --claude -o "Run security audit" --non-interactive
```

## The `--claude` Flag

When `--claude` is used, the CLI:

1. Spawns the requested worker agents in the hive
2. Generates a comprehensive Hive Mind coordination prompt that includes:
   - Swarm ID, topology, consensus algorithm
   - All worker IDs and their roles
   - Full list of MCP tools available for coordination
   - The objective and execution protocol
3. Saves the prompt to `.hive-mind/sessions/hive-mind-prompt-<id>.txt`
4. Launches `claude --dangerously-skip-permissions <prompt>` so Claude acts as the Queen

The Queen Claude instance uses MCP tools (`mcp__monomind__hive-mind_*`, `mcp__monomind__coordination_orchestrate`, etc.) to coordinate all worker agents.

**Requirements:**
- `--objective` / `-o` must be set (the Queen needs a goal)
- Claude Code CLI must be installed: `npm install -g @anthropic-ai/claude-code`

## MCP Tool

```javascript
mcp__monomind__hive-mind_spawn({
  count: 5,
  role: "worker",
  type: "coder",
  prefix: "hive-worker"
})
```
