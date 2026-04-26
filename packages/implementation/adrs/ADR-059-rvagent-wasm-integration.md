# ADR-059: @ruvector/rvagent-wasm Integration

**Status**: Implemented (see ADR-070 for completion details)
**Date**: 2026-03-17
**Author**: RuvNet

## Context

Monomind v1 already integrates four `@ruvector/*` WASM packages for intelligence
(learning-wasm, attention, router, sona). A new package —
`@ruvector/rvagent-wasm@0.1.0` — provides a complete sandboxed AI agent runtime
compiled to WebAssembly. It includes:

- **WasmAgent** — LLM agent with virtual filesystem (no OS access)
- **WasmMcpServer** — JSON-RPC 2.0 MCP server running entirely in WASM
- **WasmGallery** — 6 pre-built agent templates (Coder, Researcher, Tester, Reviewer, Security, Swarm)
- **WasmRvfBuilder** — RVF binary container format for multi-agent packaging
- **WasmStateBackend** — In-memory sandboxed filesystem (1 MB/file, 10 K files max)
- **WasmToolExecutor** — Sandboxed tool execution (ReadFile, WriteFile, EditFile, WriteTodos, ListFiles)

Package size: 196.8 kB packed / 620 kB unpacked, zero runtime dependencies.

A companion package — `@ruvector/ruvllm-wasm` — provides browser-native LLM
inference with HNSW routing, MicroLoRA, SONA Instant, WebGPU acceleration, and
pi-quantization. This ADR covers both integrations.

## Decision

Integrate `@ruvector/rvagent-wasm` as an optional dependency in `@monomind/cli`,
following the established pattern used by `@ruvector/learning-wasm` et al.

### Integration Surface

| Layer | What | How |
|-------|------|-----|
| **package.json** | Optional deps | `"@ruvector/rvagent-wasm": "^0.1.0"`, `"@ruvector/ruvllm-wasm": "^2.0.1"` |
| **Ambient types** | TypeScript compat | `src/types/optional-modules.d.ts` |
| **Integration module** | `src/ruvector/agent-wasm.ts` | Agent lifecycle, VFS, gallery, RVF, MCP bridge |
| **MCP tools** | `src/mcp-tools/wasm-agent-tools.ts` | 10 tools exposed via MCP protocol |
| **Re-exports** | `src/ruvector/index.ts` | Public API surface |

### MCP Tools Added

| Tool | Description |
|------|-------------|
| `wasm_agent_create` | Create sandboxed WASM agent |
| `wasm_agent_prompt` | Send prompt to WASM agent |
| `wasm_agent_tool` | Execute tool on WASM agent |
| `wasm_agent_list` | List active WASM agents |
| `wasm_agent_terminate` | Terminate and free agent |
| `wasm_agent_files` | List files in agent's VFS |
| `wasm_agent_export` | Export agent state as JSON |
| `wasm_gallery_list` | List gallery templates |
| `wasm_gallery_search` | Search templates by query |
| `wasm_gallery_create` | Create agent from template |

### @ruvector/ruvllm-wasm v2.0.1 Integration

Package published to npm and live-tested on 2026-03-17. Ambient types declared in
`src/types/optional-modules.d.ts`. Integration module and MCP tools pending.

#### Verified Working APIs (npm v2.0.0)

| Component | API | Status |
|-----------|-----|--------|
| `RuvLLMWasm` | `initialize()`, `reset()`, `version()`, `getPoolStats()` | Working |
| `ChatTemplateWasm` | `.llama3()`, `.mistral()`, `.chatml()`, `.phi()`, `.gemma()`, `.custom()`, `.detectFromModelId()` | Working |
| `ChatMessageWasm` | `.system()`, `.user()`, `.assistant()` | Working |
| `GenerateConfig` | `maxTokens`, `temperature`, `topP`, `topK`, `repetitionPenalty`, `toJson()`, `fromJson()` | Working |
| `SonaInstantWasm` | `instantAdapt()`, `recordPattern()`, `suggestAction()`, `stats()`, `toJson()`, `fromJson()` | Working |
| `MicroLoraWasm` | `adapt()`, `applyUpdates()`, `stats()`, `reset()` (via `MicroLoraConfigWasm` + `AdaptFeedbackWasm`) | Working |
| `KvCacheWasm` | `append()`, `stats()`, `clear()`, `tokenCount` | Working |
| `BufferPoolWasm` | `withCapacity()`, `prewarmAll()`, `statsJson()`, `hitRate`, `clear()` | Working |
| `InferenceArenaWasm` | `forModel()`, `reset()`, `used`, `capacity`, `remaining` | Working |
| `HnswRouterWasm` | Constructor, `setEfSearch()`, `clear()` | Working |
| `HnswRouterWasm` | `addPattern()` | Fixed in v2.0.1 |

#### Node.js Init Pattern

```typescript
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('@ruvector/ruvllm-wasm/ruvllm_wasm_bg.wasm');
const bytes = readFileSync(wasmPath);

// MUST use object form — initSync(bytes) is deprecated
initSync({ module: bytes });
```

#### HNSW Fix Details

The `select_layer()` function in WASM called `f64::ln()` which hits `unreachable`
in WASM targets. Fix: replaced `wasm_random()` with integer-based geometric
distribution that avoids floating-point logarithms entirely. Published as v2.0.1.

#### Planned Integration Module

`src/ruvector/ruvllm-wasm.ts` will expose:
- `isRuvllmWasmAvailable()` — Runtime detection
- `initRuvllmWasm()` — Node.js WASM initialization
- `createHnswRouter()` — WASM HNSW for semantic routing
- `createSonaInstant()` — <1ms adaptation loops
- `createMicroLora()` — Ultra-lightweight LoRA (ranks 1-4)
- `formatChat()` — Chat template formatting
- `createKvCache()` — KV cache management
- Chat template helpers, generation config wrappers

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  @monomind/cli                                        │
│                                                          │
│  src/ruvector/agent-wasm.ts  ◄── Integration module      │
│    ├─ createWasmAgent()      (lifecycle)                  │
│    ├─ promptWasmAgent()      (LLM interaction)            │
│    ├─ createWasmMcpServer()  (MCP bridge)                 │
│    ├─ listGalleryTemplates() (gallery)                    │
│    └─ buildRvfContainer()    (packaging)                  │
│                                                          │
│  src/mcp-tools/wasm-agent-tools.ts ◄── MCP exposure      │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  @ruvector/rvagent-wasm (WASM, optional)                 │
│    ├─ WasmAgent          (sandboxed agent runtime)       │
│    ├─ WasmStateBackend   (in-memory VFS)                 │
│    ├─ WasmMcpServer      (JSON-RPC 2.0)                  │
│    ├─ WasmGallery        (6 templates)                   │
│    └─ WasmRvfBuilder     (binary containers)             │
└──────────────────────────────────────────────────────────┘
```

## Consequences

### Positive
- Enables sandboxed agent execution without OS access (browser-safe)
- 6 pre-built templates accelerate agent creation
- RVF container support enables agent packaging and distribution
- WASM MCP server provides lightweight alternative endpoint
- Zero additional runtime dependencies (WASM is self-contained)
- Graceful degradation when package not installed

### Negative
- 620 kB unpacked size added to optional deps
- WASM agents lack OS-level tools (no Bash, no Grep, no Glob)
- Model provider must be injected from JavaScript side

### Known Issues (v0.1.0 — filed upstream)

| Issue | Severity | Workaround |
|-------|----------|------------|
| `execute_tool(unknown)` → WASM panic | Medium | Validate tool name before calling (implemented) |
| `gallery.get(unknown)` → WASM panic | Medium | Wrap in try/catch (implemented) |
| `WasmMcpServer` → memory access out of bounds | High | Avoid MCP server in v0.1.0 |
| `reset()` does not clear `file_count` | Low | Recreate agent if clean state needed |
| `write_todos` format undocumented | Low | Tool works, format TBD |
| Template ID is `swarm-orchestrator` not `swarm` | Info | Updated in code and docs |

### Known Issues (ruvllm-wasm v2.0.1)

| Issue | Severity | Workaround |
|-------|----------|------------|
| HNSW `addPattern` panics at ~12 patterns | High | Limit to <12 or await fix |
| `SonaInstantWasm` requires `SonaConfigWasm` | Info | API change from earlier versions |
| `MicroLoraWasm.adapt()` takes `AdaptFeedbackWasm` | Info | API change; `.apply()` for transforms |
| `RuvLLMWasm` has no `.version()` | Info | Use standalone `getVersion()` |
| `GenerateConfig` float precision loss | Low | f32 roundtrip (0.7 → 0.699999...) |
| Stats objects return WASM pointers | Low | Use `.toJson()` or named accessors |

### Neutral
- Follows existing @ruvector/* optional dependency pattern
- No breaking changes to existing APIs
- Tests mock the WASM module for CI environments where it's not installed
