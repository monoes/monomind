/**
 * CAPABILITIES.md writer — comprehensive overview of all Monomind features.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { agentCommand } from '../commands/agent.js';
import { completionsCommand } from '../commands/completions.js';
import { configCommand } from '../commands/config.js';
import { doctorCommand } from '../commands/doctor.js';
import { guidanceCommand } from '../commands/guidance.js';
import { hooksCommand } from '../commands/hooks.js';
import { initCommand } from '../commands/init.js';
import { mcpCommand } from '../commands/mcp.js';
import { memoryCommand } from '../commands/memory.js';
import { monoswarmCommand } from '../commands/monoswarm.js';
import { performanceCommand } from '../commands/performance.js';
import { providersCommand } from '../commands/providers.js';
import { securityCommand } from '../commands/security.js';
import { sessionCommand } from '../commands/session.js';
import { statusCommand } from '../commands/status.js';
import { taskCommand } from '../commands/task.js';
import { HONEST_MONOSWARM_SENTENCE } from './claudemd-generator.js';
import { WORKER_COUNT, WORKER_ROWS } from './generated-counts.js';
import {
  _isOptionalPackageResolvable,
  atomicWriteFile,
  mergeGeneratedBlock,
  subcommandCount,
  workerTableRows,
} from './shared.js';
import type { InitOptions, InitResult } from './types.js';

/**
 * Write CAPABILITIES.md - comprehensive overview of all Monomind features
 */
export async function writeCapabilitiesDoc(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): Promise<void> {
  const capabilitiesPath = path.join(targetDir, '.monomind', 'CAPABILITIES.md');
  const exists = fs.existsSync(capabilitiesPath);

  if (exists && !options.force) {
    result.skipped.push('.monomind/CAPABILITIES.md');
    return;
  }

  const hooksAvailable = _isOptionalPackageResolvable('@monoes/hooks');

  const capabilities = `# Monomind - Complete Capabilities Reference
> Full documentation: https://github.com/monoes/monomind

## 📋 Table of Contents

1. [Overview](#overview)
2. [Monoswarm Orchestration](#monoswarm-orchestration)
3. [Available Agents (60+)](#available-agents)
4. [CLI Commands](#cli-commands)
5. [Hooks System (${subcommandCount(hooksCommand)} Hook Subcommands${hooksAvailable ? ` + ${WORKER_COUNT} Background Workers` : ''})](#hooks-system)
6. [Memory & Intelligence](#memory--intelligence)
7. [Monoswarm Vote Strategies](#monoswarm-vote-strategies)
8. [Performance Targets](#performance-targets)
9. [Integration Ecosystem](#integration-ecosystem)

---

## Overview

Monomind is a domain-driven design architecture for multi-agent AI coordination with:

- **15-Agent Monoswarm Coordination** with hierarchical and mesh topologies
- **ANN Vector Search** - indexed pattern retrieval via SQLite (better-sqlite3, sql.js WASM fallback)
- **Keyword Routing** - deterministic task→agent routing with outcome measurement
- **Vote-Threshold Consensus** - majority/supermajority/unanimous/threshold decisions
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

## Monoswarm Orchestration

${HONEST_MONOSWARM_SENTENCE}

### Topologies
| Topology | Description | Best For |
|----------|-------------|----------|
| \`hierarchical\` | Coordinator controls workers directly | Anti-drift, tight control |
| \`mesh\` | Fully connected peer network | Parallel, independent tasks |
| \`hierarchical-mesh\` | Hybrid (recommended) | 10+ agents |
| \`ring\` | Circular communication | Sequential workflows |
| \`star\` | Central coordinator | Simple coordination |
| \`adaptive\` / \`hybrid\` | Caller-interpreted label — no automatic reconfiguration | Variable workloads |

### Strategies
- \`balanced\` - Even distribution across agents
- \`specialized\` - Clear roles, no overlap (anti-drift)
- \`adaptive\` - Dynamic task routing

### Quick Commands
\`\`\`bash
# Initialize monoswarm
npx monomind monoswarm init --topology hierarchical --max-agents 8 --strategy specialized

# Check status
npx monomind monoswarm status

# Monitor activity
npx monomind monoswarm monitor
\`\`\`

---

## Available Agents

The full roster ships as \`.claude/agents/**/*.md\` and differs per install, so
this file does not list it. Pick agents per task:

- When a prompt carries a \`[PICK]\` line (\`[PICK] agent: <name> · skill: <invoke>\`), use that agent/skill unless it is clearly wrong.
- Otherwise call \`mcp__monomind__pick\` (\`{ task, kind: "agents" | "skills" | "both" }\`) and use a returned agent \`name\` as the Task \`subagent_type\`; without MCP, run \`monomind pick -t "<task>"\`.

Fallback when picking returns nothing — real core agents:
\`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`, \`system-architect\`, \`Security Engineer\`, \`mesh-coordinator\`

---

## CLI Commands

### Core Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`init\` | ${subcommandCount(initCommand)} | Project initialization |
| \`agent\` | ${subcommandCount(agentCommand)} | Agent lifecycle management |
| \`monoswarm\` | ${subcommandCount(monoswarmCommand)} | Multi-agent coordination |
| \`memory\` | ${subcommandCount(memoryCommand)} | SQLite with ANN vector search |
| \`mcp\` | ${subcommandCount(mcpCommand)} | MCP server management |
| \`task\` | ${subcommandCount(taskCommand)} | Task assignment |
| \`session\` | ${subcommandCount(sessionCommand)} | Session persistence |
| \`config\` | ${subcommandCount(configCommand)} | Configuration |
| \`status\` | ${subcommandCount(statusCommand)} | System monitoring |
| \`hooks\` | ${subcommandCount(hooksCommand)} | Self-learning hooks + ${hooksAvailable ? `${WORKER_COUNT} ` : ''}background workers${hooksAvailable ? '' : ' (background workers unavailable in this install)'} |

> Note: there is no \`workflow\`, \`neural\`, \`embeddings\`, \`claims\`, \`migrate\`, or \`process\` CLI command.
> Neural pattern learning was merged into \`hooks intelligence\`.

### Advanced Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`security\` | ${subcommandCount(securityCommand)} | Security scanning |
| \`performance\` | ${subcommandCount(performanceCommand)} | Profiling & benchmarks |
| \`providers\` | ${subcommandCount(providersCommand)} | AI provider config |
| \`guidance\` | ${subcommandCount(guidanceCommand)} | Governance gate setup |
| \`doctor\` | ${subcommandCount(doctorCommand)} | Health diagnostics — flat command, flags only (\`--component\` selects a category) |
| \`completions\` | ${subcommandCount(completionsCommand)} | Shell completions |

### Example Commands
\`\`\`bash
# Initialize
npx monomind init wizard

# Spawn agent
npx monomind agent spawn -t coder --name my-coder

# Memory operations
npx monomind memory store --key "pattern" --value "data" --namespace patterns
npx monomind memory search --query "authentication"

# Diagnostics
npx monomind doctor --fix
\`\`\`

---

## Hooks System

### ${subcommandCount(hooksCommand)} Available Hook Subcommands${hooksAvailable ? '' : ' — background workers unavailable in this install (@monoes/hooks did not resolve)'}

The four groups below are a curated highlight, not the full ${subcommandCount(hooksCommand)} — run \`monomind hooks --help\` for every subcommand.

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

### ${hooksAvailable ? `${WORKER_COUNT} ` : ''}Background Workers (@monoes/hooks, run in-process)${hooksAvailable ? '' : ' _(unavailable in this install)_'}
| Worker | Priority | Purpose |
|--------|----------|---------|
${workerTableRows(WORKER_ROWS)}

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
npx monomind memory store --key "name" --value "data" --namespace patterns

# Semantic search
npx monomind memory search --query "authentication"

# List entries
npx monomind memory list --namespace patterns

# Initialize database
npx monomind memory init --force
\`\`\`

---

## Monoswarm Vote Strategies

Reach monoswarm coordination through MCP tools (\`monoswarm_*\`) or the
\`npx monomind monoswarm\` CLI command. See \`doc/concepts/monoswarm.md\`
for the full picture.

### Agent Types (8)
\`researcher\`, \`coder\`, \`analyst\`, \`tester\`, \`architect\`, \`reviewer\`, \`optimizer\`, \`documenter\`

### Vote Strategies
| Strategy | Threshold |
|----------|-----------|
| \`majority\` | More than 50% of votes |
| \`supermajority\` | At least 2/3 of votes |
| \`unanimous\` | 100% of votes |
| \`threshold\` | Custom \`minVotes\` count |

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
claude mcp add monomind -- npx -y monomind mcp start
\`\`\`

---

## Quick Reference

### Essential Commands
\`\`\`bash
# Setup
npx monomind init wizard
npx monomind doctor --fix

# Monoswarm
npx monomind monoswarm init --topology hierarchical --max-agents 8
npx monomind monoswarm status

# Agents
npx monomind agent spawn -t coder
npx monomind agent list

# Memory
npx monomind memory search --query "patterns"

# Hooks
npx monomind hooks pre-task --description "task"
npx monomind hooks worker run map
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

  // Confine monomind's own generated body to a delimited block rather than
  // overwriting the whole file — same rationale and mechanism as
  // write-claude.ts's writeClaudeMd (GH #241): a full overwrite would
  // silently destroy hand-authored content outside anything monomind itself
  // wrote. This also applies on the very first write so a later `--force`
  // always refreshes just this block instead of duplicating the body.
  const existingContent = exists ? fs.readFileSync(capabilitiesPath, 'utf-8') : '';
  const merged = mergeGeneratedBlock(existingContent, 'capabilities', capabilities);
  // Skip the write entirely when nothing would actually change — the old
  // writer's `> Generated:` timestamp line made every --force rewrite the
  // file with a fresh stamp even when nothing else changed, leaving the repo
  // dirty by exactly this one file's mtime for information nobody could act
  // on (init-generated-timestamp-stability.test.ts). Removing that line
  // (i-041/i-117 trap 1) already makes `merged` byte-identical to
  // `existingContent` on a genuine no-op run; this guard is what turns that
  // byte-identity into an actual no-op write, preserving the mtime too.
  if (merged !== existingContent) {
    atomicWriteFile(capabilitiesPath, merged);
  }
  // i-035 reviewer MINOR 6: `exists` is already computed above — reporting
  // every write as "created" regardless was free to fix once that was true.
  if (exists) {
    result.updated.push('.monomind/CAPABILITIES.md');
  } else {
    result.created.files.push('.monomind/CAPABILITIES.md');
  }
}
