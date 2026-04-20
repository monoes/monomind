# @monobrain/hooks

[![npm version](https://img.shields.io/npm/v/@monobrain/hooks.svg)](https://www.npmjs.com/package/@monobrain/hooks)
[![npm downloads](https://img.shields.io/npm/dm/@monobrain/hooks.svg)](https://www.npmjs.com/package/@monobrain/hooks)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

> Event-driven lifecycle hooks with ReasoningBank learning integration for Monobrain V1

The `@monobrain/hooks` package provides a comprehensive hooks system for intercepting and extending Monobrain operations. It enables intelligent task routing, pattern learning, background metrics collection, and real-time statusline integration.

## Features

- 🎣 **Hook Registry** - Priority-based hook registration with filtering and management
- ⚡ **Hook Executor** - Timeout handling, error recovery, and result aggregation
- 🤖 **Background Daemons** - Metrics collection, swarm monitoring, pattern learning
- 👷 **Background Workers** - 12 specialized workers for analysis, optimization, and automation
- 📊 **Statusline Integration** - Real-time status display for Claude Code
- 🧠 **ReasoningBank Learning** - Intelligent task routing based on learned patterns
- 🔧 **MCP Tools** - 13 MCP tools for programmatic hooks access
- 🔄 **V2 Compatibility** - Backward compatible with V2 hook commands

## Installation

```bash
# Using npm
npm install @monobrain/hooks

# Using pnpm
pnpm add @monobrain/hooks

# Using yarn
yarn add @monobrain/hooks
```

## Quick Start

### Basic Usage

```typescript
import {
  HookRegistry,
  HookExecutor,
  HookEvent,
  HookPriority,
} from '@monobrain/hooks';

// Create registry and executor
const registry = new HookRegistry();
const executor = new HookExecutor(registry);

// Register a pre-edit hook
registry.register(
  HookEvent.PreEdit,
  async (context) => {
    console.log(`Editing file: ${context.file?.path}`);
    return { success: true };
  },
  HookPriority.Normal,
  { name: 'log-edits' }
);

// Execute hooks
const result = await executor.preEdit('src/app.ts', 'modify');
console.log(`Hooks executed: ${result.hooksExecuted}`);
```

### Initialize with Daemons

```typescript
import { initializeHooks } from '@monobrain/hooks';

// Initialize full system with background daemons
const { registry, executor, statusline } = await initializeHooks({
  enableDaemons: true,
  enableStatusline: true,
});

// Generate statusline
console.log(statusline.generateStatusline());
```

### Using MCP Tools

```typescript
import { hooksMCPTools, getHooksTool } from '@monobrain/hooks';

// Get specific tool
const routeTool = getHooksTool('hooks/route');

// Execute routing
const result = await routeTool.handler({
  task: 'Implement user authentication',
  includeExplanation: true,
});

console.log(`Recommended agent: ${result.recommendedAgent}`);
console.log(`Confidence: ${result.confidence}%`);
```

## CLI Commands

### Hooks Daemon

Manage background daemon processes for metrics and learning.

```bash
# Start daemon with default 60s interval
hooks-daemon start

# Start with custom interval (30 seconds)
hooks-daemon start 30

# Stop daemon
hooks-daemon stop

# Check status
hooks-daemon status

# Run pattern consolidation
hooks-daemon consolidate

# Export learned patterns
hooks-daemon export json

# Rebuild HNSW index
hooks-daemon rebuild-index

# Notify activity (for hook integration)
hooks-daemon notify-activity
```

### Statusline

Generate statusline output for Claude Code integration.

```bash
# Display formatted statusline
statusline

# Output JSON data
statusline --json

# Compact JSON (single line)
statusline --compact

# Show help
statusline --help
```

**Example Output:**
```
▊ Monobrain V1 ● agentic-flow@alpha  │  ⎇ v1
─────────────────────────────────────────────────────
🏗️  DDD Domains    [●●●●●]  5/5    ⚡ 1.0x → 2.49x-7.47x
🤖 Swarm Agents    ◉ [ 5/15]      🟢 CVE 3/3    💾 156 patterns
🔧 Architecture    DDD ●93%  │  Security ●CLEAN  │  Hooks ●ACTIVE
📊 Routing         89% accuracy │  Avg 4.2ms │  1547 operations
─────────────────────────────────────────────────────
```

## Hook Events

| Event | Description |
|-------|-------------|
| `PreToolUse` | Before any tool execution |
| `PostToolUse` | After tool execution completes |
| `PreEdit` | Before file modification |
| `PostEdit` | After file modification |
| `PreRead` | Before file read |
| `PostRead` | After file read |
| `PreCommand` | Before shell command execution |
| `PostCommand` | After shell command completes |
| `PreTask` | Before task starts |
| `PostTask` | After task completes |
| `TaskProgress` | During task execution |
| `SessionStart` | When session begins |
| `SessionEnd` | When session ends |
| `SessionRestore` | When restoring previous session |
| `AgentSpawn` | When agent is spawned |
| `AgentTerminate` | When agent terminates |
| `PreRoute` | Before task routing |
| `PostRoute` | After routing decision |
| `PatternLearned` | When new pattern is learned |
| `PatternConsolidated` | When patterns are consolidated |

## Hook Priorities

| Priority | Value | Use Case |
|----------|-------|----------|
| `Critical` | 1000 | Security validation, must run first |
| `High` | 100 | Pre-processing, preparation |
| `Normal` | 50 | Standard hooks |
| `Low` | 10 | Logging, metrics |
| `Background` | 1 | Async operations, runs last |

## Background Workers

The hooks system includes 12 specialized background workers that can be triggered automatically or manually dispatched.

### Available Workers

| Worker | Priority | Est. Time | Description |
|--------|----------|-----------|-------------|
| `ultralearn` | normal | 60s | Deep knowledge acquisition and learning |
| `optimize` | high | 30s | Performance optimization and tuning |
| `consolidate` | low | 20s | Memory consolidation and cleanup |
| `predict` | normal | 15s | Predictive preloading and anticipation |
| `audit` | critical | 45s | Security analysis and vulnerability scanning |
| `map` | normal | 30s | Codebase mapping and architecture analysis |
| `preload` | low | 10s | Resource preloading and cache warming |
| `deepdive` | normal | 60s | Deep code analysis and examination |
| `document` | normal | 45s | Auto-documentation generation |
| `refactor` | normal | 30s | Code refactoring suggestions |
| `benchmark` | normal | 60s | Performance benchmarking |
| `testgaps` | normal | 30s | Test coverage analysis |

### Worker CLI Commands

```bash
# List all available workers
monobrain hooks worker list

# Detect triggers from prompt text
monobrain hooks worker detect --prompt "optimize performance"

# Auto-dispatch when triggers match (confidence ≥0.6)
monobrain hooks worker detect --prompt "deep dive into auth" --auto-dispatch --min-confidence 0.6

# Manually dispatch a worker
monobrain hooks worker dispatch --trigger refactor --context "auth module"

# Check worker status
monobrain hooks worker status

# Cancel a running worker
monobrain hooks worker cancel --id worker_refactor_1_abc123
```

### Performance Targets

| Metric | Target |
|--------|--------|
| Trigger detection | <5ms |
| Worker spawn | <50ms |
| Max concurrent | 10 |

### UserPromptSubmit Integration

Workers are automatically triggered via the `UserPromptSubmit` hook when prompt patterns match worker triggers with confidence ≥0.6. Add this to your Claude settings:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": ".*",
      "hooks": [{
        "type": "command",
        "timeout": 6000,
        "command": "monobrain hooks worker detect --prompt \"$USER_PROMPT\" --auto-dispatch --min-confidence 0.6"
      }]
    }]
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `hooks/pre-edit` | Get context and suggestions before file edit |
| `hooks/post-edit` | Record edit outcome for learning |
| `hooks/route` | Route task to optimal agent; supports `useLATS`, `useDAGLearner`, `useAFLOW` flags |
| `hooks/metrics` | Query learning metrics |
| `hooks/pre-command` | Assess command risk |
| `hooks/post-command` | Record command outcome |
| `hooks/daemon-status` | Get daemon status |
| `hooks/statusline` | Get statusline data |
| `hooks/evo-agentx` | GEPA prompt co-evolution + SubGraph topology recommendation (EvoAgentX) |
| `hooks/worker-list` | List all 12 background workers |
| `hooks/worker-dispatch` | Dispatch a worker by trigger type |
| `hooks/worker-status` | Get status of running workers |
| `hooks/worker-detect` | Detect worker triggers from prompt text |
| `hooks/worker-cancel` | Cancel a running worker |
| `hooks/model-outcome` | Record verifiable reward signals (RLVR) into ReasoningBank via tsc + injection checks |

## Tier 4 Research Implementations

The following modules implement state-of-the-art multi-agent research from the literature.

### LATS — Language Agent Tree Search (arXiv:2310.04406)

Replaces greedy coordinator planning with MCTS-style tree search over candidate plan steps.

```typescript
import { buildLATSPlan, type LATSConfig } from '@monobrain/hooks';

const plan = await buildLATSPlan('Implement OAuth2 authentication', {
  simulations: 30,      // MCTS rollouts (default: 20)
  maxDepth: 5,          // Max tree depth (default: 5)
  explorationConstant: 1.41,  // UCB1 C parameter
  format: 'markdown',   // 'markdown' | 'json' | 'numbered-list'
});
// Returns: "## Coordinator Plan\n### Step 1: Analyze...\n..."
```

Also available via `hooks/route` MCP tool with `useLATS: true, latsSimulations: 30`.

### DAGLearner — Heterogeneous Swarm Topology (arXiv:2502.04510)

Reads ReasoningBank patterns to propose an optimised heterogeneous agent DAG topology.

```typescript
import { DAGLearner, type DAGLearnerConfig, type DAGLearnerResult } from '@monobrain/hooks';

const learner = new DAGLearner();
const result: DAGLearnerResult = await learner.propose('Implement OAuth2 with tests');
// result.topology     — CompiledSubGraph registered in SubGraphRegistry
// result.selectedSlugs — ['planner', 'security-architect', 'tester', 'reviewer']
// result.learnedFromPatterns — number of ReasoningBank patterns consulted
```

Also available via `hooks/route` MCP tool with `useDAGLearner: true`.

### EvoAgentX Coordinator — GEPA Co-evolution (arXiv:2507.19457)

Couples `TraceQualityStore` + `GEPAOptimizer` + `DAGLearner` into a single
prompt-evolution + topology-discovery pipeline.

```typescript
import { EvoAgentXCoordinator, type EvoAgentXConfig } from '@monobrain/hooks';

const coordinator = new EvoAgentXCoordinator({
  traceStorePath: './data/traces',
  minTraceQuality: 0.7,
  traceLookbackDays: 7,
  gepa: { generations: 3 },
});

const result = await coordinator.optimise(
  'coder',           // agentSlug
  'You are a coder…', // basePrompt
  ['tester', 'reviewer'], // peerAgentSlugs for shared trace pool
);
// result.evolvedPrompt   — best GEPA-evolved prompt
// result.bestQuality     — quality score of evolved prompt
// result.topology        — recommended SubGraph topology
// result.dagSynthesised  — true if DAGLearner synthesised a new topology
```

Also available via `hooks/evo-agentx` MCP tool.

### μACP — Minimal Agent Coordination Protocol (arXiv:2601.03938)

Four-verb (INIT → PROPOSE → ACCEPT → COMMIT) formally minimal coordination
substrate. All state lives in a caller-owned `MuACPSession`; there is no global registry.

```typescript
import { MuACP, type MuACPSession, type MuACPCommitResult } from '@monobrain/hooks';

// Option 1: step-by-step
const session: MuACPSession = MuACP.init('agent-a', ['agent-a', 'agent-b'], 'Use hierarchical topology?');
MuACP.propose(session, 'agent-a', 'hierarchical');
MuACP.accept(session, 'agent-b');
const result: MuACPCommitResult = MuACP.commit(session);
// result.committed === true, result.value === 'hierarchical'

// Option 2: convenience single-round
const result2 = MuACP.coordinate(
  'agent-a',              // initiator
  ['agent-b', 'agent-c'], // peers
  'Choose model tier',    // subject
  'sonnet',               // proposal
  (agentId, proposal) => proposal !== 'haiku', // acceptFn
);
```

Also wired into `SwarmCommunication` via `coordinateWithMuACP()`:

```typescript
import { swarmComm } from '@monobrain/hooks';

const result = swarmComm.coordinateWithMuACP(
  ['agent-a', 'agent-b'],
  'Deploy strategy',
  'blue-green',
  (agentId, proposal) => true,
);
// emits 'muacp:committed' event
```

### AFLOW — MCTS-Guided Workflow Search (arXiv:2410.10762)

`AFLOWSearch` uses Monte Carlo Tree Search to explore the `SubGraphRegistry` for an
optimal multi-step workflow that maximises a caller-supplied reward function.

```typescript
import { AFLOWSearch, type AFLOWConfig, compileSubGraph } from '@monobrain/hooks';

const aflow = new AFLOWSearch({
  maxIterations: 50,     // MCTS budget
  explorationConstant: 1.41,
  rewardFn: async (subgraph) => myEvaluator(subgraph),
});

const result = await aflow.search('Build and test OAuth2 service');
// result.topology — best CompiledSubGraph found
// result.reward   — score awarded by rewardFn
```

Also available via `hooks/route` MCP tool with `useAFLOW: true`.

### DGM MAP-Elites Archive — Dynamic Agent Synthesis (arXiv:2505.22954)

Every agent promoted via `AgentPromoter` is registered in the DGM MAP-Elites
archive keyed by `(domain, taskType)` niche. The archive stores quality and
novelty scores so that future synthesis requests can draw the highest-performing
agent for each niche rather than starting from scratch.

```typescript
import { DGMArchive, type DGMArchiveEntry } from '@monobrain/hooks';

const archive = new DGMArchive();
const entry: DGMArchiveEntry = archive.get('security', 'audit');
// entry.agentDefinition — promoted agent definition
// entry.quality         — MAP-Elites quality score
// entry.novelty         — behavioural novelty vs niche neighbours
```

Automatically populated when `AgentPromoter.promote()` is called with a
successful `EphemeralAgentRecord`.

### FOREVER Forgetting Curve (newinnovation.md §2.6)

Applies Ebbinghaus-style exponential decay to memory importance scores and
schedules entries for spaced-repetition replay. No schema changes required —
uses existing `importanceScore` and `lastAccessedAt` fields.

```typescript
import { ForgettingCurveWorker, type ForgettingCurveEntry } from '@monobrain/hooks';

const worker = new ForgettingCurveWorker({
  decayRate: 0.005,       // λ: −0.005 importance per hour (matches LearningBridge default)
  replayThreshold: 0.3,   // Flag entries below 30% of original score for replay
  maxReplayPerRun: 50,    // Cap replay queue length per run
});

const result = await worker.execute({ entries: memoryEntries });
// result.scheduledForReplay — sorted by urgency (lowest decayed score first)
// result.healthy            — entries still above threshold
// result.replayCount        — how many were scheduled
```

Wire into the `consolidate` or `ultralearn` background worker to replay
decaying memories via `agentdb_pattern-store`.

### CP-WBFT Weighted Voting (newinnovation.md §4.1)

`SwarmCommunication.resolveConsensus()` now weights votes by each agent's
`confidence` field. Set `agent.confidence` before a consensus round to apply
CP-WBFT (confidence-weighted Byzantine fault tolerance):

```typescript
import { swarmComm } from '@monobrain/hooks';

// Register agents with confidence weights (e.g. from a pre-round probe)
swarmComm.registerAgent({ id: 'agent-1', confidence: 0.95, /* ... */ });
swarmComm.registerAgent({ id: 'agent-2', confidence: 0.60, /* ... */ });
swarmComm.registerAgent({ id: 'agent-3', confidence: 0.80, /* ... */ });

// When consensus resolves, agent-1's vote carries 0.95 weight vs agent-2's 0.60
const request = await swarmComm.initiateConsensus(
  'Select deployment strategy',
  ['blue-green', 'canary', 'rolling'],
);
```

Agents without a `confidence` field default to weight `1.0` (backwards-compatible).

### RLVR Verifiable Rewards (newinnovation.md §3.8)

The `hooks/model-outcome` MCP tool connects TypeScript compiler and AI-defence
pattern checks to the ReasoningBank learning loop as binary reward signals:

```typescript
// Via MCP tool
const result = await modelOutcomeTool.handler({
  agentSlug: 'coder',
  taskDescription: 'Implement JWT authentication middleware',
  verifierType: 'both',     // run tsc pattern check + injection scan
  output: generatedCode,
});
// result.reward       — 0.0–1.0 composite reward
// result.patternStored — true if stored in ReasoningBank
```

### ERL — Experiential Reflective Learning (arXiv:2603.24639)

Post-trajectory heuristic extraction. After each completed trajectory, `ERLWorker`
distils 1–3 portable, actionable rules from failure→recovery patterns. Rules are
stored in the `heuristics` namespace and injected into agent system prompts via
`pre-task` hooks.

```typescript
import { ERLWorker, type ERLTrajectory, type ERLHeuristic } from '@monobrain/hooks';

const worker = new ERLWorker({ maxPerTrajectory: 3, minQuality: 0.4 });

const trajectory: ERLTrajectory = {
  id: 'traj-abc123',
  taskDescription: 'Implement OAuth2 login with PKCE',
  steps: [
    { step: 1, action: 'fetch external config', outcome: 'failure', error: 'ECONNREFUSED' },
    { step: 2, action: 'retry with fallback', outcome: 'success' },
  ],
  success: true,
  agentSlug: 'coder',
  completedAt: Date.now(),
};

const result = worker.extract(trajectory);
// result.extracted[0].rule — "Implement retry with exponential backoff for external API calls."

// Inject top-5 heuristics before a task
const injection = worker.formatForInjection(storedHeuristics, 5);
// Returns a markdown block prepended to the agent system prompt
```

Runs automatically in `createLearningWorker()` when `metrics.trajectories` is present.

### TextGrad — Backward Pass via Text (arXiv:2406.07496)

Automatic "differentiation" for agent outputs. `TextGradWorker` critiques an agent's
output across five dimensions (correctness, reasoning, format, safety, efficiency)
and returns `TextualGradient` objects. Gradients are stored in
`.monobrain/learning/textual-gradients.json` and consumed by `PromptOptimizer`.

```typescript
import { TextGradWorker, type TextGradInput } from '@monobrain/hooks';

const worker = new TextGradWorker({ maxGradients: 3, minMagnitude: 0.2 });

const result = worker.compute({
  taskId: 'task-xyz',
  taskDescription: 'Write a JWT middleware',
  output: generatedCode,
  agentSlug: 'coder',
  priorQuality: 0.55,  // from RLVR verifier
});
// result.gradients[0] = { dimension: 'safety', critique: '...', magnitude: 0.9 }

// Format for prompt injection
const fragment = worker.formatForPrompt(result.gradients);
// "## Textual Gradients (TextGrad backward pass)\n[SAFETY Δ90%] ..."
```

Runs automatically in `createLearningWorker()` when `metrics.taskOutputs` is present.

### MAR — Multi-Agent Reflexion (arXiv:2512.20845)

Structured reflection pipeline with heterogeneous critics. `MARWorker` spawns:
- **Diagnoser** — identifies root cause from error message / quality score
- **Critics (×3)** — conservative, balanced, creative perspectives (simulated temperatures)
- **Aggregator** — synthesises into a unified reflection + ERL-compatible heuristic

```typescript
import { MARWorker, type MARInput } from '@monobrain/hooks';

const worker = new MARWorker({ numCritics: 3 });

const result = worker.reflect({
  taskDescription: 'Migrate user table to PostgreSQL 16',
  agentOutput: 'Done.',
  success: false,
  agentSlug: 'database-specialist',
  errorMessage: 'EACCES: permission denied',
  qualityScore: 0.2,
});

// result.reflection.synthesis     — aggregated multi-critic reflection
// result.reflection.heuristic     — ERL-compatible rule for heuristics pool
// result.reflection.promptUpdate  — ready-to-inject prompt fragment
```

### RAPTOR — Recursive Abstractive Tree Indexing (arXiv:2401.18059)

Background consolidation that clusters episodic entries and generates abstractive
summaries, stored as `contextual`-tier entries. Enables thematic retrieval in
addition to per-entry lookup.

```typescript
import { RaptorWorker, type RaptorEntry } from '@monobrain/hooks';

const worker = new RaptorWorker({
  clusterSize: 5,       // target entries per cluster
  minClusterSize: 3,    // skip clusters smaller than this
  maxSummaryLength: 300,
});

const entries: RaptorEntry[] = episodicEntries.map(e => ({
  id: e.id,
  content: e.content,
  embedding: Array.from(e.embedding ?? []),
  namespace: e.namespace,
}));

const result = worker.consolidate(entries, 'project-knowledge');
// result.summaryEntries — [{key, content, namespace, memberIds}, ...]
// Store these as contextual-tier MemoryEntries in HybridBackend
```

Runs automatically in `createLearningWorker()` during background consolidation cycles.

---

### Agent-as-a-Judge — Trajectory-Level Quality Evaluation (arXiv:2410.10934)

Upgrades `LLMJudgeMetric` to examine the full execution trace — reasoning steps,
tool calls, and intermediate observations — rather than just input/output.
The judge model can penalise hallucinated tool calls and unnecessary detours even
when the final answer happens to be correct.

```typescript
import { TraceAwareJudgeMetric, type TraceStep } from '@monobrain/hooks';

const judge = new TraceAwareJudgeMetric(
  async (prompt) => callClaude({ model: 'claude-haiku-4-5', prompt }),
  { maxSteps: 10, scoreReasoning: true },
);

const trace: TraceStep[] = [
  { role: 'agent', content: 'I will search for the latest exchange rate.' },
  { role: 'tool', content: 'web_search("USD to EUR rate")', toolCall: 'web_search', outcome: '1 USD = 0.93 EUR' },
  { role: 'agent', content: 'The exchange rate is 0.93.' },
];

const score = await judge.scoreWithTrace(
  'What is the USD to EUR exchange rate?',
  'The exchange rate is 0.93.',
  trace,
);
// score: 0.95 — penalises any tool misuse or hallucinated steps
```

Used automatically in `modelOutcomeTool` when `verifier_type: "llm_judge"`.

---

### O-Information Divergence Gate — Anti-Groupthink Consensus (arXiv:2510.05174)

Adds a `minDivergenceRounds` parameter to `hive-mind_consensus`. Proposals cannot
resolve until at least N voting rounds show divergent votes (not unanimous), preventing
premature convergence when agent synergy is still "in play".

```bash
# Propose with anti-groupthink gate requiring 2 divergent rounds before resolution
npx monobrain@latest mcp run hive-mind_consensus '{"action":"propose","type":"architecture","value":"use microservices","voterId":"queen","minDivergenceRounds":2}'

# Each vote round returns divergenceGateOpen status
npx monobrain@latest mcp run hive-mind_consensus '{"action":"vote","proposalId":"proposal-xxx","voterId":"worker-1","vote":true}'
# → { divergenceGateOpen: false, divergenceRoundsSeen: 0, minDivergenceRounds: 2, divergenceHint: "..." }
```

## API Reference

### HookRegistry

```typescript
class HookRegistry {
  // Register a hook
  register(
    event: HookEvent,
    handler: HookHandler,
    priority: HookPriority,
    options?: HookRegistrationOptions
  ): string;

  // Unregister a hook
  unregister(hookId: string): boolean;

  // Get hooks for event
  getForEvent(event: HookEvent, enabledOnly?: boolean): HookEntry[];

  // Enable/disable hooks
  enable(hookId: string): boolean;
  disable(hookId: string): boolean;

  // List hooks with filtering
  list(filter?: HookListFilter): HookEntry[];

  // Get statistics
  getStats(): HookRegistryStats;
}
```

### HookExecutor

```typescript
class HookExecutor {
  // Execute hooks for any event
  execute<T>(
    event: HookEvent,
    context: Partial<HookContext<T>>,
    options?: HookExecutionOptions
  ): Promise<HookExecutionResult>;

  // Convenience methods
  preToolUse(toolName: string, parameters: Record<string, unknown>): Promise<HookExecutionResult>;
  postToolUse(toolName: string, parameters: Record<string, unknown>, duration: number): Promise<HookExecutionResult>;
  preEdit(filePath: string, operation: 'create' | 'modify' | 'delete'): Promise<HookExecutionResult>;
  postEdit(filePath: string, operation: 'create' | 'modify' | 'delete', duration: number): Promise<HookExecutionResult>;
  preCommand(command: string, workingDirectory?: string): Promise<HookExecutionResult>;
  postCommand(command: string, exitCode: number, output?: string, error?: string): Promise<HookExecutionResult>;
  sessionStart(sessionId: string): Promise<HookExecutionResult>;
  sessionEnd(sessionId: string): Promise<HookExecutionResult>;
  agentSpawn(agentId: string, agentType: string): Promise<HookExecutionResult>;
  agentTerminate(agentId: string, agentType: string, status: string): Promise<HookExecutionResult>;
}
```

### DaemonManager

```typescript
class DaemonManager {
  // Register and manage daemons
  register(config: DaemonConfig, task: () => Promise<void>): void;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  restart(name: string): Promise<void>;

  // Bulk operations
  startAll(): Promise<void>;
  stopAll(): Promise<void>;

  // Status
  getState(name: string): DaemonState | undefined;
  getAllStates(): DaemonState[];
  isRunning(name: string): boolean;
}
```

### StatuslineGenerator

```typescript
class StatuslineGenerator {
  // Register data sources
  registerDataSources(sources: StatuslineDataSources): void;

  // Generate output
  generateData(): StatuslineData;
  generateStatusline(): string;
  generateJSON(): string;
  generateCompactJSON(): string;

  // Configuration
  updateConfig(config: Partial<StatuslineConfig>): void;
  invalidateCache(): void;
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MONOBRAIN_HOOK_TIMEOUT` | Hook execution timeout (ms) | `5000` |
| `MONOBRAIN_REASONINGBANK_ENABLED` | Enable ReasoningBank | `true` |
| `MONOBRAIN_HOOKS_NAMESPACE` | Learning namespace | `hooks-learning` |
| `MONOBRAIN_HOOKS_LOG_LEVEL` | Logging level | `info` |
| `MONOBRAIN_SHOW_HOOKS_METRICS` | Show hooks in statusline | `true` |
| `MONOBRAIN_SHOW_SWARM_ACTIVITY` | Show swarm in statusline | `true` |
| `MONOBRAIN_SHOW_PERFORMANCE` | Show performance targets | `true` |

## Integration with Claude Code

Add to your Claude settings (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "timeout": 5000,
        "command": "hooks-daemon start"
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "timeout": 3000,
        "command": "hooks-daemon stop"
      }]
    }],
    "PreToolUse": [{
      "hooks": [{
        "type": "command",
        "timeout": 100,
        "command": "hooks-daemon notify-activity"
      }]
    }]
  },
  "statusLine": {
    "type": "command",
    "command": "statusline"
  }
}
```

## Related Packages

- [@monobrain/shared](../shared) - Shared utilities and types
- [@monobrain/memory](../memory) - AgentDB memory system

## License

MIT © [Monobrain Team](https://github.com/nokhodian/monobrain)
