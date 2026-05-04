<p align="center">
  <img src="assets/hero-banner.png" alt="Monomind — AI Agent Orchestration" width="100%" />
</p>

<p align="center">
  <img src="assets/logo.png" alt="Monomind Logo" width="120" />
</p>

<h1 align="center">Monomind</h1>

<p align="center">
  <strong>The orchestration layer that turns Claude Code into an autonomous engineering team.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/monomind"><img src="https://img.shields.io/npm/v/monomind?color=%234F46E5&label=npm&style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/monomind"><img src="https://img.shields.io/npm/dm/monomind?color=%2310B981&style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/nokhodian/monomind/stargazers"><img src="https://img.shields.io/github/stars/nokhodian/monomind?color=%23F59E0B&style=flat-square" alt="stars" /></a>
  <a href="https://github.com/nokhodian/monomind/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-%238B5CF6?style=flat-square" alt="license" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square" alt="node" /></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> &nbsp;&bull;&nbsp;
  <a href="#what-monomind-does">What It Does</a> &nbsp;&bull;&nbsp;
  <a href="#features">Features</a> &nbsp;&bull;&nbsp;
  <a href="#agent-catalog">Agent Catalog</a> &nbsp;&bull;&nbsp;
  <a href="#swarm-orchestration">Swarms</a> &nbsp;&bull;&nbsp;
  <a href="#commands">Commands</a> &nbsp;&bull;&nbsp;
  <a href="#memory--intelligence">Memory</a>
</p>

---

## Why Monomind?

You already use Claude Code. Monomind makes it **10x more powerful**.

Instead of one AI assistant handling everything, Monomind coordinates **230+ specialized agents** — architects, security auditors, performance engineers, frontend developers, database optimizers — each with domain expertise, working in parallel swarms that review each other's work.

**The difference:**
- **Without Monomind:** You prompt Claude, it does its best across every domain.
- **With Monomind:** Claude spawns the *right specialist* for each subtask, coordinates them in fault-tolerant swarms, remembers everything across sessions, and learns from every interaction.

> One command. Entire engineering workflows. Zero babysitting.

---

## Quickstart

```bash
# Install globally
npm install -g monomind

# Initialize in any project
cd your-project
monomind init

# Add MCP server to Claude Code
claude mcp add monomind npx monomind@latest mcp start
```

That's it. Monomind is now active in your Claude Code sessions.

---

## Monomind Control — Live Dashboard

<p align="center">
  <img src="assets/dashboard-control.png" alt="Monomind Control Dashboard" width="100%" />
</p>

Real-time visibility into every project, session, agent, memory, route decision, and token spend — all in one terminal-native dashboard.

---

## What Monomind Does

### From Prompt to Production

Monomind turns high-level instructions into coordinated multi-agent execution:

```
You: "Add webhook delivery with retries and dead-letter queue"

Monomind:
  1. Routes to Software Architect → designs the system
  2. Spawns backend-dev → implements webhook dispatcher
  3. Spawns backend-dev → implements retry logic with exponential backoff
  4. Spawns Database Optimizer → designs dead-letter queue schema
  5. Spawns tester → writes integration tests
  6. Spawns Code Reviewer → reviews all changes
  7. Commits, reports, moves to next task
```

### Autonomous Task Pipelines

```bash
# Turn a spec into executable tasks, then run them
/monomind:createtask docs/specs/webhook-system.md

# Or let it generate ideas, evaluate, and execute
/monomind:idea add real-time collaboration to the editor

# Pick up tasks and execute them autonomously
/monomind:do
```

---

## Features

### 230+ Specialized Agents

Not generic "code assistants" — domain experts with targeted system prompts, each optimized for a specific class of work.

| Category | Count | Examples |
|---|---|---|
| **Engineering** | 23 | Backend Architect, Frontend Developer, Database Optimizer, Embedded Firmware Engineer, SRE |
| **Marketing** | 27 | SEO Specialist, TikTok Strategist, Content Creator, Growth Hacker, LinkedIn Content Creator |
| **Specialized** | 27 | Legal Compliance, Finance Tracker, Salesforce Architect, Document Generator, MCP Builder |
| **Game Dev** | 20 | Unity Architect, Unreal Systems Engineer, Godot Scripter, Roblox Systems Scripter |
| **Sales** | 8 | Deal Strategist, Sales Engineer, Pipeline Analyst, Outbound Strategist |
| **Design** | 8 | UI Designer, UX Researcher, Brand Guardian, Visual Storyteller |
| **Paid Media** | 7 | PPC Strategist, Ad Creative Strategist, Programmatic Buyer, Tracking Specialist |
| **Support** | 6 | Support Responder, Analytics Reporter, Study Abroad Advisor, Trend Researcher |
| **Product** | 5 | Product Manager, Sprint Prioritizer, UX Researcher, Experiment Tracker |
| **Academic** | 5 | Anthropologist, Historian, Psychologist, Geographer, Narratologist |
| **And more...** | 94+ | Consensus, Swarm Coordination, Neural, SPARC, Architecture, DevOps, Testing |

### Two-Stage LLM Routing

Monomind doesn't guess which agent to use — it **asks an LLM**.

```
Stage 1: "This task is about SEO optimization" → marketing domain
Stage 2: "Best fit in marketing: SEO Specialist" → spawns SEO Specialist
```

Runs in under 2 seconds via Haiku. Falls back to keyword scoring if the API is unavailable.

### Swarm Orchestration

Coordinate multiple agents working on the same problem:

| Topology | Best For |
|---|---|
| **Hierarchical** | Feature development — coordinator delegates to specialists |
| **Mesh** | Research — all agents share findings peer-to-peer |
| **Hierarchical-Mesh** | Complex projects — structured delegation with cross-talk |
| **Adaptive** | Unknown complexity — topology evolves based on task |

**Consensus protocols:** Raft (leader-based), Byzantine (fault-tolerant), Gossip (eventually consistent), CRDT (conflict-free), Quorum (majority vote).

<p align="center">
  <img src="assets/swarm-topology.png" alt="Swarm Topology" width="60%" />
</p>

```bash
# Let Monomind pick the best topology
/mastermind

# Or configure manually
monomind swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

### Self-Learning Memory

Every interaction makes Monomind smarter:

- **AgentDB** — Persistent vector memory with HNSW indexing (150x-12,500x faster search)
- **Knowledge Graph** — Full dependency mapping of your codebase via Graphify
- **Session Continuity** — Pick up exactly where you left off across sessions
- **Neural Patterns** — SONA learning adapts routing and agent behavior over time
- **Memory Palace** — Visual dashboard for exploring stored knowledge

<p align="center">
  <img src="assets/memory-palace.png" alt="Memory Palace — Browse memories, sessions, knowledge, and swarms" width="100%" />
</p>

### 17 Hooks + 12 Background Workers

Monomind hooks into every phase of your Claude Code workflow:

| Hook | What It Does |
|---|---|
| `pre-task` | Routes to the best agent before execution starts |
| `post-task` | Learns from outcomes, updates neural patterns |
| `pre-edit` | Validates changes against project conventions |
| `post-edit` | Indexes new code into the knowledge graph |
| `session-start` | Restores context, preloads relevant memory |
| `session-end` | Persists learnings, updates metrics |

**Background workers** handle: optimization, consolidation, prediction, auditing, documentation, refactoring, benchmarking, and test gap analysis — all running autonomously.

---

## Agent Catalog

### Development

| Agent | Specialty |
|---|---|
| `coder` | General implementation with TDD |
| `backend-dev` | APIs, databases, server-side logic |
| `Frontend Developer` | React, Vue, Angular, CSS systems |
| `mobile-dev` | React Native, iOS, Android |
| `Rapid Prototyper` | Fast MVPs and proof-of-concepts |
| `Solidity Smart Contract Engineer` | EVM, DeFi, gas optimization |
| `WeChat Mini Program Developer` | WXML/WXSS, WeChat ecosystem |
| `Embedded Firmware Engineer` | ESP32, ARM Cortex-M, FreeRTOS |
| `visionOS Spatial Engineer` | SwiftUI volumetric, Liquid Glass |

### Architecture & Quality

| Agent | Specialty |
|---|---|
| `Software Architect` | System design, DDD, architectural patterns |
| `Code Reviewer` | Correctness, security, performance review |
| `Security Engineer` | Threat modeling, vulnerability assessment |
| `Database Optimizer` | Schema design, query tuning, indexing |
| `SRE` | SLOs, error budgets, chaos engineering |

### Marketing & Growth

| Agent | Specialty |
|---|---|
| `SEO Specialist` | Technical SEO, content optimization |
| `TikTok Strategist` | Viral content, algorithm optimization |
| `LinkedIn Content Creator` | Thought leadership, professional content |
| `Growth Hacker` | Viral loops, conversion funnels |
| `Content Creator` | Multi-platform editorial calendars |

### Game Development

| Agent | Specialty |
|---|---|
| `Unity Architect` | ScriptableObjects, modular systems |
| `Unreal Systems Engineer` | C++/Blueprint, Nanite, Lumen |
| `Godot Gameplay Scripter` | GDScript 2.0, signal architecture |
| `Roblox Systems Scripter` | Luau, client-server, DataStore |

[See all 230 agents →](.claude/agents/)

---

## Swarm Orchestration

### How Swarms Work

<p align="center">
  <img src="assets/swarm-inspector.png" alt="Swarm Inspector — topology graph, agent roles, and communication logs" width="100%" />
</p>

```
/mastermind "implement authentication system with OAuth2, JWT, and role-based access"

Monomind recommends: Hierarchical swarm, 6 agents, Raft consensus

  Queen Coordinator
  ├── Software Architect    → designs auth architecture
  ├── backend-dev           → implements OAuth2 flow
  ├── backend-dev           → implements JWT + RBAC
  ├── Security Engineer     → audits for vulnerabilities
  ├── tester                → writes auth test suite
  └── Code Reviewer         → reviews everything before merge
```

### Anti-Drift Protection

Swarms don't just run — they **stay on track**:

- **Raft consensus** — Leader maintains authoritative state, prevents conflicting changes
- **Frequent checkpoints** — `post-task` hooks validate progress after every step
- **Shared memory namespace** — All agents in a swarm see the same context
- **Review cycles** — Code reviewer validates before any task is marked done

---

## Commands

### Slash Commands (Inside Claude Code)

| Command | What It Does |
|---|---|
| `/monomind:createtask <spec>` | Ingests a prompt, file, or folder → generates full implementation plan → creates self-contained tasks on monotask |
| `/monomind:idea <prompt>` | Research swarm generates ideas → PM evaluates → architect decomposes into tasks |
| `/monomind:do` | Picks up tasks, executes with assigned agents, reviews, fixes bugs, loops |
| `/mastermind` | Analyzes your task and recommends the optimal swarm topology |
| `/specialagent <task>` | Two-stage LLM routing to find the perfect specialist agent |

### CLI Commands

```bash
monomind agent spawn --type coder       # Spawn a specific agent
monomind agent list                      # List running agents
monomind swarm init                      # Initialize a swarm
monomind memory search "auth patterns"   # Search vector memory
monomind hooks route --task "fix bug"    # Route to best agent
monomind doctor --fix                    # Diagnose and fix issues
monomind daemon start                    # Start background workers
```

41 CLI commands across: agent management, swarm coordination, memory, sessions, hooks, neural training, security, performance profiling, and more.

### Session Inspector

Every session is recorded and browsable — tool calls, agent spawns, memory operations, and full conversation replay:

<p align="center">
  <img src="assets/session-detail.png" alt="Session Inspector — full conversation replay with tool breakdown" width="100%" />
</p>

---

## Memory & Intelligence

### Knowledge Graph (Monograph)

Monomind builds a full dependency graph of your codebase — automatically queried before every task:

```bash
# What files are relevant to my task?
monograph_suggest "add webhook retry logic"
# → returns ranked list of files with relevance scores

# What depends on UserService?
monograph_query "UserService dependencies"
# → returns file paths + line numbers

# Find the most connected files in the codebase
monograph_god_nodes
# → returns high-centrality internal files (external/test filtered out)
```

All monograph tools are called automatically by hooks and slash commands — you don't need to invoke them manually.

### Vector Memory (AgentDB + HNSW)

Every insight, pattern, and decision is stored in searchable vector memory:

- **150x-12,500x faster** than brute-force search via HNSW indexing
- **Hybrid backend** — SQLite for structured data, AgentDB for semantic search
- **Cross-session persistence** — context survives restarts

### Neural Learning (SONA)

Self-Optimizing Neural Adaptation learns from every task:

- Pattern recognition improves agent routing over time
- Trajectory tracking identifies what works and what doesn't
- Automatic model adaptation with <0.05ms overhead

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Monomind                            │
├──────────────┬──────────────┬──────────────┬───────────────┤
│   230+ Agents │  Swarm Engine │  Memory Layer │  Intelligence │
│              │              │              │               │
│  Specialized │  Hierarchical │  AgentDB     │  SONA Neural  │
│  agent defs  │  Mesh/Raft   │  HNSW Vector │  Pattern      │
│  + routing   │  consensus   │  Knowledge   │  Learning     │
│              │              │  Graph       │               │
├──────────────┴──────────────┴──────────────┴───────────────┤
│                     17 Hooks + 12 Workers                   │
├─────────────────────────────────────────────────────────────┤
│              MCP Server (stdio/http/websocket)              │
├─────────────────────────────────────────────────────────────┤
│                    Claude Code Runtime                      │
└─────────────────────────────────────────────────────────────┘
```

### Key Packages

| Package | Purpose |
|---|---|
| `@monomind/cli` | 41 commands, agent definitions, slash commands, hooks, MCP server |
| `@monomind/memory` | AgentDB with HNSW vector search |
| `@monomind/hooks` | 17 lifecycle hooks + 12 background workers |
| `@monomind/security` | Input validation, CVE remediation |
| `@monomind/guidance` | Governance control plane |

---

## Performance

| Metric | Result |
|---|---|
| Agent routing | <2s (LLM) / <5ms (keyword fallback) |
| Vector search | 150x-12,500x faster (HNSW) |
| SONA learning | <0.05ms per adaptation |
| Session restore | <500ms cold start |
| Memory reduction | 50-75% vs baseline |

---

## Who Uses Monomind?

Monomind is built for teams and individuals who use Claude Code for serious engineering work:

- **Solo developers** who want the power of a full engineering team
- **Startups** shipping features faster with autonomous agent pipelines
- **Enterprise teams** coordinating complex multi-module changes
- **Game studios** using specialized Unity/Unreal/Godot agents
- **Marketing teams** running content operations with domain-specific agents
- **Security teams** automating audit and compliance workflows

---

## Contributing

```bash
git clone https://github.com/nokhodian/monomind.git
cd monomind
pnpm install
monomind doctor --fix
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT License — See [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>Stop prompting. Start orchestrating.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/monomind">npm</a> &nbsp;&bull;&nbsp;
  <a href="https://github.com/nokhodian/monomind">GitHub</a> &nbsp;&bull;&nbsp;
  <a href="https://github.com/nokhodian/monomind/issues">Issues</a>
</p>
