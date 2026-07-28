<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/packages/routing.png" alt="@monoes/routing" width="600" />
</p>

# @monoes/routing

[![npm version](https://img.shields.io/npm/v/@monoes/routing?style=flat-square)](https://www.npmjs.com/package/@monoes/routing)
[![license](https://img.shields.io/npm/l/@monoes/routing?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

**Semantic task-to-agent routing** — keyword pre-filter, real embedding similarity via an isolated worker process, and Haiku LLM fallback below threshold. Routes tasks like "fix the auth bug" to the right agent type.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem. **Opt-in only** — reached via `monomind route semantic`, `monomind agent --task`, or the MCP `hooks_route_semantic` tool.

## Install

```bash
npm install @monoes/routing
```

## How it works

```
Task description
       │
       ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Keyword     │ ──▶ │  Embedding   │ ──▶ │  LLM         │
│  pre-filter  │     │  similarity  │     │  fallback    │
│  (fast, <1ms)│     │  (worker)    │     │  (Haiku)     │
└─────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       ▼                    ▼                    ▼
   Route match         Cosine > 0.7        Below threshold
```

1. **Keyword pre-filter** — fast regex-based matching against route definitions
2. **Embedding similarity** — cosine similarity via an out-of-process ONNX worker (kept isolated to avoid SIGSEGVs from in-process onnxruntime)
3. **LLM fallback** — when similarity is below threshold, Haiku classifies the task

## Usage

```typescript
import { RouteLayer } from '@monoes/routing';

const router = new RouteLayer({
  routes: [
    { name: 'bugfix', utterances: ['fix bug', 'debug error', 'resolve issue'] },
    { name: 'feature', utterances: ['add feature', 'implement', 'build'] },
    { name: 'refactor', utterances: ['refactor', 'clean up', 'restructure'] },
  ],
});

await router.initialize();
const result = await router.route('there is a null pointer in auth');
// { name: 'bugfix', confidence: 0.85 }
```

## Note on `monomind route`

The bare `monomind route` CLI command does **not** use this package — it runs a lightweight keyword-only stub with fixed 0.75 confidence. This package's full embedding pipeline is used only when explicitly requested via `route semantic` or `agent --task`.

## Links

- [GitHub](https://github.com/monoes/monomind)
- [Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT
