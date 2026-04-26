# Statusline & Daemon Integration

## Overview

The V1 hooks system integrates with background daemons and statusline displays to provide real-time monitoring of swarm activity, implementation progress, and security status. This document covers the integration between hooks and the daemon infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Claude Code Session                               │
├─────────────────────────────────────────────────────────────────────────┤
│  SessionStart Hook                                                       │
│  └─> .claude/helpers/daemon-manager.sh start                            │
│       ├─> swarm-monitor.sh     (process detection, 3s interval)         │
│       ├─> metrics-db.mjs       (SQLite sync, 30s interval)              │
│       └─> hooks-daemon.mjs     (learning sync, 60s interval)            │
├─────────────────────────────────────────────────────────────────────────┤
│  Hooks System Integration                                                │
│  ├─> PreToolUse Hook   → Activity detection → Metrics update            │
│  ├─> PostToolUse Hook  → Outcome recording → Pattern learning           │
│  ├─> PreCommand Hook   → Risk assessment   → Security tracking          │
│  └─> PostTask Hook     → Progress update   → Statusline refresh         │
├─────────────────────────────────────────────────────────────────────────┤
│  statusline.sh (on-demand, <200ms)                                       │
│  └─> Reads from:                                                         │
│       ├─ .monomind/metrics.db      (SQLite, primary)                 │
│       ├─ .monomind/hooks.db        (ReasoningBank patterns)          │
│       └─ .monomind/metrics/*.json  (exported, legacy compat)         │
├─────────────────────────────────────────────────────────────────────────┤
│  SessionEnd Hook                                                         │
│  └─> .claude/helpers/daemon-manager.sh stop                             │
│       └─> Final metrics export, pattern consolidation                   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Daemons

### 1. Daemon Manager (`daemon-manager.sh`)

Central control for all background processes with hooks integration.

```bash
# Start all daemons (called by SessionStart hook)
.claude/helpers/daemon-manager.sh start [swarm_interval] [metrics_interval] [hooks_interval]

# Default intervals: swarm=3s, metrics=30s, hooks=60s
.claude/helpers/daemon-manager.sh start 3 30 60

# Stop all daemons (called by SessionEnd hook)
.claude/helpers/daemon-manager.sh stop

# Restart with new configuration
.claude/helpers/daemon-manager.sh restart

# Check daemon status
.claude/helpers/daemon-manager.sh status
```

**PID Management:**
```
.monomind/pids/
├── swarm-monitor.pid      # Swarm monitoring daemon
├── metrics-daemon.pid     # Metrics collection daemon
└── hooks-daemon.pid       # Hooks learning daemon
```

**Log Files:**
```
.monomind/logs/
├── daemon.log             # Daemon manager operations
├── swarm-monitor.log      # Process detection logs
├── metrics-daemon.log     # Metrics sync logs
└── hooks-daemon.log       # Learning operation logs
```

### 2. Metrics Database Daemon (`metrics-db.mjs`)

SQLite-based metrics storage with hooks integration.

```bash
# Sync metrics from implementation
node .claude/helpers/metrics-db.mjs sync

# Export to JSON (statusline compatibility)
node .claude/helpers/metrics-db.mjs export

# Run as daemon
node .claude/helpers/metrics-db.mjs daemon [interval_seconds]

# Query specific metrics
node .claude/helpers/metrics-db.mjs query "SELECT * FROM hooks_metrics"
```

**Extended Schema for Hooks:**
```sql
-- Hooks Activity Metrics
CREATE TABLE hooks_metrics (
  id INTEGER PRIMARY KEY,
  total_executions INTEGER,
  total_failures INTEGER,
  avg_execution_time REAL,
  patterns_learned INTEGER,
  routing_confidence REAL,
  last_updated TEXT
);

-- Per-Hook Statistics
CREATE TABLE hook_stats (
  hook_name TEXT PRIMARY KEY,
  category TEXT,
  execution_count INTEGER,
  success_rate REAL,
  avg_time_ms REAL,
  last_executed TEXT
);

-- Routing History
CREATE TABLE routing_history (
  id INTEGER PRIMARY KEY,
  task_hash TEXT,
  recommended_agent TEXT,
  confidence REAL,
  was_successful INTEGER,
  timestamp TEXT
);

-- Learning Patterns
CREATE TABLE learning_patterns (
  pattern_id TEXT PRIMARY KEY,
  category TEXT,
  quality_score REAL,
  usage_count INTEGER,
  created_at TEXT,
  last_used TEXT
);
```

### 3. Swarm Monitor Daemon (`swarm-monitor.sh`)

Real-time process detection with hooks event emission.

```bash
# Single check (returns JSON)
.claude/helpers/swarm-monitor.sh check

# Continuous monitoring with hooks notification
.claude/helpers/swarm-monitor.sh monitor [interval]

# Status with hooks metrics
.claude/helpers/swarm-monitor.sh status --include-hooks
```

**Output:**
```json
{
  "timestamp": "2025-01-05T12:00:00Z",
  "swarm": {
    "agentic_flow_processes": 3,
    "mcp_server_processes": 2,
    "estimated_agents": 5,
    "active": true,
    "coordination_active": true
  },
  "hooks": {
    "daemon_running": true,
    "patterns_loaded": 156,
    "routing_enabled": true
  }
}
```

### 4. Hooks Learning Daemon (`hooks-daemon.mjs`)

Background process for ReasoningBank consolidation.

```bash
# Run consolidation cycle
node .claude/helpers/hooks-daemon.mjs consolidate

# Run as daemon
node .claude/helpers/hooks-daemon.mjs daemon [interval_seconds]

# Export patterns
node .claude/helpers/hooks-daemon.mjs export --format json
```

**Operations:**
- **Trajectory pruning**: Remove low-quality trajectories
- **Pattern consolidation**: Merge similar patterns
- **Memory optimization**: Compress old patterns
- **Index rebuilding**: Optimize HNSW index

## Statusline Integration

### Format

```
▊ Monomind V1 ● agentic-flow@alpha  │  ⎇ v1
─────────────────────────────────────────────────────
🏗️  DDD Domains    [●●●●●]  5/5    ⚡ 1.0x → 2.49x-7.47x
🤖 Swarm Agents    ◉ [ 5/15]      🟢 CVE 3/3    💾 156 patterns
🔧 Architecture    DDD ●93%  │  Security ●CLEAN  │  Hooks ●ACTIVE
📊 Routing         89% accuracy │  Avg 4.2ms │  1547 operations
─────────────────────────────────────────────────────
```

### Statusline Script

```bash
#!/bin/bash
# .claude/statusline.sh - V1 with Hooks Integration

# Read from SQLite if available
if [ -f ".monomind/metrics.db" ]; then
  METRICS=$(node -e "
    const db = require('.claude/helpers/metrics-db.mjs');
    console.log(JSON.stringify(db.getStatuslineData()));
  " 2>/dev/null)

  # Extract values
  DDD_PROGRESS=$(echo "$METRICS" | jq -r '.ddd_progress // 0')
  ACTIVE_AGENTS=$(echo "$METRICS" | jq -r '.active_agents // 0')
  CVE_STATUS=$(echo "$METRICS" | jq -r '.cve_status // "PENDING"')
  PATTERNS=$(echo "$METRICS" | jq -r '.patterns_learned // 0')
  ROUTING_ACC=$(echo "$METRICS" | jq -r '.routing_accuracy // 0')
  HOOK_STATUS=$(echo "$METRICS" | jq -r '.hooks_status // "INACTIVE"')
fi

# Format output
printf "▊ Monomind V1 ● agentic-flow@alpha  │  ⎇ v1\n"
printf "─────────────────────────────────────────────────────\n"
printf "🏗️  DDD Domains    %s  │  ⚡ Performance targets active\n" "$DDD_PROGRESS"
printf "🤖 Swarm Agents    ◉ [%2d/15]      🟢 CVE %s    💾 %d patterns\n" "$ACTIVE_AGENTS" "$CVE_STATUS" "$PATTERNS"
printf "🔧 Hooks           %s  │  Routing %d%%  │  Learning %s\n" "$HOOK_STATUS" "$ROUTING_ACC" "ACTIVE"
printf "─────────────────────────────────────────────────────\n"
```

### Performance

| Component | Target | Typical |
|-----------|--------|---------|
| statusline.sh total | <200ms | 138ms |
| SQLite query | <50ms | 12ms |
| JSON export | <100ms | 45ms |
| Hooks metrics | <20ms | 8ms |

## Hook Configuration

### Claude Settings (`~/.claude/settings.json`)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "timeout": 5000,
            "command": "/workspaces/monomind/.claude/helpers/daemon-manager.sh start 3 30 60"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "timeout": 3000,
            "command": "/workspaces/monomind/.claude/helpers/daemon-manager.sh stop"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "timeout": 100,
            "command": "node .claude/helpers/hooks-daemon.mjs notify-activity"
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "/workspaces/monomind/.claude/statusline.sh"
  }
}
```

### Project Settings (`.monomind/config.json`)

```json
{
  "daemons": {
    "enabled": true,
    "swarmMonitor": {
      "enabled": true,
      "interval": 3000
    },
    "metricsSync": {
      "enabled": true,
      "interval": 30000,
      "database": ".monomind/metrics.db"
    },
    "hooksLearning": {
      "enabled": true,
      "interval": 60000,
      "database": ".monomind/hooks.db"
    }
  },
  "statusline": {
    "enabled": true,
    "refreshOnHook": true,
    "showHooksMetrics": true,
    "showSwarmActivity": true
  }
}
```

## Event Flow

### 1. Session Start

```
SessionStart Hook Triggered
    │
    ├─> daemon-manager.sh start
    │   ├─> Start swarm-monitor.sh (every 3s)
    │   ├─> Start metrics-db.mjs daemon (every 30s)
    │   └─> Start hooks-daemon.mjs (every 60s)
    │
    ├─> Initialize ReasoningBank
    │   ├─> Load patterns from .monomind/hooks.db
    │   └─> Warm HNSW index for retrieval
    │
    └─> First statusline render
```

### 2. During Session

```
Tool Use (e.g., Edit)
    │
    ├─> PreToolUse Hook
    │   ├─> hooks-daemon.mjs notify-activity
    │   └─> Increment metrics counter
    │
    ├─> Tool Execution
    │
    └─> PostToolUse Hook
        ├─> Record outcome to ReasoningBank
        ├─> Update hooks_metrics table
        └─> (If successful) Queue pattern distillation
```

### 3. Background Sync

```
Every 30 seconds (metrics-db.mjs daemon):
    │
    ├─> Scan V1 implementation files
    │   ├─> Count files per module
    │   └─> Calculate DDD progress
    │
    ├─> Check security status
    │   └─> CVE remediation count
    │
    ├─> Export JSON for statusline
    │
    └─> Log sync completion

Every 60 seconds (hooks-daemon.mjs):
    │
    ├─> Consolidate ReasoningBank patterns
    │   ├─> Prune low-quality trajectories
    │   └─> Merge duplicate patterns
    │
    ├─> Update hook_stats table
    │
    └─> Optimize HNSW index if needed
```

### 4. Session End

```
SessionEnd Hook Triggered
    │
    ├─> daemon-manager.sh stop
    │   ├─> SIGTERM to all daemons
    │   └─> Wait for graceful shutdown
    │
    ├─> Final ReasoningBank consolidation
    │   └─> Export learned patterns
    │
    ├─> Final metrics sync
    │   └─> Export to JSON
    │
    └─> Log session summary
```

## Metrics Tracked

### Hooks Performance

| Metric | Description | Update Frequency |
|--------|-------------|------------------|
| `total_executions` | Total hook invocations | Real-time |
| `total_failures` | Failed hook executions | Real-time |
| `avg_execution_time` | Average hook time (ms) | Every 30s |
| `patterns_learned` | ReasoningBank patterns | Every 60s |
| `routing_accuracy` | Task routing success rate | Every 60s |
| `routing_confidence` | Average routing confidence | Every 60s |

### Per-Hook Statistics

| Metric | Description |
|--------|-------------|
| `hook_name` | Hook identifier |
| `category` | pre-edit, post-edit, routing, etc. |
| `execution_count` | Times executed |
| `success_rate` | Success percentage |
| `avg_time_ms` | Average execution time |
| `last_executed` | Timestamp of last execution |

### Learning Metrics

| Metric | Description |
|--------|-------------|
| `trajectories_stored` | Total trajectories in ReasoningBank |
| `patterns_distilled` | Memories extracted from trajectories |
| `consolidation_runs` | Pattern consolidation cycles |
| `index_size` | HNSW index entry count |
| `avg_retrieval_time` | Pattern retrieval latency |

## Troubleshooting

### Daemons Not Starting

```bash
# Check daemon status
.claude/helpers/daemon-manager.sh status

# View logs
tail -f .monomind/logs/daemon.log

# Check for stale PID files
ls -la .monomind/pids/

# Manual cleanup and restart
rm .monomind/pids/*.pid
.claude/helpers/daemon-manager.sh start
```

### Statusline Not Updating

```bash
# Force metrics sync
node .claude/helpers/metrics-db.mjs sync

# Check SQLite database
sqlite3 .monomind/metrics.db "SELECT * FROM hooks_metrics"

# Verify statusline script
bash -x .claude/statusline.sh
```

### ReasoningBank Issues

```bash
# Check hooks database
node .claude/helpers/hooks-daemon.mjs status

# Force consolidation
node .claude/helpers/hooks-daemon.mjs consolidate --force

# Rebuild patterns
node .claude/helpers/hooks-daemon.mjs rebuild-index
```

### High CPU from Daemons

```bash
# Increase daemon intervals
.claude/helpers/daemon-manager.sh restart 10 60 120

# Disable non-essential daemons
.claude/helpers/daemon-manager.sh start --no-hooks-daemon
```

## Files Reference

```
.claude/
├── statusline.sh                    # Main statusline script
├── settings.json                    # Claude settings with hooks
└── helpers/
    ├── daemon-manager.sh            # Daemon lifecycle
    ├── metrics-db.mjs               # Metrics SQLite engine
    ├── swarm-monitor.sh             # Process detection
    └── hooks-daemon.mjs             # Learning background process

.monomind/
├── metrics.db                       # Main metrics database
├── hooks.db                         # ReasoningBank storage
├── config.json                      # V1 configuration
├── pids/
│   ├── swarm-monitor.pid
│   ├── metrics-daemon.pid
│   └── hooks-daemon.pid
├── logs/
│   ├── daemon.log
│   ├── swarm-monitor.log
│   ├── metrics-daemon.log
│   └── hooks-daemon.log
└── metrics/
    ├── v1-progress.json             # Exported V1 metrics
    ├── swarm-activity.json          # Exported swarm status
    └── hooks-metrics.json           # Exported hooks metrics
```
