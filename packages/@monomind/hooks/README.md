# @monomind/hooks

[![npm version](https://img.shields.io/npm/v/@monomind/hooks.svg?style=flat-square)](https://www.npmjs.com/package/@monomind/hooks)
[![license](https://img.shields.io/npm/l/@monomind/hooks.svg?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue?style=flat-square)](https://nodejs.org)

**Event-driven lifecycle hooks for Monomind** — intercept edits, commands, tasks, and sessions with priority-based routing, background workers, and pattern learning.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem.

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

15 tools exposed via MCP for programmatic access: `hooks/route`, `hooks/pre-edit`, `hooks/post-edit`, `hooks/metrics`, `hooks/worker-list`, `hooks/worker-dispatch`, and more.

## Links

- [GitHub](https://github.com/monoes/monomind)
- [Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT
