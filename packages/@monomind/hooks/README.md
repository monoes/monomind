# @monomind/hooks

[![npm version](https://img.shields.io/npm/v/@monomind/hooks.svg?style=flat-square)](https://www.npmjs.com/package/@monomind/hooks)
[![license](https://img.shields.io/npm/l/@monomind/hooks.svg?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue?style=flat-square)](https://nodejs.org)

**A library, not a runtime dispatcher.** Provides hook type definitions, an in-memory `HookRegistry`/`HookExecutor` for defining handlers, background `WorkerManager` workers, MCP tool schemas, and ReasoningBank pattern learning for Monomind.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem.

### Architecture: this is not the live hook path

The Claude Code hooks that actually fire on every edit/command/task/session
run through the plain CJS handlers in `.claude/helpers/` (see
`.claude/helpers/hook-handler.cjs`), wired up via `settings.json`. That is
the authoritative, "live" dispatch system.

This package is bridged in as **optional enrichment** at a handful of
lifecycle events — `SessionStart`, `PreTask`, `PostTask`, `PostEdit`,
`SessionEnd`, `AgentSpawn` — when it's installed and built. `HookRegistry`
lets you define handlers the CJS layer *can* call into, but since each hook
event runs in a fresh subprocess, in-memory registrations don't survive
across events. Only the `WorkerManager`'s daemon-managed workers persist
state to disk and carry it across invocations; they run as background
daemon tasks, not as live interceptors sitting on the hook path.

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
| `PreEdit` / `PostEdit` | Before/after file modification |
| `PreCommand` / `PostCommand` | Before/after shell commands |
| `PreTask` / `PostTask` | Before/after task execution |
| `SessionStart` / `SessionEnd` | Session lifecycle |
| `AgentSpawn` / `AgentTerminate` | Agent lifecycle |
| `PreRoute` / `PostRoute` | Task routing decisions |
| `PatternLearned` | When a new pattern is stored |

## Priorities

| Priority | Value | Use case |
|----------|-------|----------|
| `Critical` | 1000 | Security validation |
| `High` | 100 | Pre-processing |
| `Normal` | 50 | Standard hooks |
| `Low` | 10 | Logging, metrics |
| `Background` | 1 | Async, runs last |

## Background workers

12 specialized workers for continuous analysis and automation:

| Worker | Purpose |
|--------|---------|
| `ultralearn` | Deep knowledge acquisition |
| `optimize` | Performance tuning |
| `audit` | Security scanning |
| `map` | Codebase architecture mapping |
| `deepdive` | Deep code analysis |
| `testgaps` | Test coverage analysis |
| `document` | Auto-documentation |
| `refactor` | Refactoring suggestions |
| `benchmark` | Performance benchmarking |
| `consolidate` | Memory consolidation |
| `predict` | Predictive preloading |
| `preload` | Cache warming |

## MCP tools

This package exports MCP tool *schemas* (name, description, input schema, handler) that the CLI's MCP server wires up — it does not run an MCP server itself. `hooksMCPTools` (in `src/mcp/index.ts`) currently exports 10 tools:

- `hooks/route-advanced` — AFLOW/DAGLearner/LATS-augmented routing (opt-in; the CLI's `hooks_route` is the primary routing tool)
- `hooks/statusline` — statusline data for display
- `hooks/evo-agentx` — EvoAgentX prompt optimisation (GEPA + SubGraphRegistry)
- `hooks/rlvr-outcome` — record a verifiable agent outcome for RLVR reward learning
- trace tools (`listTracesTool`, `getTraceTool`) — observability trace inspection
- checkpoint tools (`listPendingCheckpointsTool`, `approveCheckpointTool`, `rejectCheckpointTool`, `getCheckpointTool`) — human-in-the-loop interrupt checkpoints

Note: earlier stub duplicates of the CLI's real `hooks_pre-edit`, `hooks_post-edit`, `hooks_metrics`, `hooks_pre-command`, `hooks_post-command` tools were removed from this package — they returned hardcoded/fake data and were never wired into any running MCP server. Those names should not appear as tools from this package going forward; the CLI (`packages/@monomind/cli/src/mcp-tools/`) owns the real, wired versions.

## Links

- [GitHub](https://github.com/monoes/monomind)
- [Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT
