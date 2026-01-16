# Development Swarm Strategy

## Purpose
Coordinated development through specialized agent teams.

## Activation

### Using MCP Tools
```javascript
// Initialize development swarm
mcp__monobrain__swarm_init({
  "topology": "hierarchical",
  "maxAgents": 8,
  "strategy": "balanced"
})

// Orchestrate development task
mcp__monobrain__task_orchestrate({
  "task": "build feature X",
  "strategy": "parallel",
  "priority": "high"
})
```

### Using CLI (Fallback)
`npx monobrain swarm "build feature X" --strategy development`

## Agent Roles

### Agent Spawning with MCP
```javascript
// Spawn development agents
mcp__monobrain__agent_spawn({
  "type": "architect",
  "name": "System Designer",
  "capabilities": ["system-design", "api-design"]
})

mcp__monobrain__agent_spawn({
  "type": "coder",
  "name": "Frontend Developer",
  "capabilities": ["react", "typescript", "ui"]
})

mcp__monobrain__agent_spawn({
  "type": "coder",
  "name": "Backend Developer",
  "capabilities": ["nodejs", "api", "database"]
})

mcp__monobrain__agent_spawn({
  "type": "specialist",
  "name": "Database Expert",
  "capabilities": ["sql", "nosql", "optimization"]
})

mcp__monobrain__agent_spawn({
  "type": "tester",
  "name": "Integration Tester",
  "capabilities": ["integration", "e2e", "api-testing"]
})
```

## Best Practices
- Use hierarchical mode for large projects
- Enable parallel execution
- Implement continuous testing
- Monitor swarm health regularly

## Status Monitoring
```javascript
// Check swarm status
mcp__monobrain__swarm_status({
  "swarmId": "development-swarm"
})

// Monitor agent performance
mcp__monobrain__agent_metrics({
  "agentId": "architect-001"
})

// Real-time monitoring
mcp__monobrain__swarm_monitor({
  "swarmId": "development-swarm",
  "interval": 5000
})
```

## Error Handling
```javascript
// Enable fault tolerance
mcp__monobrain__daa_fault_tolerance({
  "agentId": "all",
  "strategy": "auto-recovery"
})
```
