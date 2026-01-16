# Monobrain V1 Complete CLI Reference

## Overview

Complete command reference for the monobrain V1 CLI including hooks, workflow execution, hive-mind coordination, process management, and all subcommands with SONA/MoE/HNSW integration.

## Table of Contents

- [Hooks (Self-Learning)](#hooks-self-learning)
- [Intelligence System](#intelligence--learning)
- [Workflow Execution](#workflow-execution)
- [Hive Mind Consensus](#hive-mind-consensus)
- [Agent Management](#agent-management)
- [Memory Management](#memory-management)
- [Process Management](#process-management)
- [Swarm Coordination](#swarm-coordination)

---

## Hooks (Self-Learning)

The V1 hooks CLI provides command-line access to the hooks system for shell scripts, automation, and direct user interaction.

## Installation

```bash
# Hooks are available through the main monobrain CLI
npm install -g @monobrain/cli

# Or via npx
npx monobrain hooks --help
```

## Commands

### File Edit Hooks

#### pre-edit

Get context and suggestions before editing a file.

```bash
npx monobrain hooks pre-edit <filePath> [options]

Options:
  --operation, -o    Edit operation type (create|modify|delete) [default: modify]
  --no-context       Skip context retrieval
  --no-suggestions   Skip agent suggestions
  --format           Output format (json|text) [default: text]

Examples:
  npx monobrain hooks pre-edit src/auth.ts
  npx monobrain hooks pre-edit src/new-file.ts --operation create
  npx monobrain hooks pre-edit src/legacy.ts --no-suggestions --format json
```

#### post-edit

Record edit outcome for learning.

```bash
npx monobrain hooks post-edit <filePath> [options]

Options:
  --success, -s      Whether edit was successful [required]
  --operation, -o    Edit operation type [default: modify]
  --outcome          Description of outcome
  --file, -f         Alias for filePath (V2 compatibility)
  --memory-key       Memory storage key (V2 compatibility)

Examples:
  npx monobrain hooks post-edit src/auth.ts --success true
  npx monobrain hooks post-edit src/auth.ts --success false --outcome "Type error on line 42"

  # V2 compatibility
  npx monobrain hooks post-edit --file src/auth.ts --success true --memory-key "swarm/coder/edit1"
```

---

### Command Hooks

#### pre-command

Assess risk before executing a command.

```bash
npx monobrain hooks pre-command "<command>" [options]

Options:
  --working-dir, -d  Working directory for command
  --no-risk          Skip risk assessment
  --no-suggestions   Skip safety suggestions
  --format           Output format (json|text) [default: text]

Examples:
  npx monobrain hooks pre-command "npm test"
  npx monobrain hooks pre-command "rm -rf ./dist" --working-dir /project
  npx monobrain hooks pre-command "docker compose up" --format json
```

#### post-command

Record command execution outcome.

```bash
npx monobrain hooks post-command "<command>" [options]

Options:
  --success, -s      Whether command was successful [required]
  --exit-code, -e    Command exit code [default: 0]
  --output           Command output (truncated)
  --error            Error message if failed
  --time             Execution time in milliseconds

Examples:
  npx monobrain hooks post-command "npm test" --success true --time 5230
  npx monobrain hooks post-command "npm build" --success false --exit-code 1 --error "Module not found"
```

---

### Task Lifecycle Hooks

#### pre-task

Record task start for coordination.

```bash
npx monobrain hooks pre-task [options]

Options:
  --description, -d  Task description [required]
  --task-id          Task identifier
  --agent            Assigned agent type

Examples:
  npx monobrain hooks pre-task --description "Implement OAuth2 flow"
  npx monobrain hooks pre-task -d "Fix login bug" --agent debugger --task-id task-123
```

#### post-task

Record task completion.

```bash
npx monobrain hooks post-task [options]

Options:
  --task-id          Task identifier [required]
  --success, -s      Whether task completed successfully
  --result           Task result summary
  --metrics          Include task metrics

Examples:
  npx monobrain hooks post-task --task-id task-123 --success true
  npx monobrain hooks post-task --task-id task-123 --success false --result "Blocked by dependency"
```

---

### Session Hooks

#### session-restore

Restore previous session context.

```bash
npx monobrain hooks session-restore [options]

Options:
  --session-id       Session identifier to restore [required]
  --include-memory   Restore memory state [default: true]
  --include-agents   Restore agent states [default: true]

Examples:
  npx monobrain hooks session-restore --session-id swarm-abc123
  npx monobrain hooks session-restore --session-id previous --include-memory false
```

#### session-end

End session and persist state.

```bash
npx monobrain hooks session-end [options]

Options:
  --export-metrics   Export session metrics [default: true]
  --persist-memory   Persist memory to storage [default: true]
  --summary          Generate session summary

Examples:
  npx monobrain hooks session-end
  npx monobrain hooks session-end --export-metrics true --summary
```

---

### Task Routing

#### route

Route a task to the optimal agent.

```bash
npx monobrain hooks route "<task>" [options]

Options:
  --context, -c      Additional context
  --prefer           Preferred agents (comma-separated)
  --no-explanation   Skip explanation
  --format           Output format (json|text) [default: text]

Examples:
  npx monobrain hooks route "Implement user authentication"
  npx monobrain hooks route "Fix CSS bug" --prefer "coder,reviewer"
  npx monobrain hooks route "Research API options" --context "REST vs GraphQL" --format json
```

#### explain

Explain routing decision with transparency.

```bash
npx monobrain hooks explain "<task>" [options]

Options:
  --context, -c      Additional context
  --verbose, -v      Include detailed reasoning
  --format           Output format (json|text) [default: text]

Examples:
  npx monobrain hooks explain "Implement OAuth2 authentication"
  npx monobrain hooks explain "Security audit" --verbose
```

---

### Intelligence & Learning

#### pretrain

Bootstrap intelligence from repository analysis.

```bash
npx monobrain hooks pretrain [options]

Options:
  --path, -p         Repository path [default: current directory]
  --include-git      Include git history analysis [default: true]
  --include-deps     Include dependency analysis [default: true]
  --max-patterns     Maximum patterns to extract [default: 1000]
  --force            Force retraining even if data exists

Examples:
  npx monobrain hooks pretrain
  npx monobrain hooks pretrain --path /project --max-patterns 5000
  npx monobrain hooks pretrain --force --no-include-git
```

#### build-agents

Generate optimized agent configurations from pretrain data.

```bash
npx monobrain hooks build-agents [options]

Options:
  --focus            Focus area (all|security|performance|testing) [default: all]
  --output, -o       Output configuration file
  --v1-mode          Use V1 agent definitions

Examples:
  npx monobrain hooks build-agents --focus security
  npx monobrain hooks build-agents --output agents.json
  npx monobrain hooks build-agents --v1-mode --focus performance
```

#### transfer

Transfer learned patterns from another project.

```bash
npx monobrain hooks transfer <sourceProject> [options]

Options:
  --filter           Pattern filter (glob pattern)
  --merge            Merge with existing patterns [default: true]
  --dry-run          Show what would be transferred

Examples:
  npx monobrain hooks transfer /other-project
  npx monobrain hooks transfer ../shared-project --filter "security/*"
  npx monobrain hooks transfer /template --dry-run
```

---

### Metrics & Management

#### metrics

View learning metrics dashboard.

```bash
npx monobrain hooks metrics [options]

Options:
  --category, -c     Category (all|routing|edits|commands|patterns) [default: all]
  --time-range, -t   Time range (hour|day|week|month|all) [default: all]
  --detailed         Include detailed statistics
  --format           Output format (json|text|table) [default: table]
  --v1-dashboard     Use V1 metrics dashboard

Examples:
  npx monobrain hooks metrics
  npx monobrain hooks metrics --category routing --time-range week
  npx monobrain hooks metrics --detailed --format json
  npx monobrain hooks metrics --v1-dashboard
```

#### list

List registered hooks.

```bash
npx monobrain hooks list [options]

Options:
  --category, -c     Filter by category
  --include-disabled Show disabled hooks
  --no-metadata      Hide hook metadata
  --format           Output format (json|text|table) [default: table]

Examples:
  npx monobrain hooks list
  npx monobrain hooks list --category routing
  npx monobrain hooks list --include-disabled --format json
```

---

### Notifications

#### notify

Send notification message (V2 compatibility).

```bash
npx monobrain hooks notify [options]

Options:
  --message, -m      Notification message [required]
  --level            Severity level (info|warn|error) [default: info]
  --channel          Notification channel

Examples:
  npx monobrain hooks notify --message "Task completed successfully"
  npx monobrain hooks notify -m "Build failed" --level error
```

---

## Environment Variables

```bash
# Hook execution timeout (milliseconds)
MONOBRAIN_HOOK_TIMEOUT=5000

# Enable/disable ReasoningBank integration
MONOBRAIN_REASONINGBANK_ENABLED=true

# Learning namespace
MONOBRAIN_HOOKS_NAMESPACE=hooks-learning

# Logging level
MONOBRAIN_HOOKS_LOG_LEVEL=info
```

## V2 Compatibility

All V2 hook commands are supported for backward compatibility:

```bash
# V2 syntax (still works)
npx monobrain hooks pre-task --description "[task]"
npx monobrain hooks session-restore --session-id "swarm-[id]"
npx monobrain hooks post-edit --file "[file]" --memory-key "swarm/[agent]/[step]"
npx monobrain hooks notify --message "[what was done]"
npx monobrain hooks post-task --task-id "[task]"
npx monobrain hooks session-end --export-metrics true
```

## Exit Codes

| Code | Meaning                 |
| ---- | ----------------------- |
| 0    | Success                 |
| 1    | General error           |
| 2    | Invalid arguments       |
| 3    | Hook execution failed   |
| 4    | Timeout exceeded        |
| 5    | Risk assessment blocked |

## Output Examples

### Text Format (Default)

```
$ npx monobrain hooks route "Implement authentication"

Task Routing Result
==================
Task: Implement authentication
Recommended Agent: security-auditor
Confidence: 92%

Explanation:
Based on task analysis and 15 similar historical tasks,
'security-auditor' is recommended with 92% confidence.

Alternative Agents:
  - coder (78%)
  - backend-dev (75%)
```

### JSON Format

```bash
$ npx monobrain hooks route "Implement authentication" --format json
```

```json
{
  "task": "Implement authentication",
  "recommendedAgent": "security-auditor",
  "confidence": 0.92,
  "alternativeAgents": [
    { "agent": "coder", "confidence": 0.78 },
    { "agent": "backend-dev", "confidence": 0.75 }
  ],
  "explanation": "Based on task analysis..."
}
```

### Table Format

```
$ npx monobrain hooks metrics --format table

Hooks Learning Metrics
======================
Category    Total    Success Rate    Patterns
─────────────────────────────────────────────
routing      423        84%           156
edits        756        93%            89
commands     368        82%            34
─────────────────────────────────────────────
Total       1547        89%           279
```

---

## Intelligence Command

The `hooks intelligence` command provides RuVector intelligence with SONA, MoE, and HNSW integration.

```bash
npx monobrain hooks intelligence [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--mode` | string | `balanced` | Operation mode |
| `--enable-sona` | boolean | `true` | Enable SONA sub-0.05ms learning |
| `--enable-moe` | boolean | `true` | Enable Mixture of Experts routing |
| `--enable-hnsw` | boolean | `true` | Enable HNSW 150x faster search |
| `--embedding-provider` | string | `transformers` | Embedding provider |
| `--train` | boolean | `false` | Train from current context |
| `--reset` | boolean | `false` | Reset to defaults |
| `--status` | boolean | `false` | Show detailed status |

**Modes:**

- `real-time` - Prioritize speed (<0.05ms learning)
- `batch` - Optimized for bulk processing
- `edge` - Minimal memory footprint
- `research` - Maximum accuracy
- `balanced` - Balance speed/accuracy (default)

**Intelligence Components:**

### SONA (Sub-0.05ms Learning)

- Learning Time: <0.05ms per pattern
- Adaptation Time: <0.1ms
- Memory Efficiency: 50-75% reduction via quantization
- Pattern Persistence: Cross-session learning

### MoE (Mixture of Experts)

- 8 Expert Models: Specialized for different task types
- Dynamic Routing: 92%+ routing accuracy
- Load Balancing: Automatic expert distribution
- Gating Network: Context-aware expert selection

### HNSW (150x Faster Search)

- Search Speedup: 150x-12,500x improvement
- Index Efficiency: Logarithmic complexity
- Memory Optimized: Quantized vectors (4/8/16-bit)
- Batch Support: Efficient bulk operations

**Embedding Providers:**
| Provider | Model | Dimension | Speed |
|----------|-------|-----------|-------|
| Transformers.js | all-MiniLM-L6-v2 | 384 | Fast |
| OpenAI | text-embedding-3-small | 1536 | Medium |
| Mock | - | 384 | Instant |

**Example Output:**

```
🧠 RuVector Intelligence System

Mode: balanced
Components:
  SONA:  ✅ enabled (learning: 0.03ms, adaptation: 0.08ms)
  MoE:   ✅ enabled (8 experts, 94% routing accuracy)
  HNSW:  ✅ enabled (index: 1.2M vectors, 287x speedup)

Embedding Provider: transformers
  Model: Xenova/all-MiniLM-L6-v2
  Dimension: 384
  Cache Hit Rate: 87%
```

---

## Workflow Execution

Workflow templates and execution management.

### `workflow run`

Execute a workflow by name or file.

```bash
npx monobrain workflow run <name|file> [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--input` | string | - | Input data (JSON string or file path) |
| `--parallel` | number | `4` | Maximum parallel steps |
| `--dry-run` | boolean | `false` | Show execution plan without running |
| `--timeout` | number | `3600000` | Workflow timeout in ms |
| `--on-error` | string | `stop` | Error handling (stop, continue, retry) |

**Example:**

```bash
npx monobrain workflow run development --input '{"feature": "auth"}' --parallel 6
```

### `workflow validate`

Validate a workflow definition.

```bash
npx monobrain workflow validate <file> [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--strict` | boolean | `false` | Enable strict validation |
| `--fix` | boolean | `false` | Auto-fix common issues |

### `workflow list`

List available workflows.

```bash
npx monobrain workflow list [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--format` | string | `table` | Output format (table, json, yaml) |
| `--category` | string | - | Filter by category |

### `workflow status`

Show status of running workflows.

```bash
npx monobrain workflow status [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--id` | string | - | Workflow ID |
| `--watch` | boolean | `false` | Watch mode with live updates |

### `workflow stop`

Stop a running workflow.

```bash
npx monobrain workflow stop [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--id` | string | - | Workflow ID to stop |
| `--all` | boolean | `false` | Stop all running workflows |
| `--force` | boolean | `false` | Force immediate termination |

### `workflow template`

Manage workflow templates.

```bash
# List templates
npx monobrain workflow template list

# Show template details
npx monobrain workflow template show <name>

# Create new template
npx monobrain workflow template create --name <name> --output <file>
```

**Built-in Templates:**
| Template | Description | Steps |
|----------|-------------|-------|
| `development` | Full development cycle | 4 |
| `research` | Research and analysis | 3 |
| `testing` | Comprehensive testing | 3 |
| `security-audit` | Security scanning | 4 |
| `code-review` | Code review workflow | 3 |
| `refactoring` | Refactoring workflow | 4 |
| `sparc` | SPARC methodology | 5 |

---

## Hive Mind Consensus

Queen-led consensus-based multi-agent coordination.

### `hive-mind init`

Initialize a new hive-mind swarm.

```bash
npx monobrain hive-mind init [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--topology` | string | `hierarchical` | Swarm topology |
| `--consensus` | string | `byzantine` | Consensus strategy |
| `--queen-model` | string | `opus` | Queen agent model |
| `--workers` | number | `5` | Initial worker count |
| `--memory-backend` | string | `agentdb` | Memory backend |

**Topologies:**

- `hierarchical` - Queen controls all workers
- `mesh` - Peer-to-peer coordination
- `hierarchical-mesh` - Queen + peer groups
- `adaptive` - Dynamic topology

**Consensus Strategies:**

- `byzantine` - BFT (3f+1 fault tolerance)
- `raft` - Leader election
- `gossip` - Epidemic protocol
- `crdt` - Conflict-free replicated data
- `quorum` - Majority voting

**Example:**

```bash
npx monobrain hive-mind init --topology hierarchical-mesh --consensus byzantine --workers 15
```

### `hive-mind spawn`

Spawn new worker agents.

```bash
npx monobrain hive-mind spawn [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--type` | string | `worker` | Agent type (queen, worker, specialist, drone) |
| `--role` | string | - | Specialized role |
| `--count` | number | `1` | Number to spawn |
| `--model` | string | `sonnet` | Model for agent |

**Roles:** `coder`, `researcher`, `reviewer`, `tester`, `architect`, `security`

### `hive-mind status`

Show hive status and metrics.

```bash
npx monobrain hive-mind status [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--detailed` | boolean | `false` | Show detailed metrics |
| `--watch` | boolean | `false` | Watch mode |

### `hive-mind task`

Submit tasks to the hive.

```bash
npx monobrain hive-mind task [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--description` | string | - | Task description (required) |
| `--priority` | string | `normal` | Priority (low, normal, high, critical) |
| `--type` | string | `general` | Task type |
| `--deadline` | string | - | Deadline |
| `--consensus-required` | boolean | `false` | Require consensus |

### `hive-mind optimize-memory`

Optimize hive collective memory.

```bash
npx monobrain hive-mind optimize-memory [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--strategy` | string | `balanced` | Optimization strategy |
| `--target` | string | `all` | Target (queen, workers, shared, all) |

### `hive-mind shutdown`

Gracefully shutdown the hive.

```bash
npx monobrain hive-mind shutdown [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--force` | boolean | `false` | Force immediate shutdown |
| `--save-state` | boolean | `true` | Save hive state |
| `--timeout` | number | `30000` | Shutdown timeout in ms |

---

## Agent Management

### `agent spawn`

Spawn a new agent.

```bash
npx monobrain agent spawn [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--type` | string | `coder` | Agent type |
| `--name` | string | - | Agent name |
| `--model` | string | `sonnet` | Model (opus, sonnet, haiku) |
| `--task` | string | - | Initial task |
| `--tools` | string | - | Allowed tools (comma-separated) |
| `--timeout` | number | `300000` | Task timeout in ms |

### `agent list`

List active agents.

```bash
npx monobrain agent list [options]
```

### `agent pool`

Manage agent pool.

```bash
npx monobrain agent pool [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--size` | number | - | Set pool size |
| `--min` | number | `1` | Minimum agents |
| `--max` | number | `10` | Maximum agents |
| `--auto-scale` | boolean | `true` | Enable auto-scaling |

**Example Output:**

```
🏊 Agent Pool Management

Current Pool Configuration:
  Size:       5 / 10
  Min:        1
  Max:        10
  Auto-scale: enabled

Pool Statistics:
  Active:     3
  Idle:       2
  Busy Rate:  60%

Agent Distribution:
  coder:      2 (40%)
  researcher: 1 (20%)
  reviewer:   1 (20%)
  tester:     1 (20%)
```

### `agent health`

Monitor agent health.

```bash
npx monobrain agent health [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--id` | string | - | Specific agent ID |
| `--detailed` | boolean | `false` | Show detailed metrics |
| `--watch` | boolean | `false` | Watch mode |

### `agent logs`

View agent activity logs.

```bash
npx monobrain agent logs [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--id` | string | - | Agent ID (required) |
| `--tail` | number | `50` | Number of lines |
| `--level` | string | `info` | Log level filter |
| `--follow` | boolean | `false` | Follow logs |
| `--since` | string | - | Show logs since time |

---

## Memory Management

### `memory store`

Store data in memory.

```bash
npx monobrain memory store --key <key> --value <value> [options]
```

### `memory retrieve`

Retrieve data from memory.

```bash
npx monobrain memory retrieve --key <key> [options]
```

### `memory search`

Semantic vector search.

```bash
npx monobrain memory search --query "<query>" [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--limit` | number | `10` | Maximum results |
| `--threshold` | number | `0.7` | Similarity threshold |
| `--namespace` | string | - | Namespace filter |

### `memory stats`

Show memory statistics.

```bash
npx monobrain memory stats [options]
```

### `memory cleanup`

Clean up stale/expired entries.

```bash
npx monobrain memory cleanup [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--dry-run` | boolean | `false` | Preview without deleting |
| `--older-than` | string | `30d` | Age threshold |
| `--expired-only` | boolean | `false` | Only remove expired entries |
| `--low-quality` | number | - | Remove below quality score |

### `memory compress`

Compress and optimize storage.

```bash
npx monobrain memory compress [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--level` | string | `balanced` | Compression level (fast, balanced, max) |
| `--quantize` | boolean | `false` | Enable vector quantization |
| `--bits` | number | `8` | Quantization bits (4, 8, 16) |

**Example Output:**

```
🗜️ Memory Compression

Compression Settings:
  Level:     balanced
  Quantize:  enabled (8-bit)

Before:
  Total entries: 12,456
  Storage size:  156 MB
  Vector memory: 128 MB

After:
  Storage size:  89 MB (43% reduction)
  Vector memory: 32 MB (75% reduction)

Compression complete in 2.3s
```

### `memory export` / `memory import`

Backup and restore memory.

```bash
# Export memory
npx monobrain memory export --output <file> [options]

# Import memory
npx monobrain memory import --input <file> [options]
```

---

## Process Management

### `process daemon`

Manage background daemon.

```bash
npx monobrain process daemon --action <action> [options]
```

**Actions:** `start`, `stop`, `restart`, `status`

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--port` | number | `3847` | Daemon HTTP API port |
| `--pid-file` | string | `.monobrain/daemon.pid` | PID file location |
| `--log-file` | string | `.monobrain/daemon.log` | Log file location |
| `--detach` | boolean | `true` | Run detached |

### `process monitor`

Real-time process monitoring.

```bash
npx monobrain process monitor [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--interval` | number | `2` | Refresh interval (seconds) |
| `--format` | string | `dashboard` | Format (dashboard, compact, json) |
| `--components` | string | `all` | Components to monitor |
| `--watch` | boolean | `false` | Continuous monitoring |
| `--alerts` | boolean | `true` | Enable threshold alerts |

**Dashboard Example:**

```
╔══════════════════════════════════════════════════════════════╗
║            🖥️  MONOBRAIN PROCESS MONITOR                    ║
╠══════════════════════════════════════════════════════════════╣
║  SYSTEM                                                      ║
║  CPU:    [████████░░░░░░░░░░░░] 38.5%                        ║
║  Memory: [██████████████░░░░░░] 512MB/2048MB                 ║
╠══════════════════════════════════════════════════════════════╣
║  AGENTS                                                      ║
║  Active: 3   Idle: 2   Pool: 10                              ║
╠══════════════════════════════════════════════════════════════╣
║  TASKS                                                       ║
║  Running: 2   Queued: 5   Completed: 147   Failed: 3         ║
╠══════════════════════════════════════════════════════════════╣
║  MEMORY SERVICE                                              ║
║  Vectors: 12456   Index: 24MB                                ║
║  Cache Hit: 87.3%  Avg Search: 2.34ms                        ║
╚══════════════════════════════════════════════════════════════╝
```

### `process workers`

Manage background workers.

```bash
npx monobrain process workers --action <action> [options]
```

**Actions:** `list`, `spawn`, `kill`, `scale`

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--type` | string | - | Worker type (task, memory, coordinator, neural) |
| `--count` | number | `1` | Number of workers |
| `--id` | string | - | Worker ID (for kill) |

### `process signals`

Send signals to processes.

```bash
npx monobrain process signals --target <target> --signal <signal> [options]
```

**Signals:** `graceful-shutdown`, `force-kill`, `pause`, `resume`, `reload-config`

### `process logs`

View process logs.

```bash
npx monobrain process logs [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--source` | string | `all` | Log source (daemon, workers, tasks, all) |
| `--tail` | number | `50` | Lines to show |
| `--follow` | boolean | `false` | Follow output |
| `--level` | string | `info` | Log level filter |
| `--grep` | string | - | Filter pattern |

---

## Swarm Coordination

### `swarm init`

Initialize a swarm.

```bash
npx monobrain swarm init [options]
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--topology` | string | `hierarchical` | Swarm topology |
| `--size` | number | `5` | Initial size |

### `swarm spawn`

Spawn agents into swarm.

```bash
npx monobrain swarm spawn [options]
```

### `swarm status`

Show swarm status.

```bash
npx monobrain swarm status [options]
```

### `swarm task`

Submit task to swarm.

```bash
npx monobrain swarm task --description "<task>" [options]
```

---

## Environment Variables

| Variable                          | Description               | Default                  |
| --------------------------------- | ------------------------- | ------------------------ |
| `MONOBRAIN_CONFIG`                | Config file path          | `.monobrain/config.json` |
| `MONOBRAIN_LOG_LEVEL`             | Log level                 | `info`                   |
| `MONOBRAIN_MEMORY_BACKEND`        | Memory backend            | `agentdb`                |
| `MONOBRAIN_EMBEDDING_PROVIDER`    | Embedding provider        | `transformers`           |
| `MONOBRAIN_HOOK_TIMEOUT`          | Hook timeout (ms)         | `5000`                   |
| `MONOBRAIN_REASONINGBANK_ENABLED` | ReasoningBank integration | `true`                   |
| `ANTHROPIC_API_KEY`               | Anthropic API key         | -                        |
| `OPENAI_API_KEY`                  | OpenAI API key            | -                        |

---

## Performance Targets

| Component        | Target       | Description                |
| ---------------- | ------------ | -------------------------- |
| SONA Learning    | <0.05ms      | Sub-millisecond adaptation |
| HNSW Search      | 150x-12,500x | Faster than brute-force    |
| Memory Reduction | 50-75%       | Via quantization           |
| Flash Attention  | 2.49x-7.47x  | Speedup                    |
| MoE Routing      | 92%+         | Accuracy                   |

---

## See Also

- [CLAUDE.md](/CLAUDE.md) - Project configuration
- [Architecture Decision Records](/packages/implementation/architecture/) - V1 ADRs
- [agentic-flow@alpha](https://github.com/nokhodian/agentic-flow) - Core framework
