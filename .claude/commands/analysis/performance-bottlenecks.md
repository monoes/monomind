---
name: analysis:performance-bottlenecks
---

# Performance Bottleneck Analysis

## Purpose
Identify and resolve performance bottlenecks in your development workflow.

## Automated Analysis

### 1. Real-time Detection
The post-task hook automatically analyzes:
- Execution time vs. complexity
- Agent utilization rates
- Resource constraints
- Operation patterns

### 2. Common Bottlenecks

**Time Bottlenecks:**
- Tasks taking > 5 minutes
- Sequential operations that could parallelize
- Redundant file operations

**Coordination Bottlenecks:**
- Single agent for complex tasks
- Unbalanced agent workloads
- Poor topology selection

**Resource Bottlenecks:**
- High operation count (> 100)
- Memory constraints
- I/O limitations

### 3. Improvement Suggestions

```javascript
mcp__monomind__performance_bottleneck({
  component: "swarm",  // optional — omit to scan all
  threshold: 20,       // alert threshold %
  deep: true           // full analysis
})

// Result includes:
{
  "bottlenecks": [
    {
      "component": "cpu",
      "severity": "high",
      "message": "CPU load at 82%",
      "threshold": 75
    }
  ]
}
```

## Continuous Optimization
The system learns from each task to prevent future bottlenecks!