---
name: swarm-swarm-background
description: Run swarms in background mode — start a swarm, let it work autonomously, and retrieve results later without blocking
---

# Background Swarm Operations

Start swarms that work autonomously without blocking the main conversation.

## How to Invoke

```
Skill("swarm:swarm-background")
```

---

## Pattern

Background swarms work best with the Claude Code Task tool — spawn agents with `run_in_background: true`, then continue other work while they run.

```javascript
// 1. Initialize the swarm
mcp__monomind__swarm_init({ topology: "hierarchical", maxAgents: 6, strategy: "specialized" })

// 2. Spawn agents with background execution via Task tool
// (spawn multiple agents in a single message for true parallelism)

// 3. Check status later (do NOT poll — wait for notifications)
mcp__monomind__swarm_status({ swarmId: "current" })
```

## Anti-Patterns to Avoid

- **Do NOT** poll `swarm_status` in a loop — wait for agents to report back
- **Do NOT** spawn agents one-at-a-time sequentially — spawn all in one message
- **Do NOT** check status immediately after spawning — give agents time to work

## Memory Persistence

Store results from a background swarm for retrieval in future sessions:

```javascript
mcp__monomind__memory_store({
  key: "background-swarm-results",
  value: "summary of what was found",
  namespace: "swarm"
})
```

Retrieve later:

```javascript
mcp__monomind__memory_search({ query: "background swarm results", namespace: "swarm", limit: 5 })
```

## CLI

```bash
# Start in background (returns immediately)
npx monomind swarm start "analyze codebase" --strategy analysis &

# Check later
npx monomind swarm status
```
