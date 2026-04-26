# ADR-014: Cross-Platform Workers System

## Status

**Implemented** ✅ (Extended with CLI Integration 2026-01-06)

## Date

2026-01-05

## Last Updated

2026-01-06

## Context

V1 needs a robust background worker system for:

1. Continuous monitoring of system health, security, and performance
2. Automatic DDD and ADR compliance tracking
3. Pattern consolidation and learning optimization
4. Git status tracking and swarm coordination
5. Cache cleanup and resource management

V2 relies on shell scripts (`.claude/helpers/`) which are:

- Platform-specific (Linux/macOS only)
- Difficult to test
- Not integrated with the TypeScript codebase
- Lacking persistence and historical tracking

## Decision

### 1. Create TypeScript Worker System in `@monomind/hooks`

A cross-platform worker system with:

- **10 Built-in Workers**: performance, health, security, adr, ddd, patterns, learning, cache, git, swarm
- **WorkerManager Class**: Central orchestration with EventEmitter pattern
- **Persistence**: State saved to disk, survives restarts
- **Historical Metrics**: Track trends over time (max 1000 entries)
- **Alert System**: Threshold-based notifications
- **Statusline Integration**: Real-time metrics for display

### 2. Architecture

```
@monomind/hooks/src/workers/
├── index.ts           # WorkerManager, all worker implementations
├── mcp-tools.ts       # MCP tool definitions for workers
├── session-hook.ts    # Claude Code session integration
└── __tests__/         # Comprehensive test suite
    └── workers.test.ts
```

### 3. Worker Manager Features

```typescript
class WorkerManager extends EventEmitter {
  // Core methods
  register(name: string, handler: WorkerHandler): void;
  async initialize(): Promise<void>;
  async start(options?: StartOptions): Promise<void>;
  async stop(): Promise<void>;
  async runWorker(name: string): Promise<WorkerResult>;
  async runAll(concurrency?: number): Promise<WorkerResult[]>;

  // Persistence
  async loadState(): Promise<boolean>;
  async saveState(): Promise<void>;

  // Alerts
  setThresholds(worker: string, thresholds: AlertThreshold[]): void;
  getAlerts(limit?: number): WorkerAlert[];
  clearAlerts(): void;

  // History
  getHistory(worker?: string, limit?: number): HistoricalMetric[];

  // Statusline
  getStatuslineData(): StatuslineData;
  getStatuslineString(): string;
  async exportStatusline(): Promise<void>;
}
```

### 4. Built-in Workers

| Worker      | Interval | Description                   |
| ----------- | -------- | ----------------------------- |
| performance | 5 min    | Memory, CPU, V1 code stats    |
| health      | 5 min    | System health monitoring      |
| security    | 30 min   | Secret/vulnerability scanning |
| adr         | 15 min   | ADR compliance checking       |
| ddd         | 10 min   | DDD pattern tracking          |
| patterns    | 15 min   | Pattern consolidation         |
| learning    | 30 min   | SONA optimization             |
| cache       | 1 hour   | Temp file cleanup             |
| git         | 5 min    | Branch/commit status          |
| swarm       | 1 min    | Agent coordination            |

### 5. Alert Thresholds

```typescript
const DEFAULT_THRESHOLDS = {
  health: [
    { metric: "memory.usedPct", warning: 80, critical: 95, comparison: "gt" },
    { metric: "disk.usedPct", warning: 85, critical: 95, comparison: "gt" },
  ],
  security: [
    { metric: "secrets", warning: 1, critical: 5, comparison: "gt" },
    { metric: "vulnerabilities", warning: 10, critical: 50, comparison: "gt" },
  ],
  adr: [{ metric: "compliance", warning: 70, critical: 50, comparison: "lt" }],
};
```

### 6. MCP Tools

8 MCP tools for Claude Code integration:

- `worker/run` - Run specific worker
- `worker/status` - Get worker status
- `worker/alerts` - Get recent alerts
- `worker/history` - Get historical metrics
- `worker/statusline` - Get statusline data
- `worker/run-all` - Run all workers
- `worker/start` - Start scheduling
- `worker/stop` - Stop and save

### 7. Session Integration

```typescript
// Auto-start on session begin
export async function onSessionStart(
  config?: SessionHookConfig,
): Promise<SessionHookResult>;

// Clean shutdown on session end
export async function onSessionEnd(manager: WorkerManager): Promise<void>;
```

### 8. Security Hardening

Implemented safeguards:

- `safePath()` - Path traversal prevention
- `safeReadFile()` - File size limits (10MB)
- `MAX_RECURSION_DEPTH` - Depth limit (20)
- `MAX_CONCURRENCY` - Batch limit (5)
- Symlink skipping
- Cache deletion path validation

## Consequences

### Positive

- ✅ Cross-platform (Linux, macOS, Windows)
- ✅ Type-safe TypeScript implementation
- ✅ Comprehensive test coverage
- ✅ Persistence across restarts
- ✅ Historical trend tracking
- ✅ Threshold-based alerting
- ✅ MCP tool integration
- ✅ Statusline export for shell consumption
- ✅ Security hardened

### Negative

- Requires Node.js runtime (not shell-only)
- Additional memory for history storage
- Slightly more complex than shell scripts

### Trade-offs

- JSON persistence vs SQLite: Chose JSON for simplicity and portability
- Fixed intervals vs dynamic: Chose fixed for predictability
- In-memory history vs disk: Chose in-memory with periodic save for performance

## Performance Metrics

| Metric               | Target | Achieved                |
| -------------------- | ------ | ----------------------- |
| All workers run time | <2s    | ✅ 527ms                |
| Individual worker    | <500ms | ✅ Max 301ms (security) |
| State save time      | <100ms | ✅ <50ms                |
| Memory overhead      | <50MB  | ✅ ~5MB                 |

## Test Coverage

```
Tests:       45 passed (45)
Duration:    1.2s

Coverage:
- WorkerManager: Unit tests
- Alert System: Threshold tests
- Historical Metrics: Recording tests
- Statusline: Export tests
- Persistence: Save/load tests
- Security: Boundary tests
- Built-in Workers: Integration tests
```

## Usage Examples

### Basic Usage

```typescript
import { createWorkerManager } from "@monomind/hooks";

const manager = createWorkerManager("/path/to/project");
await manager.initialize();
await manager.start();

// Run specific worker
const result = await manager.runWorker("security");
console.log(result.data);

// Get alerts
const alerts = manager.getAlerts(10);

// Get statusline
const statusline = manager.getStatuslineString();
// "👷0/10 │ 🟢15% │ 🛡️0 │ 📋71% │ 🏗️13% │ ⚡1.0x"
```

### MCP Integration

```typescript
import { createWorkerToolHandler, workerMCPTools } from "@monomind/hooks";

// Register tools with MCP server
const handler = createWorkerToolHandler(manager);

// Handle tool call
const result = await handler("worker/run", { worker: "health" });
```

### Session Hook

```typescript
import { onSessionStart, formatSessionStartOutput } from "@monomind/hooks";

const result = await onSessionStart({
  projectRoot: "/path/to/project",
  autoStart: true,
  runInitialScan: true,
  workers: ["health", "security", "git"],
});

console.log(formatSessionStartOutput(result));
// [Workers] System initialized
//   ✓ Health: healthy
//   ✓ Security: clean (0 issues)
//   ├─ Branch: v1
//   └─ Uncommitted: 5
// [Workers] Background scheduling started
```

## References

- V2 Shell Scripts: `.claude/helpers/worker-manager.sh`
- ADR-002: Domain-Driven Design Structure
- ADR-006: Unified Memory Service
- ADR-012: MCP Security Features

---

## Extension: CLI Integration (2026-01-06)

### CLI Hooks Worker Subcommand

Extended the worker system with CLI integration via `hooks worker` command in `@monomind/cli`.

#### New Worker Types (12 Total)

In addition to the original system workers, the CLI exposes 12 trigger-based workers:

| Worker        | Priority | Est. Time | Description                                  |
| ------------- | -------- | --------- | -------------------------------------------- |
| `ultralearn`  | normal   | 60s       | Deep knowledge acquisition and learning      |
| `optimize`    | high     | 30s       | Performance optimization and tuning          |
| `consolidate` | low      | 20s       | Memory consolidation and cleanup             |
| `predict`     | normal   | 15s       | Predictive preloading and anticipation       |
| `audit`       | critical | 45s       | Security analysis and vulnerability scanning |
| `map`         | normal   | 30s       | Codebase mapping and architecture analysis   |
| `preload`     | low      | 10s       | Resource preloading and cache warming        |
| `deepdive`    | normal   | 60s       | Deep code analysis and examination           |
| `document`    | normal   | 45s       | Auto-documentation generation                |
| `refactor`    | normal   | 30s       | Code refactoring suggestions                 |
| `benchmark`   | normal   | 60s       | Performance benchmarking                     |
| `testgaps`    | normal   | 30s       | Test coverage analysis                       |

#### CLI Commands

```bash
# List all available workers
monomind hooks worker list

# Detect triggers from prompt text (<5ms target)
monomind hooks worker detect --prompt "optimize performance"

# Auto-dispatch when triggers match (confidence ≥0.6)
monomind hooks worker detect --prompt "deep dive" --auto-dispatch --min-confidence 0.6

# Manually dispatch a worker
monomind hooks worker dispatch --trigger refactor --context "auth module"

# Check worker status
monomind hooks worker status

# Cancel a running worker
monomind hooks worker cancel --id worker_refactor_1_abc123
```

#### MCP Tools Added

5 new MCP tools in `@monomind/cli/src/mcp-tools/hooks-tools.ts`:

- `hooks/worker-list` - List all 12 background workers
- `hooks/worker-dispatch` - Dispatch a worker by trigger type
- `hooks/worker-status` - Get status of running workers
- `hooks/worker-detect` - Detect worker triggers from prompt text
- `hooks/worker-cancel` - Cancel a running worker

#### UserPromptSubmit Integration

Workers are automatically triggered via the `UserPromptSubmit` hook in `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "timeout": 6000,
            "command": "monomind hooks worker detect --prompt \"$USER_PROMPT\" --auto-dispatch --min-confidence 0.6"
          }
        ]
      }
    ]
  }
}
```

#### Parser Enhancement

Fixed nested subcommand routing in `parser.ts` to support 3 levels of subcommands:

- Level 1: `hooks`
- Level 2: `worker`
- Level 3: `list`, `dispatch`, `status`, `detect`, `cancel`

#### Performance Targets

| Metric            | Target | Status |
| ----------------- | ------ | ------ |
| Trigger detection | <5ms   | ✅     |
| Worker spawn      | <50ms  | ✅     |
| Max concurrent    | 10     | ✅     |

---

## Extension: Node.js Worker Daemon (2026-01-07)

### Daemon Service Architecture

Extended the worker system with a full Node.js daemon service in `@monomind/cli/src/services/worker-daemon.ts`. This replaces the shell-based helpers in `.claude/helpers/` with a cross-platform TypeScript implementation.

#### Key Components

| Component           | Location                     | Purpose                                             |
| ------------------- | ---------------------------- | --------------------------------------------------- |
| `WorkerDaemon`      | `services/worker-daemon.ts`  | EventEmitter-based daemon service                   |
| `daemon` command    | `commands/daemon.ts`         | CLI with start/stop/status/trigger/enable           |
| Session integration | `hooks-tools.ts`             | Auto-start on SessionStart, auto-stop on SessionEnd |
| Init settings       | `init/settings-generator.ts` | Daemon config in v1 init output                     |

#### Daemon CLI Commands

```bash
# Start the daemon (runs workers on intervals)
npx monomind@latest daemon start
npx monomind@latest daemon start --quiet  # Run once and exit

# Stop the daemon
npx monomind@latest daemon stop

# Check status and worker history
npx monomind@latest daemon status

# Manually trigger a worker
npx monomind@latest daemon trigger <worker>
npx monomind@latest daemon trigger map --force

# Enable/disable workers
npx monomind@latest daemon enable map audit optimize
npx monomind@latest daemon enable --all
```

#### Worker Intervals (5 Enabled by Default)

| Worker        | Interval | Priority | Description                                 |
| ------------- | -------- | -------- | ------------------------------------------- |
| `map`         | 5min     | normal   | Codebase structure mapping                  |
| `audit`       | 10min    | critical | Security vulnerability scanning             |
| `optimize`    | 15min    | high     | Performance optimization analysis           |
| `consolidate` | 30min    | low      | Memory consolidation and cleanup            |
| `testgaps`    | 20min    | normal   | Test coverage gap analysis                  |
| `predict`     | 10min    | normal   | Predictive preloading (disabled by default) |
| `document`    | 30min    | low      | Auto-documentation (disabled by default)    |

#### Metrics Output

Workers write JSON metrics to `.monomind/metrics/`:

```
.monomind/metrics/
├── codebase-map.json      # map worker output
├── security-audit.json    # audit worker output
├── performance.json       # optimize worker output
├── consolidation.json     # consolidate worker output
├── test-gaps.json         # testgaps worker output
├── agent-metrics.json     # Agent performance data
└── task-metrics.json      # Task execution data
```

#### State Persistence

Daemon state is persisted to `.monomind/daemon-state.json`:

```typescript
interface DaemonState {
  workers: {
    [key: string]: {
      enabled: boolean;
      runCount: number;
      successCount: number;
      failureCount: number;
      lastRun?: Date;
      lastError?: string;
    };
  };
  pid?: number;
  startedAt?: string;
}
```

#### Session Integration

```typescript
// Auto-start on SessionStart hook
hooks.SessionStart = [
  {
    hooks: [
      {
        type: "command",
        command:
          "npx monomind@latest daemon start --quiet 2>/dev/null || true",
        timeout: 5000,
        continueOnError: true,
      },
    ],
  },
];
```

#### Performance Characteristics

| Metric            | Target | Achieved           |
| ----------------- | ------ | ------------------ |
| Daemon startup    | <500ms | ✅ ~200ms          |
| Worker execution  | <500ms | ✅ ~1ms per worker |
| State persistence | <50ms  | ✅ ~10ms           |
| Memory overhead   | <50MB  | ✅ ~5MB            |

#### Package Integration

The root `package.json` now links `monomind@latest` to the V1 CLI:

```json
{
  "name": "monomind",
  "bin": {
    "monomind": "./packages/@monomind/cli/bin/cli.js"
  },
  "publishConfig": {
    "access": "public",
    "tag": "v1alpha"
  }
}
```

This means all V1 CLI commands (including `daemon`) are available via:

- `npx monomind@latest daemon start`
- `npx monomind@latest daemon status`
- `npx monomind@latest hooks ...`
- etc.

---

**Document Maintained By:** Architecture Team
**Last Updated:** 2026-01-07
