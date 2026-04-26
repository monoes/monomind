# Swarm Tab Redesign — History, Topology & Agent Detail

**Date:** 2026-04-27
**Status:** Approved

## Overview

Redesign the Memory Palace Swarm tab from a single-state topology viewer into a three-level drill-down: swarm run history list → session topology + agent list → agent detail with communication log. Mirrors the Sessions tab pattern (left sidebar + right detail panel).

## Prerequisites

- Existing dashboard at `packages/@monomind/cli/dist/src/ui/dashboard.html`
- Existing server at `packages/@monomind/cli/dist/src/ui/server.mjs`
- Existing collector at `packages/@monomind/cli/dist/src/ui/collector.mjs`
- Swarm state tracked in `.swarm/state.json` and `.monomind/swarm/swarm-state.json`

## Data Layer

### Swarm History Storage

**New file:** `.monomind/swarm/history.jsonl`

Append-only JSONL file. One JSON line per completed swarm run. Written by the collector when a swarm shuts down or terminates.

```typescript
interface SwarmHistoryEntry {
  swarmId: string;
  topology: string;           // hierarchical, mesh, hierarchical-mesh, ring, star, adaptive
  consensus: string;          // raft, byzantine, gossip, crdt, quorum
  strategy: string;           // specialized, balanced, pipeline, parallel
  status: string;             // completed, terminated, error
  agents: SwarmHistoryAgent[];
  messages: SwarmHistoryMessage[];
  errors: SwarmHistoryError[];
  findings: SwarmHistoryFinding[];
  taskCount: number;
  completedTasks: number;
  failedTasks: number;
  startedAt: string;          // ISO 8601
  endedAt: string;            // ISO 8601
  durationMs: number;
}

interface SwarmHistoryAgent {
  id: string;
  type: string;               // coder, tester, reviewer, etc.
  role: string;               // queen, worker, specialist
  tasksCompleted: number;
  tasksFailed: number;
  messageCount: number;       // total messages sent + received
  utilization: number;        // 0-100 percentage
}

interface SwarmHistoryMessage {
  id: string;
  type: string;               // task_assignment, task_complete, status_update, etc.
  from: string;               // agent ID
  to: string;                 // agent ID or "broadcast"
  payload: string;            // stringified summary (first 200 chars)
  timestamp: number;          // epoch ms
}

interface SwarmHistoryError {
  agentId: string;
  taskId: string;
  error: string;
  timestamp: number;
}

interface SwarmHistoryFinding {
  agentId: string;
  severity: string;           // low, medium, high, critical
  description: string;
  file?: string;
  line?: number;
}
```

### API Endpoint

**`GET /api/swarm-history`** — Returns `{ entries: SwarmHistoryEntry[] }` parsed from `.monomind/swarm/history.jsonl`. Sorted newest-first. Returns `{ entries: [] }` if file doesn't exist.

Optional query param: `?dir=<projectDir>` for multi-project support (same pattern as existing endpoints).

### Collector Change

In `collector.mjs`, when the file watcher detects `.swarm/state.json` changing to a terminal status (`terminated`, `stopped`, `completed`), or when the swarm status in the SSE feed transitions to terminal:

1. Read the full swarm state (agents, messages, errors, findings, task results)
2. Build a `SwarmHistoryEntry` from the state
3. Append as one JSON line to `.monomind/swarm/history.jsonl`
4. Broadcast a `swarm-history-updated` event to WebSocket clients so the dashboard refreshes

## UI Structure

### HTML — Replace `po-swarm-tab` Content

The existing `po-swarm-tab` div (currently: 200px sidebar with meta + full canvas) gets replaced with:

```
po-swarm-tab (flex-direction: row)
├── po-swarm-list (220px, left sidebar, scrollable)
│   └── .po-swarm-item (clickable rows, one per history entry)
│       ├── .po-swarm-item-id (swarm ID, truncated)
│       ├── .po-swarm-item-topo (topology badge: HIERARCHICAL, MESH, etc.)
│       ├── .po-swarm-item-agents (agent count)
│       ├── .po-swarm-item-status (status dot: green=completed, red=error, yellow=terminated)
│       └── .po-swarm-item-time (relative timestamp)
│
└── po-swarm-detail (flex: 1, right panel)
    ├── po-swarm-hint ("SELECT A SWARM RUN" placeholder, visible when none selected)
    ├── po-swarm-header (hidden until selected)
    │   ├── po-swarm-title (swarm ID)
    │   └── po-swarm-subtitle (topology · consensus · N agents · duration)
    ├── po-swarm-stats-bar (hidden until selected)
    │   ├── stat: topology
    │   ├── stat: consensus
    │   ├── stat: agent count
    │   ├── stat: status
    │   └── stat: duration
    ├── po-swarm-canvas-wrap (flex, shrinks when agent selected)
    │   ├── po-swarm-topo-label ("TOPOLOGY" or "LIVE TOPOLOGY")
    │   └── po-swarm-canvas (canvas element)
    ├── po-swarm-agents-section
    │   ├── label: "AGENTS (click to inspect)"
    │   └── po-swarm-agent-list (clickable agent rows)
    │       └── .po-swarm-agent-item
    │           ├── status dot (green/red)
    │           ├── agent type (monospace)
    │           ├── role badge (QUEEN/WORKER)
    │           ├── task count
    │           └── message count
    └── po-swarm-agent-drawer (hidden until agent clicked)
        ├── po-swarm-agent-header
        │   ├── agent type + role
        │   ├── metrics (tasks, msgs, utilization)
        │   └── close button (×)
        └── po-swarm-agent-timeline (scrollable communication log)
            └── .po-swarm-msg
                ├── timestamp
                ├── direction arrow (→ sent / ← received)
                ├── peer agent name
                └── message type + payload preview
```

### CSS

Follow existing dashboard patterns. Key additions:

- `#po-swarm-list`: 220px wide, `overflow-y: auto`, border-right, same styling as `#po-sessions-list`
- `.po-swarm-item`: Same hover/selected states as `.po-session-item`
- `.po-swarm-item.selected`: `background: rgba(0,229,200,0.06)`, left border accent
- `#po-swarm-canvas-wrap`: Transition `max-height` for shrink animation when agent drawer opens
- `#po-swarm-agent-drawer`: `border-top: 1px solid var(--border)`, slides up with CSS transition
- `.po-swarm-msg`: Left border color coding — `var(--teal)` for sent, `#4488cc` for received
- Status dots: `.status-completed` = green, `.status-error` = red, `.status-terminated` = amber

### Topology Canvas

Reuse the existing `renderPalaceSwarm()` drawing logic but adapt it to:
1. Accept agent data from the selected history entry (not just live state)
2. Highlight selected agent node in amber (`rgba(255,180,0,0.8)`) when agent drawer is open
3. Draw topology edges based on actual topology type (hierarchical = star from queen, mesh = interconnected, ring = circular chain)
4. Label each node with truncated agent type

### Agent Drawer — Communication Timeline

When an agent is clicked:
1. Canvas wrap shrinks to ~40% of its normal height (CSS transition on `max-height`)
2. Selected agent node on canvas gets amber highlight
3. Drawer appears below with:
   - Header row: agent type (bold, teal), role badge, metrics chips
   - Close button (×) that hides drawer and restores canvas height
4. Timeline filters `messages[]` from the history entry where `from === agentId || to === agentId`
5. Messages sorted by timestamp ascending
6. Each message shows:
   - Timestamp (HH:MM:SS format)
   - Direction: `→` (sent, teal border) or `←` (received, blue border)
   - Peer agent type
   - Message type badge
   - Payload preview (first 100 chars)

### Live Swarm Integration

When `appData.swarm.state` indicates an active swarm:
- Show it as the first entry in the sidebar with a pulsing green dot and "LIVE" label
- Detail panel shows real-time topology (same as current behavior)
- Agent list updates as agents are spawned/complete
- Communication log streams live messages

When the live swarm completes, it gets appended to history and becomes a regular history entry.

## JavaScript Functions

| Function | Purpose |
|----------|---------|
| `renderSwarmHistory()` | Fetches `/api/swarm-history`, renders sidebar list, handles live swarm as first entry |
| `selectSwarmRun(idx)` | Loads selected entry, renders stats bar + topology canvas + agent list |
| `selectSwarmAgent(agentId)` | Opens agent drawer, filters messages, highlights node on canvas |
| `closeSwarmAgent()` | Hides drawer, restores canvas height, removes highlight |
| `drawSwarmTopology(entry, selectedAgentId?)` | Canvas rendering — reuses existing drawing logic, adds agent highlight |

## Edge Cases

- **No history + no live swarm:** Show "NO SWARM HISTORY" centered in detail panel (like current idle state)
- **History file missing:** `/api/swarm-history` returns `{ entries: [] }`, sidebar shows empty state
- **Live swarm with no history:** Only the live entry appears in sidebar
- **Agent with zero messages:** Show "No communication recorded" in drawer
- **Very long message payload:** Truncate to 200 chars with ellipsis
- **Many history entries:** Sidebar scrolls, no pagination needed (JSONL is append-only, unlikely to exceed hundreds of entries)
- **Corrupted JSONL line:** Skip malformed lines, log warning to console
