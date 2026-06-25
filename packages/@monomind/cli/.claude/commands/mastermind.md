---
name: mastermind
description: Swarm & Hive-Mind architecture picker — presents all topologies, consensus protocols, and strategies, then gives one concrete recommendation for the current task
---

IMPORTANT: Do NOT dump all the reference content at once. Follow the two-phase flow below exactly.

**If $ARGUMENTS is non-empty**, treat it as the user's task description and skip Phase 1 — go straight to Phase 2 with that description.

---

## Phase 1 — Present the picker and STOP

Output this menu and WAIT for the user's reply before doing anything else:

---

**MASTERMIND — Swarm & Hive-Mind Picker**

Describe your task and I'll recommend the right mode, or pick directly from the options below.

### Swarm Topologies
| # | Topology | Shape | Best for |
|---|---|---|---|
| **1** | `hierarchical` | One coordinator → all workers | Feature dev, bug fixes, most coding tasks |
| **2** | `mesh` | Every agent ↔ every agent | Research, brainstorming, docs |
| **3** | `hierarchical-mesh` | Queen + peer lanes | Large projects, 10–15 agents |
| **4** | `ring` | Agent → next → next → loop | Pipelines: research→draft→edit→review |
| **5** | `star` | Hub aggregates independent workers | Parallel analysis, test coverage |
| **6** | `adaptive` | Starts hierarchical, self-reconfigures | Long-running or unknown workloads |

### Hive-Mind Modes
| # | Mode | Consensus | Best for |
|---|---|---|---|
| **7** | `hive-mind hierarchical-mesh` | `byzantine` | Security-critical, fault-tolerant (f < n/3) |
| **8** | `hive-mind hierarchical` | `raft` | Refactors, rewrites — leader keeps authoritative state |
| **9** | `hive-mind mesh` | `gossip` | Large agent counts, eventual consistency |
| **10** | `hive-mind hierarchical-mesh` | `crdt` | Concurrent writes, collaborative editing |
| **11** | `hive-mind adaptive` | `quorum` | Custom fault-tolerance, majority vote |

> Type a number (1–11), or just **describe what you want to build** and I'll pick for you.

---

## Phase 2 — Give a concrete recommendation

Based on the task or user choice, pick ONE mode and output EXACTLY this structure:

---

**Your Plan**

- **Mode:** `<swarm|hive-mind>` · `<topology>` — <one sentence why>
- **Agents:** <N> · <list agent types>
- **Consensus:** `<protocol>` — <one sentence why>
- **Strategy:** `<specialized|balanced|pipeline|parallel>` _(swarm only)_

**Launch command:**
```bash
# Swarm:
npx monomind swarm init --topology <topology> --max-agents <N> --strategy <strategy>

# OR Hive-Mind (no --strategy flag):
npx monomind hive-mind init --topology <topology> --consensus <protocol> --max-agents <N>
```

**Agent team:**
```
coordinator  → plans and delegates
<agent>      → <role>
<agent>      → <role>
...
```

**Then spawn in Claude Code (one message):**
```javascript
// Bash: init the swarm/hive-mind first (above command)
// Then Task tool calls — all in the same message:
Task({ subagent_type: "coordinator", description: "...", run_in_background: true })
Task({ subagent_type: "<agent>",     description: "...", run_in_background: true })
// ... one Task call per agent
```

> Ready? Say **go** and I'll launch it, or adjust any detail first.

---

## Recommendation Logic (internal — do not output)

Use this to pick the right mode when the user describes a task:

| Task type | Mode | Topology | Consensus | Agents | Strategy |
|---|---|---|---|---|---|
| Bug fix (1–2 files) | swarm | hierarchical | raft | 4 | specialized |
| Feature (3+ files) | swarm | hierarchical | raft | 6–8 | specialized |
| Refactor / migration | swarm | hierarchical | raft | 5–6 | specialized |
| Performance optimization | swarm | star | raft | 4–5 | parallel |
| Security audit / fix | hive-mind | hierarchical-mesh | byzantine | 6 | specialized |
| Research / docs | swarm | mesh | gossip | 4–6 | balanced |
| Docs pipeline | swarm | ring | raft | 4 | pipeline |
| Testing / coverage | swarm | star | raft | 5–6 | parallel |
| Architecture design | swarm | hierarchical-mesh | raft | 8–10 | specialized |
| Full release (end-to-end) | hive-mind | hierarchical-mesh | byzantine | 12–15 | specialized |
| Long-running / unknown | swarm | adaptive | raft | 8–10 | specialized |
| Refactor with rollback safety | hive-mind | hierarchical | raft | 5–6 | specialized |
| Concurrent collaborative writes | hive-mind | hierarchical-mesh | crdt | 4–6 | balanced |
| Large-scale eventual consistency (20+ agents) | hive-mind | mesh | gossip | 15–20 | balanced |
| Custom fault-tolerance / majority vote | hive-mind | adaptive | quorum | 8–12 | specialized |

**Quick decision rule:**
- 1 file → use Edit tool directly, no swarm needed
- 2–3 files, clear scope → swarm hierarchical, 4–6 agents, raft
- Security/fault-critical → hive-mind hierarchical-mesh, byzantine
- Research/exploration → swarm mesh, gossip
- Pipeline stages (A→B→C) → swarm ring
- Parallel independent work → swarm star
- 10+ agents or long-running → hierarchical-mesh or adaptive
- Refactor needing authoritative rollback → hive-mind hierarchical, raft
- Concurrent collaborative writes → hive-mind hierarchical-mesh, crdt
- Large agent pool (20+), eventual consistency → hive-mind mesh, gossip
- Custom fault-tolerance threshold → hive-mind adaptive, quorum
