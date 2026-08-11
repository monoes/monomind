# Graph Engineering Playbook — Monomind Adaptation Source of Truth

> **Origin:** "Graph Engineering for Multi-Agentic Systems" (Andrew Ng playbook, July 2026).
> **Purpose:** Canonical mapping of the playbook's concepts to monomind's org runtime, the gap
> analysis, and the implementation plan being executed. Every change made under this initiative
> must trace back to a row in the Implementation Plan table below.

---

## 1. The Playbook's Core Thesis

The playbook describes a progression in agentic AI engineering:

| Stage | Skill | What it controls | Key primitive |
|---|---|---|---|
| Prompt engineering | One model response | Instruction text | Prompt string |
| Loop engineering | One agent's behavior cycle | Trigger -> Act -> Verify -> Retry | Loop |
| **Graph engineering** | **The organization of multiple agents** | **Nodes (agents) + edges (dependencies)** | **Graph** |

> "Loops make agent behavior programmable. Graphs make agent organizations programmable."

Loops are subroutines. Graphs are programs.

---

## 2. The Seven Concepts

### 2.1 Two Graphs, Not One

Production multi-agent systems run **two distinct graphs** simultaneously:

- **Org Graph (structural, stable):** Long-lived agents with named roles, zone ownership,
  preserved memory. Stable edges. Redeployment changes the graph, not runtime.
- **Work Graph (dynamic, ephemeral):** Task nodes that exist only as long as the work exists.
  Dynamic edges that split when parallel paths open, merge when they converge, reorder when
  priorities shift, or disappear when evidence makes them unnecessary.

The org graph answers **who**. The work graph answers **what, right now**.

### 2.2 Dynamic Agent Orgs

The graph's own structure changes while work is happening:

| Trigger | Graph response |
|---|---|
| Task scope expands unexpectedly | Spawn new agent node, wire to existing graph |
| Parallel branches converge early | Collapse merger point, route output forward |
| Agent fails with unrecoverable error | Route to fallback node, flag upstream |
| New data source becomes available | Add tool access to existing node, rerun dependent branches |
| Priority shifts mid-execution | Reorder work graph edges, pause low-priority nodes |

### 2.3 Handoff Protocols

Structured context packages that translate across node boundaries without being repeated
in full each time. Missing an edge means a downstream agent acts without information it needed.

### 2.4 Work Graph Generators

Logic that takes an incoming task and produces the work graph — deciding which nodes to
spawn, what order to run them in, where parallelism is safe.

### 2.5 Graph Observability

Per-node tracing: which nodes ran, in what order, with what latency, and what the wall-clock
and token cost was per node. Divergence-from-plan metric.

### 2.6 Failure Recovery Rules

Rules for what the graph does when a node fails — retry the node, route to a fallback,
escalate to a human checkpoint, or abort the branch. Per-node, not just per-role.

### 2.7 Patterns

- **Advisor-Orchestrator:** Expensive planner/orchestrator node + cheap worker nodes.
  ~92% of solo quality at ~63% of the price.
- **Zone Defense:** Long-lived specialists each owning a stable domain with persistent context.
- **Multi-LLM Council:** Fixed-topology org graph with anti-groupthink deliberation gates.

---

## 3. Gap Analysis: Monomind vs. Playbook

| Playbook concept | Monomind has | Gap |
|---|---|---|
| Org Graph (stable roles) | `org-runtime` roles, `reports_to`, persistent sessions, `memory_namespace` | **Covered.** Strongest area. |
| Work Graph (dynamic tasks) | `TaskDag` (`task-dag.ts`) with add/complete/fail | Static once created. No split/merge/cancel based on runtime evidence. |
| Dynamic Agent Orgs | Roles lazy-spawned on first message | Cannot spawn new agent types mid-run. Cannot cancel branches when evidence changes. |
| Handoff protocols | `org_send` mailbox messages, OrgBus events | Messages are freeform text. No structured typed envelope schema. |
| Work graph generators | Boss agent decomposes tasks manually via prompt | No programmatic task->graph generation tool. |
| Graph observability | OrgBus logs 10 event types to `bus.jsonl` | No per-node latency/cost trace. No divergence-from-plan metric. No replay command. |
| Failure recovery per node | Boss crash recovery, `circuit_breaker` per role | No per-node routing (retry vs fallback vs escalate). |
| Advisor-Orchestrator | Mixed-runtime orgs possible | Not a first-class documented pattern. |
| Zone Defense | Roles own domains, accumulate context | **Covered.** |
| KG extraction pipeline | `memory_kg_ingest` single-agent | No coordinated multi-agent pipeline. |

---

## 4. Implementation Plan

Each row is a unit of work. Status moves pending -> in-progress -> done as the change lands
and its tests pass.

| # | Improvement | File(s) | Status |
|---|---|---|---|
| 1 | Dynamic TaskDag: `split()` / `merge()` / `cancel()` | `task-dag.ts` | **done** |
| 2 | Structured Handoff Protocol (`OrgHandoff` interface) | `types.ts` | **done** |
| 3 | Per-node failure routing (`failure_routing` config) | `types.ts`, `daemon.ts` | **done** |
| 4 | Graph observability: `trace` bus event type + per-node timing | `types.ts`, `bus.ts` | **done** |
| 5 | Work graph generator: `org_plan_graph` tool | `session.ts`, `decisions.ts` | **done** |
| 6 | Wire new TaskDag ops into agent tools (`org_task_split` etc.) | `session.ts`, `daemon.ts` | **done** |
| 7 | Multi-agent KG extraction org template + advisor-orchestrator template | `templates.ts` | **done** |

**Explicitly deferred** (high complexity, low immediate value):
- Dynamic node spawning mid-run (new agent types not in the org config).
- Neo4j or external graph DB (SQLite-backed Monograph + memory KG is sufficient).

---

## 5. Verification Gates

Every change under this initiative must pass:

1. **Unit tests** — new behavior covered by vitest tests in `tests/orgrt/`.
2. **No regressions** — `npm test` stays green.
3. **Build succeeds** — `npm run build` produces clean output.
4. **Lint clean** — `npm run lint` reports no new violations.
5. **Versioning** — patch digit only (`2.9.3` -> `2.9.4` -> ...), per project policy.

---

## 6. Sources

- Playbook PDF (binary-corrupted in fetch; concepts recovered from secondary sources):
  `https://casys.ai/downloads/graph-engineering-multi-agentic-systems-playbook.pdf`
- explainx.ai deep dive: `https://www.explainx.ai/blog/graph-engineering-ai-agents-multi-agent-organizations-2026`
- Graphs-vs-loops untangled: `https://www.explainx.ai/blog/graphs-vs-loops-agentic-ai-debate-linear-andrew-ng-2026`
- Ng's DeepLearning.AI knowledge graph course (Andreas Kollegger, Neo4j), July 2026.
