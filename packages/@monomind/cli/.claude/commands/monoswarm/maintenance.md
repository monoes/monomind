---
name: swarm-maintenance
description: Maintenance swarm strategy — sequential coordinated system maintenance for dependency updates, security audits, and documentation
---

# Maintenance Swarm Strategy

System maintenance and updates through coordinated agents.

## How to Invoke

```
Skill("swarm:maintenance")
```

Then describe the maintenance task:
> "Run a maintenance swarm to update all dependencies safely."
> "Start a maintenance swarm for the monthly security audit."

---

## Swarm Setup

```javascript
// Initialize maintenance swarm
mcp__monomind__swarm_init({
  topology: "star",
  maxAgents: 5,
  strategy: "sequential"
})

// Coordinate maintenance
mcp__monomind__coordination_orchestrate({
  task: "update dependencies",
  strategy: "sequential"
})
```

```bash
# CLI equivalent
npx monomind swarm init --topology star --max-agents 5
npx monomind swarm start "update dependencies" --strategy maintenance
```

## Agent Roles

```javascript
mcp__monomind__agent_spawn({ type: "analyst", capabilities: ["dependency-analysis", "version-management"] })
mcp__monomind__agent_spawn({ type: "tester", capabilities: ["testing", "validation"] })
mcp__monomind__agent_spawn({ type: "documenter", capabilities: ["documentation", "changelog"] })
```

## Maintenance Sequence

Star topology runs sequentially — each agent completes before the next starts:

1. **Analyzer agent** — audit outdated dependencies, find vulnerabilities
2. **Tester agent** — verify tests pass on current state (baseline)
3. **Analyst agent** — apply updates, verify no regressions
4. **Tester agent** — rerun tests to confirm updates are safe
5. **Documenter agent** — update CHANGELOG, document what changed

## Security Scanning

```javascript
// Run security scan via AI defence
mcp__monomind__aidefence_scan({ target: "./" })
```

## Monitoring

```javascript
mcp__monomind__swarm_status({ swarmId: "current" })
mcp__monomind__system_health({})
```
