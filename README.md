<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/mascot.png" alt="Monomind Mascot" width="160" />
</p>

<h1 align="center">Monomind</h1>

<p align="center">
  <strong>The autonomous Claude Code orchestration layer.</strong><br/>
  Research → Build → Review → Repeat. While you sleep.
</p>

<p align="center">
  <a href="https://monoes.github.io/monomind/"><img src="https://img.shields.io/badge/docs-monoes.github.io%2Fmonomind-00D2AA?style=flat-square" alt="Docs" /></a>
  <a href="https://www.npmjs.com/package/monomind"><img src="https://img.shields.io/npm/v/monomind?color=%2300D2AA&label=monomind&style=flat-square" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/monomind"><img src="https://img.shields.io/npm/dm/monomind?color=%2310B981&style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/monoes/monomind/stargazers"><img src="https://img.shields.io/github/stars/monoes/monomind?color=%23F59E0B&style=flat-square" alt="stars" /></a>
  <a href="https://github.com/monoes/monomind/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-%238B5CF6?style=flat-square" alt="license" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" alt="node" /></a>
</p>

<p align="center">
  <a href="https://monoes.github.io/monomind/">📖 Docs</a> &nbsp;·&nbsp;
  <a href="#quickstart">Quickstart</a> &nbsp;·&nbsp;
  <a href="#what-it-does">What It Does</a> &nbsp;·&nbsp;
  <a href="#commands">Commands</a> &nbsp;·&nbsp;
  <a href="#packages">Packages</a> &nbsp;·&nbsp;
  <a href="https://github.com/monoes/monomind">GitHub</a>
</p>

---

## What is Monomind?

You already use Claude Code. Monomind makes it **autonomous**.

Give it a direction. Walk away. Come back to a finished feature.

```bash
/mastermind:autodev --tillend --focus security
```

Monomind researches your project, selects the highest-impact improvement, builds it with a coordinated agent chain, reviews until zero findings — then loops. Indefinitely. Until there is nothing left to fix.

```
Without Monomind   You prompt Claude → wait → review → iterate manually
With Monomind      You set a direction → Monomind executes the entire loop
```

---

## Quickstart

```bash
# Install globally
npm install -g monomind

# Initialise in your project
cd your-project
monomind init

# Wire into Claude Code as an MCP server
claude mcp add monomind npx monomind mcp start

# Start the background daemon
monomind daemon start
```

Open Claude Code and run your first autonomous loop:

```bash
/mastermind:autodev --tillend
```

**[→ Full setup guide](https://monoes.github.io/monomind/#getting-started)**

---

## What It Does

### `/mastermind:autodev` — The Autonomous Build Loop

```
Phase 1  Research    Parallel scan: git log, file analysis, TODO/FIXME grep,
                     monograph god nodes, memory search for prior work.
                     Returns ranked list of 3–5 improvement candidates.

Phase 2  Select      Picks by feasibility × blast-radius × focus alignment.
                     Stores selection to AgentDB. Avoids repeating past work.

Phase 3  Build       Spawns architect → coder → tester → reviewer chain.
                     Runs with concrete spec and acceptance criteria.

Phase 4  Review      Code Reviewer + Security Engineer + Reality Checker
                     run in parallel. Auto-fixes. Repeats up to 5× until clean.

Phase 5  Loop        Records completion. Continues to next improvement.
                     --tillend loops until zero findings remain.
```

### Swarm Topologies

```
Hierarchical   Coordinator → specialists → reviewers. Best for features.
Mesh           All-to-all communication. Best for codebase analysis.
Adaptive       Changes topology based on task complexity.
Hive-Mind      Byzantine fault-tolerant consensus across 6+ agents.
```

### Memory & Intelligence

Every session writes to [AgentDB](https://github.com/monoes/monomind) — a hybrid SQLite + HNSW vector store. The next session reads it. Monomind learns which improvements it already shipped, which patterns failed, and which agents perform best on which tasks.

---

## Commands

### Core Loop Commands

| Command | What it does |
|---|---|
| `/mastermind:autodev` | Autonomous research → build → review loop |
| `/mastermind:autodev --tillend` | Loops until zero findings remain |
| `/mastermind:build` | Build a feature from a brief |
| `/mastermind:review` | Iterative code review until clean |
| `/mastermind:debug` | Systematic root-cause debugging |
| `/mastermind:tdd` | Test-Driven Development: Red→Green→Refactor |
| `/mastermind:plan` | Write a comprehensive implementation plan |

### Research & Ideas

| Command | What it does |
|---|---|
| `/mastermind:research` | Deep research with structured output |
| `/mastermind:idea` | Idea generation and evaluation |
| `/mastermind:architect` | Architecture review and design |
| `/mastermind:techport` | Assess a foreign codebase |

### Autonomous Orgs

```bash
/mastermind:createorg --schedule 1h   # define + schedule an agent org
/mastermind:runorg                    # start the loop
/mastermind:orgs                      # list all orgs + status
/mastermind:stoporg                   # stop a running org
```

### Business Domains

```bash
/mastermind:marketing    /mastermind:content    /mastermind:sales
/mastermind:finance      /mastermind:ops        /mastermind:release
```

**[→ Full command reference (80+ commands)](https://monoes.github.io/monomind/#slash)**

---

## CLI

```bash
monomind init                   # project setup wizard
monomind daemon start           # start background workers
monomind agent spawn <type>     # spawn a named agent
monomind swarm init             # initialise a multi-agent swarm
monomind memory store           # store to AgentDB
monomind memory search          # semantic search over AgentDB
monomind hooks pre-task         # run pre-task security scan
monomind doctor                 # diagnose your setup
```

---

## Packages

| Package | npm | Purpose |
|---|---|---|
| `monomind` | [![npm](https://img.shields.io/npm/v/monomind?style=flat-square&color=00D2AA)](https://www.npmjs.com/package/monomind) | Umbrella — install this |
| `@monoes/monomindcli` | [![npm](https://img.shields.io/npm/v/@monoes/monomindcli?style=flat-square&color=4F46E5)](https://www.npmjs.com/package/@monoes/monomindcli) | CLI engine (41 commands) |
| `monofence-ai` | [![npm](https://img.shields.io/npm/v/monofence-ai?style=flat-square&color=EF4444)](https://www.npmjs.com/package/monofence-ai) | AI manipulation defence |
| `@monoes/monograph` | [![npm](https://img.shields.io/npm/v/@monoes/monograph?style=flat-square&color=F59E0B)](https://www.npmjs.com/package/@monoes/monograph) | Knowledge graph engine |

### monofence-ai — AI Security

Protect your LLM pipelines from prompt injection, jailbreaks, and evasion attacks:

```typescript
import { isSafe, createMonoDefence } from 'monofence-ai';

isSafe('Ignore all previous instructions');  // → false (~0.04ms)

const fence = createMonoDefence({ enableContextTracking: true });
const result = await fence.detect(userInput);
// result.safe, result.threats, result.overallRisk
```

Features: **EvasionDetector** (homoglyphs, leetspeak, base64) · **ContextTracker** (multi-turn escalation) · **OutputScanner** (PII leakage, echo attacks) · **Allowlist** (5 built-in + custom rules) · **SecurityHook** (pre-task blocking)

---

## How the Agents Work

```
Claude Code  ←→  MCP Server  ←→  Monomind Daemon
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
               AgentDB           Monograph          Hooks
            (vector memory)   (knowledge graph)   (17 hook types)
                    │                 │                 │
                    └─────────────────┼─────────────────┘
                                      ▼
                              Agent Swarm
                    architect · coder · tester · reviewer
                    security · perf · docs · researcher
```

Monomind coordinates. Claude Code creates. You ship.

---

## Why Monomind?

- **80+ slash commands** wired directly into Claude Code
- **60+ agent types** for every engineering task
- **Self-learning routing** — agents improve with every session
- **Monograph** — full codebase knowledge graph, always fresh
- **AgentDB** — hybrid SQLite + HNSW vector memory
- **17 hook types** — pre/post edit, task, command, session
- **Security layer** — monofence-ai defends every agent boundary
- **One command** to set direction. Nothing else needed.

---

## Resources

- 📖 [Documentation](https://monoes.github.io/monomind/)
- 🐛 [Issues](https://github.com/monoes/monomind/issues)
- 💬 [Discussions](https://github.com/monoes/monomind/discussions)
- 📦 [Changelog v1.11](https://github.com/monoes/monomind/blob/main/CHANGELOG-v1.11.md)

---

<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/mascot.png" alt="Monomind" width="80" /><br/>
  <sub>Built with ♥ by <a href="https://github.com/monoes">monoes</a> · MIT License</sub>
</p>
