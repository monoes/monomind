# Optimization Swarm Strategy

## Purpose
Performance optimization through specialized analysis.

## Activation

### Using MCP Tools
```javascript
// Initialize optimization swarm
mcp__monobrain__swarm_init({
  "topology": "mesh",
  "maxAgents": 6,
  "strategy": "adaptive"
})

// Orchestrate optimization task
mcp__monobrain__task_orchestrate({
  "task": "optimize performance",
  "strategy": "parallel",
  "priority": "high"
})
```

### Using CLI (Fallback)
`npx monobrain swarm "optimize performance" --strategy optimization`

## Agent Roles

### Agent Spawning with MCP
```javascript
// Spawn optimization agents
mcp__monobrain__agent_spawn({
  "type": "optimizer",
  "name": "Performance Profiler",
  "capabilities": ["profiling", "bottleneck-detection"]
})

mcp__monobrain__agent_spawn({
  "type": "analyst",
  "name": "Memory Analyzer",
  "capabilities": ["memory-analysis", "leak-detection"]
})

mcp__monobrain__agent_spawn({
  "type": "optimizer",
  "name": "Code Optimizer",
  "capabilities": ["code-optimization", "refactoring"]
})

mcp__monobrain__agent_spawn({
  "type": "tester",
  "name": "Benchmark Runner",
  "capabilities": ["benchmarking", "performance-testing"]
})
```

## Optimization Areas

### Performance Analysis
```javascript
// Analyze bottlenecks
mcp__monobrain__bottleneck_analyze({
  "component": "all",
  "metrics": ["cpu", "memory", "io", "network"]
})

// Run benchmarks
mcp__monobrain__benchmark_run({
  "suite": "performance"
})

// WASM optimization
mcp__monobrain__wasm_optimize({
  "operation": "simd-acceleration"
})
```

### Optimization Operations
```javascript
// Optimize topology
mcp__monobrain__topology_optimize({
  "swarmId": "optimization-swarm"
})

// DAA optimization
mcp__monobrain__daa_optimization({
  "target": "performance",
  "metrics": ["speed", "memory", "efficiency"]
})

// Load balancing
mcp__monobrain__load_balance({
  "swarmId": "optimization-swarm",
  "tasks": optimizationTasks
})
```

### Monitoring and Reporting
```javascript
// Performance report
mcp__monobrain__performance_report({
  "format": "detailed",
  "timeframe": "7d"
})

// Trend analysis
mcp__monobrain__trend_analysis({
  "metric": "performance",
  "period": "30d"
})

// Cost analysis
mcp__monobrain__cost_analysis({
  "timeframe": "30d"
})
```
