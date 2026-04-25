<div align="center">

<img src="docs/assets/banner.svg" alt="monobrain" width="860"/>

<br/>

[![npm version](https://img.shields.io/npm/v/monobrain?color=7c3aed&label=monobrain&style=flat-square)](https://www.npmjs.com/package/monobrain)
[![npm downloads](https://img.shields.io/npm/dm/monobrain?color=3b82f6&style=flat-square)](https://www.npmjs.com/package/monobrain)
[![License: MIT](https://img.shields.io/badge/license-MIT-06b6d4?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-10b981?style=flat-square)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-a78bfa?style=flat-square)](https://claude.ai/code)

**Enterprise AI agent orchestration for Claude Code.**  
60+ specialists. Persistent memory. Self-learning intelligence. Byzantine fault tolerance.

[Quick Start](#7-quick-start) · [CLI Reference](#8-cli-reference) · [How It Works](#2-how-it-works) · [Agent Ecosystem](#5-agent-ecosystem) · [Research](#6-research-acknowledgements)

</div>

---

## Table of Contents

1. [The Problem with Solo AI](#1-the-problem-with-solo-ai)
2. [How It Works](#2-how-it-works)
3. [Key Innovations](#3-key-innovations)
4. [Core Modules](#4-core-modules)
5. [Agent Ecosystem](#5-agent-ecosystem)
6. [Research Acknowledgements](#6-research-acknowledgements)
7. [Quick Start](#7-quick-start)
8. [CLI Reference](#8-cli-reference)
9. [The Learning Loop](#9-the-learning-loop)

---

## 1. The Problem with Solo AI

A single LLM session is stateless, single-threaded, and amnesiac. It cannot hold more than one specialization at peak depth, it loses everything the moment the session ends, and it has no mechanism to get better at recurring tasks. Ask it to architect a system, write the implementation, validate security, and maintain test coverage simultaneously — and you get shallow work across all four, or you context-switch manually between sessions and lose coherence.

Complex engineering work is inherently concurrent and cumulative. A human team succeeds because specialists work in parallel, hand off to each other with shared context, and build institutional knowledge over time. A solo AI session has none of that structure. Every run starts from zero, every agent is the same generalist, and every successful pattern learned from the last task evaporates.

Monobrain gives Claude Code a coordinated team: 60+ specialized agents that share persistent vector memory, route work automatically to the right specialist, reach fault-tolerant consensus across disagreements, and grow measurably better with each session.

> **One platform. Coordinated agents. Persistent intelligence.**

---

## 2. How It Works

Every request enters through a unified entry layer, passes through layered security, gets semantically routed to the right specialist, and feeds results back into a learning loop that makes the next routing decision sharper.

```
                           ┌──────────────┐
                           │     User     │
                           └──────┬───────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │        CLI / MCP Server     │
                    │    (200+ tools, stdio/HTTP) │
                    └─────────────┬──────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │      AIDefence Security     │
                    │  (input validation, gVisor  │
                    │   sandboxing, CVE scanning) │
                    └─────────────┬──────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │       Semantic Router       │◄─────────────┐
                    │  (SONA + MoE, keyword +     │              │
                    │   vector intent matching)   │              │
                    └─────────────┬──────────────┘              │
                                  │                             │
                    ┌─────────────▼──────────────┐              │
                    │      Swarm Coordinator      │              │
                    │  (hierarchical / mesh /     │              │
                    │   adaptive topology, Raft / │              │
                    │   BFT / CRDT consensus)     │              │
                    └─────────────┬──────────────┘              │
                                  │                             │
          ┌───────────────────────┼────────────────────────┐    │
          │                       │                        │    │
  ┌───────▼──────┐   ┌────────────▼────────┐   ┌──────────▼──┐ │
  │    coder     │   │  security-architect  │   │  60+ more   │ │
  │   reviewer   │   │   perf-engineer      │   │  specialists│ │
  │    tester    │   │   sparc-coord        │   │             │ │
  └───────┬──────┘   └────────────┬─────────┘   └──────────┬──┘ │
          └───────────────────────┼────────────────────────┘    │
                                  │                             │
                    ┌─────────────▼──────────────┐              │
                    │      Memory (HNSW)          │              │
                    │  (AgentDB + SQLite hybrid,  │              │
                    │   150x–12,500x faster search│              │
                    │   across sessions)          │              │
                    └─────────────┬──────────────┘              │
                                  │                             │
                    ┌─────────────▼──────────────┐              │
                    │       Learning Loop         │              │
                    │  RETRIEVE → JUDGE →         │              │
                    │  DISTILL → CONSOLIDATE      ├─────────────┘
                    │  (EWC++ prevents forgetting)│
                    └────────────────────────────┘
```

### 3-Tier Model Routing

Not every task warrants an Opus call. Monobrain routes each unit of work to the cheapest handler that can do it correctly.

| Tier | Handler              | Latency | Cost per call | When it applies                                                        |
|------|----------------------|---------|---------------|------------------------------------------------------------------------|
| 1    | Agent Booster (WASM) | <1ms    | $0            | Deterministic transforms: `var`→`const`, add types, remove `console.*` |
| 2    | Claude Haiku         | ~500ms  | ~$0.0002      | Simple bug fixes, config edits, low-complexity tasks (<30% reasoning)  |
| 3    | Claude Sonnet / Opus | 2–5s    | $0.003–0.015  | Architecture decisions, security review, complex cross-file reasoning  |

Tier 1 bypasses the LLM entirely — the WASM runtime executes the transform in under a millisecond at zero API cost. The router emits `[AGENT_BOOSTER_AVAILABLE]` or `[TASK_MODEL_RECOMMENDATION]` signals before any agent is spawned, so the orchestrator selects the minimum-cost handler automatically.

---

## 3. Key Innovations

- **HNSW vector search** delivers 150x–12,500x faster semantic memory retrieval than flat cosine search, enabling sub-millisecond pattern recall across arbitrarily large session histories.

- **SONA (Self-Optimizing Neural Architecture)** adapts routing weights in under 0.05ms per inference, updating continuously without blocking the agent pipeline.

- **Flash Attention** reduces attention computation cost by 2.49x–7.47x, making deep-context tasks across large codebases practical within a single session.

- **EWC++ (Elastic Weight Consolidation)** prevents catastrophic forgetting — the system retains patterns learned in session 1 while incorporating patterns from session 1,000, without retraining from scratch.

- **LoRA / MicroLoRA compression** achieves a 128x weight compression ratio, allowing adaptation layers to be stored and transferred per-project without meaningful storage overhead.

- **Byzantine fault-tolerant hive-mind consensus** (CP-WBFT) tolerates up to f < n/3 faulty agents in a swarm, making multi-agent decisions robust against hallucination or partial failure.

- **Poincaré ball (hyperbolic) embeddings** map hierarchical code relationships — module trees, inheritance chains, call graphs — into geometry that preserves structure flat embeddings distort.

- **9 reinforcement learning algorithms** (Q-Learning, SARSA, A2C, PPO, DQN, A3C, TD3, SAC, HER) are available as task-specific policy learners, selected by the router based on task type and exploration/exploitation tradeoffs.

- **Int8 quantization** reduces in-memory weight storage by approximately 4x, enabling the full intelligence stack to run on developer hardware without a GPU.

- **RETRIEVE → JUDGE → DISTILL pipeline (ReasoningBank)** structures every learning cycle: patterns are retrieved by HNSW, evaluated with pass/fail verdicts, distilled via LoRA into compact representations, and consolidated with EWC++ — closing the loop from outcome back to routing in a single session.

---

## 4. Core Modules

Monobrain is a monorepo of focused packages. Each one owns a distinct responsibility — there is no shared god-object and no circular dependencies between bounded contexts.

| Package | Version | Purpose |
|---|---|---|
| `@monobrain/cli` | `1.5.2` | CLI entry point — 41 commands spanning agent lifecycle, swarm orchestration, memory, hooks, sessions, neural training, security, and diagnostics |
| `@monobrain/memory` | `1.5.2` | AgentDB: hybrid SQLite + HNSW vector store. Stores session patterns, routes semantic queries, persists outcomes across sessions with namespace isolation |
| `@monobrain/hooks` | `1.5.2` | 17 lifecycle hooks (pre/post-edit, pre/post-task, session-start/end, route, pretrain…) + 12 background workers (ultralearn, optimize, audit, testgaps, refactor…) |
| `@monobrain/security` | `1.5.2` | AIDefence input validation layer — prompt injection detection, PII scanning, CVE remediation, gVisor sandbox integration, safe execution wrappers |
| `@monobrain/guidance` | `1.5.2` | Governance control plane — capability registry, workflow templates, quickref generation, routing recommendations for new users and CI pipelines |

### MCP Server

The MCP server (`monobrain mcp start`) exposes **280+ tools** over stdio or HTTP. Every CLI command has a corresponding MCP tool, enabling Claude Code to invoke the full Monobrain stack from within a conversation without shell access.

Tool categories: `agentdb_*`, `hooks_*`, `neural_*`, `swarm_*`, `memory_*`, `coordination_*`, `embeddings_*`, `performance_*`, `hive-mind_*`, `graphify_*`, `aidefence_*`, `browser_*`, `wasm_*`, `workflow_*`, `ruvllm_*`, and more.

### Background Workers

The daemon (`monobrain daemon start`) runs 12 workers that operate between sessions without blocking the active conversation:

| Worker | Trigger | What it does |
|---|---|---|
| `ultralearn` | Post-task | Deep pattern extraction from completed work |
| `optimize` | Periodic | Prunes low-confidence memory entries |
| `consolidate` | Session end | Runs EWC++ pass to merge new patterns without forgetting |
| `audit` | On change | Scans for security regressions in modified files |
| `testgaps` | Post-edit | Identifies untested paths introduced by recent edits |
| `refactor` | Threshold | Flags files approaching complexity or length limits |
| `benchmark` | Periodic | Tracks task latency and throughput against baselines |
| `predict` | Pre-task | Prefetches likely-needed patterns into memory cache |
| `preload` | Session start | Warms HNSW index with project-specific vectors |
| `map` | On demand | Builds call-graph snapshots for graphify queries |
| `deepdive` | On demand | Full codebase embedding refresh |
| `document` | Post-merge | Auto-generates or updates inline documentation |

---

## 5. Agent Ecosystem

Every agent type is a named Claude Code sub-agent with a focused system prompt and a defined set of tools. Monobrain's router selects the minimum-capability agent that can handle a given task, avoiding the cost and latency of over-provisioning.

### Core Engineering

| Agent | Role |
|---|---|
| `coder` | Clean, idiomatic implementation — respects existing conventions, avoids speculative abstraction |
| `reviewer` | Code review with confidence-based filtering — only surfaces issues that genuinely matter |
| `tester` | TDD London School specialist — mock-driven, contract-first test generation |
| `researcher` | Deep codebase exploration, execution path tracing, dependency mapping |
| `planner` | Task decomposition, milestone sequencing, GOAP-based action planning |
| `architect` | System design, ADR authorship, bounded-context analysis |

### Security

| Agent | Role |
|---|---|
| `security-architect` | Threat modeling, CVE remediation planning, secure-by-default design |
| `security-auditor` | Smart contract audits, vulnerability detection, penetration test support |
| `blockchain-security-auditor` | DeFi protocol security, Solidity vulnerability analysis |

### Consensus and Coordination

| Agent | Role |
|---|---|
| `raft-manager` | Raft leader election, log replication, quorum management |
| `byzantine-coordinator` | CP-WBFT consensus, malicious actor detection, f < n/3 fault tolerance |
| `crdt-synchronizer` | Conflict-free replicated data types for eventually consistent state |
| `gossip-coordinator` | Gossip-based consensus for large-scale decentralized coordination |
| `quorum-manager` | Dynamic quorum adjustment and membership management |

### Swarm Topologies

| Agent | Topology |
|---|---|
| `hierarchical-coordinator` | Queen-led hierarchy with specialized worker delegation |
| `mesh-coordinator` | Peer-to-peer mesh with distributed decision-making and fault tolerance |
| `adaptive-coordinator` | Dynamic topology switching — self-organizing, real-time optimization |
| `collective-intelligence-coordinator` | Distributed cognition, consensus protocols, cross-agent memory sync |

### Performance and Infrastructure

| Agent | Role |
|---|---|
| `v1-performance-engineer` | Flash Attention speedup (2.49x–7.47x), search improvements, benchmarking |
| `v1-memory-specialist` | HNSW indexing, AgentDB unification, 150x–12,500x search improvements |
| `v1-integration-architect` | Deep agentic-flow integration, duplicate elimination, ADR-001 implementation |
| `performance-benchmarker` | Comprehensive benchmarking, regression detection, SLA monitoring |
| `load-balancing-coordinator` | Work-stealing algorithms, adaptive load distribution |

### Domain Specialists

Monobrain includes 40+ additional specialists for frontend, backend, mobile, DevOps, ML, data engineering, blockchain, game development, and enterprise platforms. Run `monobrain agent list --available` to see the full catalog.

---

## 6. Research Acknowledgements

Monobrain implements techniques from peer-reviewed research across distributed systems, machine learning, and software engineering. The following papers directly influenced design decisions in the codebase.

| Technique | Paper | Applied In |
|---|---|---|
| HNSW approximate nearest neighbor | Malkov & Yashunin, 2018 — *Efficient and Robust ANN* | `@monobrain/memory` vector search |
| Flash Attention | Dao et al., 2022 — *Fast and Memory-Efficient Exact Attention* | Session context compression |
| LoRA fine-tuning | Hu et al., 2021 — *Low-Rank Adaptation of Large Language Models* | Pattern distillation, DISTILL step |
| EWC (Elastic Weight Consolidation) | Kirkpatrick et al., 2017 — *Overcoming Catastrophic Forgetting* | CONSOLIDATE step, session persistence |
| Byzantine fault tolerance | Castro & Liskov, 1999 — *Practical Byzantine Fault Tolerance* | CP-WBFT hive-mind consensus |
| Raft consensus | Ongaro & Ousterhout, 2014 — *In Search of an Understandable Consensus Algorithm* | Swarm coordinator state machine |
| CRDT data structures | Shapiro et al., 2011 — *Conflict-Free Replicated Data Types* | Eventually consistent agent memory |
| Gossip protocols | Demers et al., 1987 — *Epidemic Algorithms for Replicated Database Maintenance* | Cross-agent state propagation |
| Mixture of Experts | Shazeer et al., 2017 — *Outrageously Large Neural Networks* | MoE semantic router |
| PPO reinforcement learning | Schulman et al., 2017 — *Proximal Policy Optimization Algorithms* | Agent policy learner |
| Hyperbolic embeddings | Nickel & Kiela, 2017 — *Poincaré Embeddings for Learning Hierarchical Representations* | Code graph vector space |
| Int8 quantization | Dettmers et al., 2022 — *LLM.int8(): 8-bit Matrix Multiplication for Transformers* | Weight compression, memory footprint |
| GOAP planning | Orkin, 2004 — *Applying Goal-Oriented Action Planning to Games* | `goal-planner` and `sublinear-goal-planner` agents |
| Self-play RL | Silver et al., 2017 — *Mastering Chess and Shogi by Self-Play* | Pattern reinforcement in ReasoningBank |
| Hierarchical memory | Tulving, 1972 — *Episodic and Semantic Memory* | AgentDB episodic/semantic namespace split |
| PageRank influence | Page et al., 1998 — *The PageRank Citation Ranking* | `pagerank-analyzer` agent, graph centrality |
| Hindsight Experience Replay | Andrychowicz et al., 2017 — *HER: Hindsight Experience Replay* | HER policy learner in RL router |
| SPARC methodology | Agile/TDD literature | `sparc-coord`, `sparc-coder`, `specification`, `pseudocode`, `refinement` agents |
| Sublinear algorithms | Various — approximation theory | `sublinear-goal-planner`, `matrix-optimizer`, `trading-predictor` agents |

---

## 7. Quick Start

**Prerequisites**: Node.js >= 20, npm >= 9

### Step 1: Install Monobrain

```bash
npm install -g monobrain
monobrain --version
```

Or run without installing:

```bash
npx monobrain@latest --version
```

### Step 2: Add the MCP Server to Claude Code

```bash
claude mcp add monobrain -- npx -y monobrain@latest mcp start
```

Verify the server is registered:

```bash
claude mcp list
```

### Step 3: Initialize Your Project

```bash
npx monobrain@latest init --wizard
```

The wizard walks you through topology selection, memory backend, provider API keys, and hook configuration. It writes a `monobrain.config.json` to your project root and registers default hooks with Claude Code.

After init, start the background daemon so workers can run between sessions:

```bash
npx monobrain@latest daemon start
npx monobrain@latest doctor --fix
```

### Your First Swarm

The commands below spin up a 4-agent hierarchical swarm and populate it with core development roles. Run them in sequence from your project root.

```bash
# Initialize the swarm coordinator
npx monobrain@latest swarm init \
  --topology hierarchical \
  --max-agents 4 \
  --strategy specialized

# Spawn four agents in parallel roles
npx monobrain@latest agent spawn -t coder      --name coder-1
npx monobrain@latest agent spawn -t tester     --name tester-1
npx monobrain@latest agent spawn -t reviewer   --name reviewer-1
npx monobrain@latest agent spawn -t researcher --name researcher-1

# Confirm all agents are live
npx monobrain@latest agent list

# Check swarm coordination status
npx monobrain@latest swarm status
```

At this point the swarm is running under raft consensus. The coordinator assigns tasks, agents share memory through AgentDB, and the learning loop records outcomes for every completed task.

---

## 8. CLI Reference

Commands follow the pattern `npx monobrain@latest <command> <subcommand> [flags]`. The global install alias `monobrain` works identically.

### Agent and Swarm

| Command | Description |
|---|---|
| `npx monobrain@latest agent spawn -t <type> --name <name>` | Spawn a named agent of a given type |
| `npx monobrain@latest agent list` | List all running agents and their status |
| `npx monobrain@latest agent status --name <name>` | Show detailed status for a single agent |
| `npx monobrain@latest agent stop --name <name>` | Stop and remove an agent |
| `npx monobrain@latest swarm init --topology <topology> --max-agents <n> --strategy specialized` | Initialize a swarm with the given topology |
| `npx monobrain@latest swarm status` | Show active swarm, agent count, and consensus state |
| `npx monobrain@latest swarm shutdown` | Gracefully stop all swarm agents |

Valid topologies: `hierarchical`, `mesh`, `ring`, `star`, `hybrid`, `hierarchical-mesh`

### Memory

| Command | Description |
|---|---|
| `npx monobrain@latest memory store --key <key> --value <value> --namespace <ns>` | Persist a value under a namespaced key |
| `npx monobrain@latest memory search --query <text> --namespace <ns> --limit <n>` | Semantic vector search across stored entries |
| `npx monobrain@latest memory retrieve --key <key> --namespace <ns>` | Fetch a specific entry by exact key |
| `npx monobrain@latest memory list --namespace <ns> --limit <n>` | List all keys in a namespace |
| `npx monobrain@latest memory init --force --verbose` | Initialize or reset the memory database |

The `--namespace` flag scopes storage to avoid collisions between projects, agents, or purposes (e.g. `patterns`, `solutions`, `collaboration`). Omitting it writes to the `default` namespace.

### Hooks

| Command | Description |
|---|---|
| `npx monobrain@latest hooks pre-task --description <task>` | Record task start; returns agent routing recommendation |
| `npx monobrain@latest hooks post-task --task-id <id> --success true` | Record task outcome for learning; stores result patterns |
| `npx monobrain@latest hooks route --task <task> --context <ctx> --top-k <n>` | Route a task description to the optimal agent type |
| `npx monobrain@latest hooks session-start --session-id <id>` | Start or restore a session and load prior context |
| `npx monobrain@latest hooks worker list` | List all 12 background workers and their current status |
| `npx monobrain@latest hooks worker dispatch --trigger <worker>` | Manually trigger a background worker by name |

### Intelligence

| Command | Description |
|---|---|
| `npx monobrain@latest neural train --pattern-type coordination --epochs <n>` | Train neural patterns on recorded task outcomes |
| `npx monobrain@latest neural predict --input <task description>` | Predict optimal routing and approach for a new task |
| `npx monobrain@latest neural patterns --list` | Display all learned patterns and their confidence scores |
| `npx monobrain@latest hooks pretrain --model-type moe --epochs <n>` | Bootstrap intelligence from the current repository |
| `npx monobrain@latest hooks build-agents --agent-types <types> --focus <area>` | Generate optimized agent configurations for a task type |

### System

| Command | Description |
|---|---|
| `npx monobrain@latest doctor --fix` | Run all health checks and auto-repair fixable issues |
| `npx monobrain@latest daemon start` | Start the background worker daemon |
| `npx monobrain@latest daemon stop` | Stop the background worker daemon |
| `npx monobrain@latest config get <key>` | Read a configuration value |
| `npx monobrain@latest config set <key> <value>` | Write a configuration value |
| `npx monobrain@latest session save --session-id <id>` | Persist current session state to disk |
| `npx monobrain@latest session restore --session-id <id>` | Load a previously saved session |

---

## 9. The Learning Loop

Every task Monobrain runs feeds a 4-step intelligence pipeline. It operates on recorded outcomes — successes, failures, timings, and routing decisions — and uses that data to make every subsequent session more accurate than the last.

### The Pipeline

```
Task completes
      |
      v
+------------+     HNSW vector index       +----------+
|  RETRIEVE  | --------------------------> | patterns |
+------------+   150x-12,500x faster       | (AgentDB)|
      |                                    +----------+
      v
+------------+     success / failure verdict per task
|   JUDGE    |
+------------+
      |
      v
+------------+     LoRA fine-tuning extracts signal
|  DISTILL   |
+------------+
      |
      v
+--------------+     EWC++ penalizes overwrites of
| CONSOLIDATE  | <-- important prior weights;
+--------------+     prevents catastrophic forgetting
      |
      +---> updated weights feed next RETRIEVE cycle
```

Between each cycle, SONA (Self-Optimizing Neural Architecture) adjusts internal routing weights in under 0.05ms — fast enough to run between task assignments without adding measurable latency.

### What Each Step Does

**RETRIEVE** queries the HNSW (Hierarchical Navigable Small World) index to find patterns similar to the current task. HNSW is an approximate nearest-neighbor structure that operates 150x to 12,500x faster than a brute-force vector scan at the same recall accuracy. When an agent is assigned a task, relevant patterns from past sessions are retrieved and included in its context before work begins.

**JUDGE** evaluates each completed task and emits a verdict: success, partial success, or failure, with contributing factors recorded. Verdict data is attached to the patterns that were active during the task, reinforcing useful patterns and down-weighting misleading ones. This is what `hooks post-task --success true` writes to the system.

**DISTILL** runs a LoRA (Low-Rank Adaptation) pass over the verdict-annotated patterns to extract the signal without retaining noise. LoRA applies a small rank-decomposition update rather than retraining the full model, which keeps the operation fast enough to run after every session rather than on a scheduled batch job.

**CONSOLIDATE** applies EWC++ (Elastic Weight Consolidation) to the updated parameters. EWC++ adds a penalty term that prevents the optimizer from overwriting weights that were important for earlier tasks. Without this step, learning from a new domain would degrade performance on established patterns — the problem known as catastrophic forgetting. With it, the system accumulates knowledge without erasing prior competence.

### What "Gets Smarter Every Session" Means in Practice

After several sessions of real work, three things measurably improve. Routing accuracy increases: the `hooks route` and `neural predict` commands return recommendations that match the actual best agent for a task more often, because the JUDGE step has accumulated verdict data distinguishing which agent types succeed at which task shapes. Memory recall precision improves: RETRIEVE returns more relevant patterns and fewer false positives as the HNSW index grows denser with verified, verdict-weighted entries. Background worker prioritization becomes more effective: the `optimize`, `audit`, and `testgaps` workers are dispatched more frequently in the contexts where they have historically produced improvements, and less frequently where they have not. None of this requires manual tuning — the pipeline runs automatically on every `hooks post-task` call and persists across sessions through AgentDB.

---

<div align="center">

Built for engineers who think in systems, not prompts.

**[npm](https://www.npmjs.com/package/monobrain) · [GitHub](https://github.com/nokhodian/monobrain) · [Issues](https://github.com/nokhodian/monobrain/issues)**

</div>
