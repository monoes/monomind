---
name: swarm-testing
description: Testing swarm strategy — distributed parallel test execution with specialized unit, integration, E2E, and performance testing agents
---

# Testing Swarm Strategy

Comprehensive testing through distributed execution.

## How to Invoke

```
Skill("swarm:testing")
```

Then describe the testing scope:
> "Start a testing swarm to run full test coverage on the API."
> "Run a testing swarm to validate the auth module end-to-end."

---

## Swarm Setup

```javascript
// Initialize testing swarm
mcp__monomind__swarm_init({
  topology: "star",
  maxAgents: 7,
  strategy: "parallel"
})

// Coordinate testing
mcp__monomind__coordination_orchestrate({
  task: "test application",
  strategy: "parallel"
})
```

```bash
# CLI equivalent
npx monomind swarm init --topology star --max-agents 7
npx monomind swarm start "test application" --strategy testing --parallel
```

## Agent Roles

```javascript
mcp__monomind__agent_spawn({ type: "tester", capabilities: ["unit-testing", "mocking", "coverage"] })
mcp__monomind__agent_spawn({ type: "tester", capabilities: ["integration", "api-testing", "contract-testing"] })
mcp__monomind__agent_spawn({ type: "tester", capabilities: ["e2e", "ui-testing", "user-flows"] })
mcp__monomind__agent_spawn({ type: "tester", capabilities: ["load-testing", "stress-testing", "benchmarking"] })
mcp__monomind__agent_spawn({ type: "tester", capabilities: ["security-testing", "vulnerability-scanning"] })
```

## Test Execution

Run tests in parallel via Bash agents:

```bash
# Agents each run one of these in parallel
npm run test:unit
npm run test:integration
npm run test:e2e
```

## Monitoring and Reporting

```javascript
// Check swarm status
mcp__monomind__swarm_status({ swarmId: "current" })

// Performance metrics
mcp__monomind__performance_report({ format: "detailed" })
```

## Best Practices

- Use star topology (coordinator at center, test agents at spokes) for isolated parallel runs
- Run unit and integration tests in parallel; run E2E only after integration passes
- Security testing agent runs last, after code is stable
