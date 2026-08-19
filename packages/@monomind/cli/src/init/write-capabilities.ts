/**
 * CAPABILITIES.md writer — comprehensive overview of all Monomind features.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { InitOptions, InitResult } from './types.js';
import { atomicWriteFile, _isOptionalPackageResolvable } from './shared.js';

/**
 * Write CAPABILITIES.md - comprehensive overview of all Monomind features
 */
export async function writeCapabilitiesDoc(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const capabilitiesPath = path.join(targetDir, '.monomind', 'CAPABILITIES.md');

  if (fs.existsSync(capabilitiesPath) && !options.force) {
    result.skipped.push('.monomind/CAPABILITIES.md');
    return;
  }

  const hooksAvailable = _isOptionalPackageResolvable('@monoes/hooks');

  const capabilities = `# Monomind - Complete Capabilities Reference
> Generated: ${new Date().toISOString()}
> Full documentation: https://github.com/monoes/monomind

## 📋 Table of Contents

1. [Overview](#overview)
2. [Swarm Orchestration](#swarm-orchestration)
3. [Available Agents (60+)](#available-agents)
4. [CLI Commands](#cli-commands)
5. [Hooks System (29 Hook Subcommands + 8 Background Workers)](#hooks-system)
6. [Memory & Intelligence](#memory--intelligence)
7. [Hive-Mind Consensus](#hive-mind-consensus)
8. [Performance Targets](#performance-targets)
9. [Integration Ecosystem](#integration-ecosystem)

---

## Overview

Monomind is a domain-driven design architecture for multi-agent AI coordination with:

- **15-Agent Swarm Coordination** with hierarchical and mesh topologies
- **ANN Vector Search** - indexed pattern retrieval via SQLite (better-sqlite3, sql.js WASM fallback)
- **Keyword Routing** - deterministic task→agent routing with outcome measurement
- **Byzantine Fault Tolerance** - Queen-led consensus mechanisms
- **MCP Server Integration** - Model Context Protocol support

### Current Configuration
| Setting | Value |
|---------|-------|
| Topology | ${options.runtime.topology} |
| Max Agents | ${options.runtime.maxAgents} |
| Memory Backend | ${options.runtime.memoryBackend} |
| Neural Learning | ${options.runtime.enableNeural ? 'Enabled' : 'Disabled'} |
| Learning | ${options.runtime.enableLearningBridge ? 'Enabled' : 'Disabled'} |
| Agent Scopes | ${options.runtime.enableAgentScopes ? 'Enabled (project/local/user)' : 'Disabled'} |

---

## Swarm Orchestration

### Topologies
| Topology | Description | Best For |
|----------|-------------|----------|
| \`hierarchical\` | Queen controls workers directly | Anti-drift, tight control |
| \`mesh\` | Fully connected peer network | Distributed tasks |
| \`hierarchical-mesh\` | V1 hybrid (recommended) | 10+ agents |
| \`ring\` | Circular communication | Sequential workflows |
| \`star\` | Central coordinator | Simple coordination |
| \`adaptive\` | Dynamic based on load | Variable workloads |

### Strategies
- \`balanced\` - Even distribution across agents
- \`specialized\` - Clear roles, no overlap (anti-drift)
- \`adaptive\` - Dynamic task routing

### Quick Commands
\`\`\`bash
# Initialize swarm
npx monomind@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized

# Check status
npx monomind@latest swarm status

# Monitor activity
npx monomind@latest swarm monitor
\`\`\`

---

## Available Agents

### Core Development (5)
\`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`

### V1 Specialized (1)
\`security-architect\`

### Swarm Coordination (3)
\`mesh-coordinator\`, \`collective-intelligence-coordinator\`, \`swarm-memory-manager\`

### Consensus & Distributed (5)
\`byzantine-coordinator\`, \`raft-manager\`, \`consensus-builder\`, \`quorum-manager\`, \`security-manager\`

### Performance & Optimization (5)
\`perf-analyzer\`, \`performance-benchmarker\`, \`task-orchestrator\`, \`memory-coordinator\`, \`smart-agent\`

### GitHub & Repository (9)
\`github-modes\`, \`pr-manager\`, \`code-review-swarm\`, \`issue-tracker\`, \`release-manager\`, \`workflow-automation\`, \`project-board-sync\`, \`repo-architect\`, \`multi-repo-swarm\`

### Specialized Development (8)
\`backend-dev\`, \`mobile-dev\`, \`ml-developer\`, \`cicd-engineer\`, \`api-docs\`, \`system-architect\`, \`code-analyzer\`, \`base-template-generator\`

### Testing & Validation (2)
\`tdd-london-swarm\`, \`production-validator\`

### Agent Routing by Task
| Task Type | Recommended Agents | Topology |
|-----------|-------------------|----------|
| Bug Fix | researcher, coder, tester | mesh |
| New Feature | coordinator, architect, coder, tester, reviewer | hierarchical |
| Refactoring | architect, coder, reviewer | mesh |
| Performance | researcher, perf-engineer, coder | hierarchical |
| Security | security-architect, auditor, reviewer | hierarchical |
| Docs | researcher, api-docs | mesh |

---

## CLI Commands

### Core Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`init\` | 5 | Project initialization |
| \`agent\` | 7 | Agent lifecycle management |
| \`swarm\` | 6 | Multi-agent coordination |
| \`memory\` | 12 | SQLite with ANN vector search |
| \`mcp\` | 9 | MCP server management |
| \`task\` | 5 | Task assignment |
| \`session\` | 6 | Session persistence |
| \`config\` | 7 | Configuration |
| \`status\` | 3 | System monitoring |
| \`hooks\` | 29 | Self-learning hooks + 8 background workers${hooksAvailable ? '' : ' (background workers unavailable in this install)'} |

> Note: there is no \`hive-mind\`, \`workflow\`, \`neural\`, \`embeddings\`, \`claims\`, \`migrate\`, or \`process\` CLI command.
> Hive-Mind consensus (byzantine/raft/quorum) is available exclusively via MCP tools, not the CLI.
> Neural pattern learning was merged into \`hooks intelligence\`.

### Advanced Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`security\` | 6 | Security scanning |
| \`performance\` | 4 | Profiling & benchmarks |
| \`providers\` | 4 | AI provider config |
| \`guidance\` | 1 | Governance gate setup |
| \`doctor\` | 1 | Health diagnostics |
| \`completions\` | 4 | Shell completions |

### Example Commands
\`\`\`bash
# Initialize
npx monomind@latest init --wizard

# Spawn agent
npx monomind@latest agent spawn -t coder --name my-coder

# Memory operations
npx monomind@latest memory store --key "pattern" --value "data" --namespace patterns
npx monomind@latest memory search --query "authentication"

# Diagnostics
npx monomind@latest doctor --fix
\`\`\`

---

## Hooks System

### 29 Available Hook Subcommands${hooksAvailable ? '' : ' — background workers unavailable in this install (@monoes/hooks did not resolve)'}

#### Core Hooks (6)
| Hook | Description |
|------|-------------|
| \`pre-edit\` | Context before file edits |
| \`post-edit\` | Record edit outcomes |
| \`pre-command\` | Risk assessment |
| \`post-command\` | Command metrics |
| \`pre-task\` | Task start + agent suggestions |
| \`post-task\` | Task completion learning |

#### Session Hooks (4)
| Hook | Description |
|------|-------------|
| \`session-start\` | Start/restore session |
| \`session-end\` | Persist state |
| \`session-restore\` | Restore previous |
| \`notify\` | Cross-agent notifications |

#### Intelligence Hooks (4)
| Hook | Description |
|------|-------------|
| \`route\` | Optimal agent routing |
| \`explain\` | Routing decisions |
| \`pretrain\` | Bootstrap intelligence |
| \`transfer\` | Pattern transfer |

#### Coverage Hooks (3)
| Hook | Description |
|------|-------------|
| \`coverage-route\` | Coverage-based routing |
| \`coverage-suggest\` | Improvement suggestions |
| \`coverage-gaps\` | Gap analysis |

### 8 Background Workers (@monoes/hooks, run in-process)
| Worker | Priority | Purpose |
|--------|----------|---------|
| \`performance\` | normal | Benchmark performance |
| \`health\` | high | System health monitoring |
| \`swarm\` | high | Swarm activity monitoring |
| \`git\` | normal | Branch/change tracking |
| \`learning\` | normal | Learning optimization |
| \`adr\` | low | ADR compliance |
| \`ddd\` | low | DDD progress |
| \`security\` | high | Secret/vulnerability scan |
| \`patterns\` | normal | Pattern consolidation |
| \`cache\` | background | Cache cleanup |
| \`progress\` | normal | Progress tracking |
| \`map\` | normal | Codebase mapping |
| \`audit\` | high | Security audit metrics |
| \`consolidate\` | low | Memory consolidation |

Metrics-producing workers (ddd, map, audit, consolidate) refresh at
session start when their output is >6h old; run on demand with
\`monomind hooks worker run <name>\`.

---

## Memory & Intelligence

### Intelligence System
- **Keyword routing**: Deterministic task→agent routing with outcome measurement
- **ANN pattern search**: Indexed vector search via SQLite
- **ReasoningBank**: Stores learned patterns and trajectories for retrieval
- **Int8 Quantization**: ~4x memory reduction for stored embeddings

Routing and learning are JS-only — no native neural engine is required. Route
and command outcomes are recorded and scored so routing quality is measured.

### Self-Learning Memory (ADR-049)

| Component | Status | Description |
|-----------|--------|-------------|
| **Learning** | ${options.runtime.enableLearningBridge ? '✅ Enabled' : '⏸ Disabled'} | Connects insights to the pattern store |
| **AgentMemoryScope** | ${options.runtime.enableAgentScopes ? '✅ Enabled' : '⏸ Disabled'} | 3-scope agent memory (project/local/user) |

**Learning** — Insights trigger learning trajectories. Confidence evolves: +0.03 on access, -0.005/hour decay.

**AgentMemoryScope** - Maps Claude Code 3-scope directories:
- \`project\`: \`<gitRoot>/.claude/agent-memory/<agent>/\`
- \`local\`: \`<gitRoot>/.claude/agent-memory-local/<agent>/\`
- \`user\`: \`~/.claude/agent-memory/<agent>/\`

High-confidence insights (>0.8) can transfer between agents.

### Memory Commands
\`\`\`bash
# Store pattern
npx monomind@latest memory store --key "name" --value "data" --namespace patterns

# Semantic search
npx monomind@latest memory search --query "authentication"

# List entries
npx monomind@latest memory list --namespace patterns

# Initialize database
npx monomind@latest memory init --force
\`\`\`

---

## Hive-Mind Consensus

> **Experimental, MCP-only.** There is no \`hive-mind\` CLI command — this is
> single-process vote counting exposed exclusively via MCP tools
> (\`hive-mind-tools.ts\`), not distributed networking. Reach it through the
> MCP server (\`npx monomind@latest mcp start\`) once connected to an MCP client.

### Queen Types
| Type | Role |
|------|------|
| Strategic Queen | Long-term planning |
| Tactical Queen | Execution coordination |
| Adaptive Queen | Dynamic optimization |

### Worker Types (8)
\`researcher\`, \`coder\`, \`analyst\`, \`tester\`, \`architect\`, \`reviewer\`, \`optimizer\`, \`documenter\`

### Consensus Mechanisms
| Mechanism | Fault Tolerance | Status |
|-----------|-----------------|--------|
| \`byzantine\` / \`bft\` | f < n/3 faulty | Implemented (vote counting) |
| \`raft\` | f < n/2 failed | Implemented (vote counting) |
| \`quorum\` | Configurable | Implemented |
| \`gossip\` | Eventually consistent | Planned — not implemented, rejected by \`hive_mind_init\` |
| \`crdt\` | Conflict-free | Planned — not implemented, rejected by \`hive_mind_init\` |

---

## Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| ANN Search | Indexed vector search | ✅ Implemented (SQLite) |
| Memory Reduction | 50-75% | ✅ Implemented (~4x via Int8 quantization) |
| Pattern Learning | Recorded + retrievable | ✅ Implemented (ReasoningBank) |
| MCP Response | <100ms | ✅ Achieved |
| CLI Startup | <500ms | ✅ Achieved |
| Graph Build (1k) | <200ms | ✅ 2.78ms (71.9x headroom) |
| PageRank (1k) | <100ms | ✅ 12.21ms (8.2x headroom) |
| Insight Recording | <5ms/each | ✅ 0.12ms (41x headroom) |
| Consolidation | <500ms | ✅ 0.26ms (1,955x headroom) |
| Knowledge Transfer | <100ms | ✅ 1.25ms (80x headroom) |

---

## Integration Ecosystem

### Integrated Packages
| Package | Version | Purpose |
|---------|---------|---------|
| better-sqlite3 (sql.js WASM fallback) | latest | SQLite vector database (ANN search) |

### Optional Integrations
| Package | Command |
|---------|---------|
| agentic-jujutsu | \`npx agentic-jujutsu@latest\` |

### MCP Server Setup
\`\`\`bash
# Add Monomind MCP
claude mcp add monomind -- npx -y monomind@latest mcp start
\`\`\`

---

## Quick Reference

### Essential Commands
\`\`\`bash
# Setup
npx monomind@latest init --wizard
npx monomind@latest doctor --fix

# Swarm
npx monomind@latest swarm init --topology hierarchical --max-agents 8
npx monomind@latest swarm status

# Agents
npx monomind@latest agent spawn -t coder
npx monomind@latest agent list

# Memory
npx monomind@latest memory search --query "patterns"

# Hooks
npx monomind@latest hooks pre-task --description "task"
npx monomind@latest hooks worker run map
\`\`\`

### File Structure
\`\`\`
.monomind/
├── config.yaml      # Runtime configuration
├── CAPABILITIES.md  # This file
├── data/            # Memory storage
├── logs/            # Operation logs
├── sessions/        # Session state
├── hooks/           # Custom hooks
├── agents/          # Agent configs
└── workflows/       # Workflow templates
\`\`\`

---

**Full Documentation**: https://github.com/monoes/monomind
**Issues**: https://github.com/monoes/monomind/issues
`;

  atomicWriteFile(capabilitiesPath, capabilities);
  result.created.files.push('.monomind/CAPABILITIES.md');
}
