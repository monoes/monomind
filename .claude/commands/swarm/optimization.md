# Optimization Swarm Strategy

## Purpose
Performance optimization through specialized analysis.

## Activation

### Using MCP Tools
```javascript
// Initialize optimization swarm
mcp__monomind__swarm_init({
  "topology": "mesh",
  "maxAgents": 6,
  "strategy": "adaptive"
})

// Orchestrate optimization task
mcp__monomind__task_orchestrate({
  "task": "optimize performance",
  "strategy": "parallel",
  "priority": "high"
})
```

### Using CLI (Fallback)
`npx monomind swarm "optimize performance" --strategy optimization`

## Agent Roles

### Agent Spawning with MCP
```javascript
// Spawn optimization agents
mcp__monomind__agent_spawn({
  "type": "optimizer",
  "name": "Performance Profiler",
  "capabilities": ["profiling", "bottleneck-detection"]
})

mcp__monomind__agent_spawn({
  "type": "analyst",
  "name": "Memory Analyzer",
  "capabilities": ["memory-analysis", "leak-detection"]
})

mcp__monomind__agent_spawn({
  "type": "optimizer",
  "name": "Code Optimizer",
  "capabilities": ["code-optimization", "refactoring"]
})

mcp__monomind__agent_spawn({
  "type": "tester",
  "name": "Benchmark Runner",
  "capabilities": ["benchmarking", "performance-testing"]
})
```

## Optimization Areas

### Performance Analysis
```javascript
// Analyze bottlenecks
mcp__monomind__bottleneck_analyze({
  "component": "all",
  "metrics": ["cpu", "memory", "io", "network"]
})

// Run benchmarks
mcp__monomind__benchmark_run({
  "suite": "performance"
})

// WASM optimization
mcp__monomind__wasm_optimize({
  "operation": "simd-acceleration"
})
```

### Optimization Operations
```javascript
// Optimize topology
mcp__monomind__topology_optimize({
  "swarmId": "optimization-swarm"
})

// DAA optimization
mcp__monomind__daa_optimization({
  "target": "performance",
  "metrics": ["speed", "memory", "efficiency"]
})

// Load balancing
mcp__monomind__load_balance({
  "swarmId": "optimization-swarm",
  "tasks": optimizationTasks
})
```

### Monitoring and Reporting
```javascript
// Performance report
mcp__monomind__performance_report({
  "format": "detailed",
  "timeframe": "7d"
})

// Trend analysis
mcp__monomind__trend_analysis({
  "metric": "performance",
  "period": "30d"
})

// Cost analysis
mcp__monomind__cost_analysis({
  "timeframe": "30d"
})
```
