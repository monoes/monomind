# @monomind/hooks

[![npm version](https://img.shields.io/npm/v/@monomind/hooks.svg?style=flat-square)](https://www.npmjs.com/package/@monomind/hooks)
[![license](https://img.shields.io/npm/l/@monomind/hooks.svg?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue?style=flat-square)](https://nodejs.org)

**A library, not a runtime dispatcher.** Provides hook type definitions, an in-memory `HookRegistry`/`HookExecutor` for defining handlers, and a `WorkerManager` with 15 background workers for Monomind.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem.

### Architecture: this is not the live hook path

The Claude Code hooks that actually fire on every edit/command/task/session
run through the plain CJS handlers in `.claude/helpers/` (see
`.claude/helpers/hook-handler.cjs`), wired up via `settings.json`. That is
the authoritative, "live" dispatch system.

This package is bridged in as **optional enrichment** at a handful of
lifecycle events (`SessionStart`, `PreTask`, `PostTask`, `PostEdit`,
`SessionEnd`, `AgentSpawn`) when it's installed and built. `HookRegistry`
lets you define handlers the CJS layer *can* call into, but since each hook
event runs in a fresh subprocess, in-memory registrations don't survive
across events. What persists is the workers' output: they write JSON
metrics files under `.monomind/metrics/` that the statusline, router, and
`doctor` read back.

## Install

```bash
npm install @monomind/hooks
```

## Quick start

```typescript
import { HookRegistry, HookExecutor, HookEvent, HookPriority } from '@monomind/hooks';

const registry = new HookRegistry();
const executor = new HookExecutor(registry);

// Register a hook
registry.register(
  HookEvent.PreEdit,
  async (context) => {
    console.log(`Editing: ${context.file?.path}`);
    return { success: true };
  },
  HookPriority.Normal,
  { name: 'log-edits' }
);

// Execute
const result = await executor.preEdit('src/app.ts', 'modify');
```

## Hook events

| Event | When it fires |
|-------|---------------|
| `PreToolUse` / `PostToolUse` | Before/after any tool call |
| `PreEdit` / `PostEdit` | Before/after file modification |
| `PreRead` / `PostRead` | Before/after file reads |
| `PreCommand` / `PostCommand` | Before/after shell commands |
| `PreTask` / `PostTask` / `TaskProgress` | Task lifecycle |
| `SessionStart` / `SessionEnd` / `SessionRestore` | Session lifecycle |
| `AgentSpawn` / `AgentTerminate` | Agent lifecycle |
| `PreRoute` / `PostRoute` | Task routing decisions |
| `PatternLearned` / `PatternConsolidated` | Pattern learning |

## Priorities

| Priority | Value | Use case |
|----------|-------|----------|
| `Critical` | 1000 | Security validation |
| `High` | 100 | Pre-processing |
| `Normal` | 50 | Standard hooks |
| `Low` | 10 | Logging, metrics |
| `Background` | 1 | Async, runs last |

## Background workers

15 workers, each a factory function (`createHealthWorker(projectRoot)` → handler)
managed by `WorkerManager`:

| Worker | Purpose |
|--------|---------|
| `performance` | Benchmark search, memory, startup performance |
| `health` | Monitor disk, memory, CPU, processes |
| `swarm` | Monitor swarm activity and agent coordination |
| `git` | Track uncommitted changes, branch status |
| `learning` | Learning/pattern optimization |
| `adr` | ADR compliance checks |
| `ddd` | DDD progress → `.monomind/metrics/ddd-progress.json` |
| `security` | Scan for secrets and vulnerabilities |
| `patterns` | Consolidate, dedupe learned patterns |
| `cache` | Clean temp files, old logs, stale cache |
| `progress` | Track implementation progress |
| `map` | Codebase map → `.monomind/metrics/codebase-map.json` |
| `audit` | Security audit → `.monomind/metrics/security-audit.json` |
| `optimize` | Performance snapshot → `.monomind/metrics/performance.json` |
| `consolidate` | Memory consolidation → `.monomind/metrics/consolidation.json` |

The metrics-producing workers run at session start (via the CJS session
handler) and are staleness-gated: each only runs when its output file is
missing or older than 6 hours, with a hard per-worker timeout so session
start is never blocked. `WorkerManager` can also schedule them on intervals,
persist run state to `.monomind/metrics/workers-state.json`, raise threshold
alerts, and export statusline data.

```typescript
import { WorkerManager, createHealthWorker } from '@monomind/hooks';

const manager = new WorkerManager(process.cwd());
manager.register('health', createHealthWorker(process.cwd()));
const result = await manager.runWorker('health');
```

## What this package does NOT do

Earlier versions carried MCP tool schemas, agent synthesis, observability
traces, interrupt checkpoints, statusline generation, and swarm messaging
subsystems. None of it was wired into a running server, so it was deleted.
The CLI (`packages/@monomind/cli/src/mcp-tools/`) owns the real MCP tools;
this package is just types + registry/executor + workers.

## Links

- [GitHub](https://github.com/monoes/monomind)
- [Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT
